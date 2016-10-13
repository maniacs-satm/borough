'use strict'

const lab = exports.lab = require('lab').script()
const describe = lab.experiment
const before = lab.before
const after = lab.after
const it = lab.it
const expect = require('code').expect

const Memdown = require('memdown')
const timers = require('timers')
const async = require('async')

const Borough = require('../')

const CLIENT_TIMEOUT_MS = 10000 // TODO: take this down

describe('borough cluster topology changes', () => {
  let working = true
  let baseNode
  let nodes = [0, 1, 2, 3]

  function onRequest (req, reply) {
    const part = req.partition
    expect(part.name).to.equal('partition 1')
    const body = req.body
    if (body.type === 'put') {
      part.put(body.key, body.value, reply)
    } else if (body.type === 'get') {
      part.get(body.key, reply)
    } else {
      reply(new Error('unknown op ' + body.type))
    }
  }

  before(done => {
    baseNode = Borough({
      subnode: {
        skiff: {
          db: Memdown
        }
      }
    })
    baseNode.on('request', onRequest)
    baseNode.start(done)
  })

  before(done => {
    let lastValue
    let counter = 0

    const partition = baseNode.partition('partition 1')
    request()
    done()

    function request () {
      if (!working) return
      const timeout = timers.setTimeout(onTimeout, CLIENT_TIMEOUT_MS)
      const isPut = !(counter % 2)
      const isGet = !isPut
      if (isPut) {
        lastValue = counter
      }
      counter++

      if (isGet) {
        partition.get('a', (err, resp) => {
          timers.clearTimeout(timeout)
          expect(err).to.be.null()
          expect(resp).to.equal(lastValue)
          process.nextTick(request)
        })
      } else {
        partition.put('a', lastValue, err => {
          timers.clearTimeout(timeout)
          expect(!err).to.be.true()
          process.nextTick(request)
        })
      }

      function onTimeout () {
        throw new Error(`client timeout after ${counter} requests`)
      }
    }
  })

  after(done => {
    working = false
    async.parallel(
      [
        baseNode.stop.bind(baseNode),
        done => {
          async.each(nodes, (node, done) => {
            if ((typeof node) === 'object') {
              node.stop(done)
            } else {
              done()
            }
          }, done)
        }
      ],
      done)
  })

  it('can rail in clients', {timeout: (nodes.length * 2) * 11000}, done => {
    async.eachSeries(
      nodes,
      (index, done) => {
        timers.setTimeout(() => {
          const newNode = nodes[index] = Borough({
            base: [baseNode.whoami()],
            subnode: {
              skiff: {
                db: Memdown
              }
            }
          })
          newNode.on('request', onRequest)
          newNode.start(done)
        }, 10000)
      },
      done)
  })

  // it('waits a bit', { timeout: 6000}, done => timers.setTimeout(done, 5000))

  it('partition has 2 peers', done => {
    baseNode.partition('partition 1').info((err, info) => {
      expect(!err).to.be.true()
      expect(info.source).to.match(/^\/ip4\/.*\/p\/partition 1$/)
      expect(info.peers.length).to.be.least(2)
      done()
    })
  })
})
