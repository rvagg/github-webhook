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

  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)

  supertest(server)
    .post('/')
    .set('X-Hub-Signature', signBlob('foofaa', '{}'))
    .set('X-Github-Event', 'issues')
    .set('X-Github-Delivery', '123abc')
    .expect('Content-Type', /json/)
    .expect(404)
    .send('{}')
    .end((err) => {
      t.error(err)
    })
})

test('valid url, incomplete data gets 400', (t) => {
  t.plan(1)

  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)

  supertest(server)
    .post('/webhook')
    .set('X-Github-Event', 'issues')
    .set('X-Github-Delivery', '123abc')
    .expect('Content-Type', /json/)
    .expect(400)
    .send('{}')
    .end((err) => {
      t.error(err)
    })
})

test('valid url, complete data gets 200', (t) => {
  t.plan(2)

  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)
  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const id = '123abc'
  const eventType = 'issues'

  server.webhookHandler.on(eventType, (event) => {
    delete event.host // too hard
    t.deepEqual(event, { event: eventType, id: id, payload: obj, protocol: undefined, url: '/webhook', path: '/webhook' })
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

  const tmpfile = path.join(__dirname, '/__test_data.' + Math.random())
  const eventType = 'issues'
  const options = {
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
  const server = webhook(options)
  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const id = '123abc'

  t.on('end', () => {
    fs.unlink(tmpfile, () => {})
  })

  server.webhookHandler.on(eventType, (event) => {
    delete event.host // too hard
    t.deepEqual(event, { event: eventType, id: id, payload: obj, protocol: undefined, url: '/webhook', path: '/webhook' })
    setTimeout(() => {
      fs.readFile(tmpfile, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'w00t!\n')
      })
      fs.stat(`${tmpfile}2`, (err) => {
        t.ok(err, 'does not exist, didn\'t trigger second event')
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
