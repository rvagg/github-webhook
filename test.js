const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const test = require('tape')
const supertest = require('supertest')
const webhook = require('./')

function signBlob (key, blob) {
  return `sha1=${crypto.createHmac('sha1', key).update(blob).digest('hex')}`
}

test('invalid url gets 404', (t) => {
  t.plan(1)

  var options = { port: 0, path: '/webhook', secret: 'foofaa' }
  var server = webhook(options)

  supertest(server)
    .get('/')
    .expect('Content-Type', /json/)
    .expect(404)
    .end((err) => {
      t.error(err)
    })
})

test('valid url, incomplete data gets 400', (t) => {
  t.plan(1)

  var options = { port: 0, path: '/webhook', secret: 'foofaa' }
  var server = webhook(options)

  supertest(server)
    .get('/webhook')
    .expect('Content-Type', /json/)
    .expect(400)
    .end((err) => {
      t.error(err)
    })
})

test('valid url, complete data gets 200', (t) => {
  t.plan(2)

  var options = { port: 0, path: '/webhook', secret: 'foofaa' }
  var server = webhook(options)
  var obj = { some: 'github', object: 'with', properties: true }
  var json = JSON.stringify(obj)
  var id = '123abc'
  var eventType = 'issues'

  server.webhookHandler.on(eventType, (event) => {
    t.deepEqual(event, { event: eventType, id: id, payload: obj, url: '/webhook' })
  })

  supertest(server)
    .post('/webhook')
    .set('X-Hub-Signature', signBlob('foofaa', json))
    .set('X-Github-Event', eventType)
    .set('X-Github-Delivery', id)
    .send(json)
    .expect('Content-Type', /json/)
    .expect(200)
    .end((err) => {
      t.error(err)
    })
})

test('valid request triggers rule', (t) => {
  t.plan(5)

  var tmpfile = path.join(__dirname, '/__test_data.' + Math.random())
  var eventType = 'issues'
  var options = {
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [
      { // should not trigger this event
        event: eventType,
        match: 'some == xxgithub',
        exec: ['sh', '-c', `echo "w00t!" > ${tmpfile}2`]
      },
      { // should trigger this event
        event: eventType,
        match: 'some == github',
        exec: `echo "w00t!" > ${tmpfile}`
      }
    ]
  }
  var server = webhook(options)
  var obj = { some: 'github', object: 'with', properties: true }
  var json = JSON.stringify(obj)
  var id = '123abc'

  t.on('end', () => {
    fs.unlink(tmpfile, () => {})
  })

  server.webhookHandler.on(eventType, (event) => {
    t.deepEqual(event, { event: eventType, id: id, payload: obj, url: '/webhook' })
    setTimeout(() => {
      fs.readFile(tmpfile, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'w00t!\n')
      })
      fs.stat(`${tmpfile}2`, (err) => {
        t.error(err, 'does not exist, didn\'t trigger second event')
      })
    }, 100)
  })

  supertest(server)
    .post('/webhook')
    .set('X-Hub-Signature', signBlob('foofaa', json))
    .set('X-Github-Event', eventType)
    .set('X-Github-Delivery', id)
    .send(json)
    .expect('Content-Type', /json/)
    .expect(200)
    .end((err) => {
      t.error(err)
    })
})
