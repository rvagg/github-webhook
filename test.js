import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import webhook from './github-webhook.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function signBlob (key, blob) {
  return `sha1=${crypto.createHmac('sha1', key).update(blob).digest('hex')}`
}

async function makeRequest (server, { method = 'POST', path = '/', headers = {}, body = '{}' }) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const url = new URL(path, `http://127.0.0.1:${port}`)

      fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body
      })
        .then(async (res) => {
          const text = await res.text()
          let json
          try {
            json = JSON.parse(text)
          } catch {}
          server.close()
          resolve({ status: res.status, headers: res.headers, text, json })
        })
        .catch((err) => {
          server.close()
          reject(err)
        })
    })
  })
}

test('invalid url gets 404', async () => {
  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)

  const res = await makeRequest(server, {
    path: '/',
    headers: {
      'X-Hub-Signature': signBlob('foofaa', '{}'),
      'X-Github-Event': 'issues',
      'X-Github-Delivery': '123abc'
    },
    body: '{}'
  })

  assert.strictEqual(res.status, 404)
  assert.ok(res.headers.get('content-type').includes('json'))
})

test('valid url, incomplete data gets 400', async () => {
  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)

  const res = await makeRequest(server, {
    path: '/webhook',
    headers: {
      'X-Github-Event': 'issues',
      'X-Github-Delivery': '123abc'
    },
    body: '{}'
  })

  assert.strictEqual(res.status, 400)
  assert.ok(res.headers.get('content-type').includes('json'))
})

test('valid url, complete data gets 200', async () => {
  const options = { port: 0, path: '/webhook', secret: 'foofaa' }
  const server = webhook(options)
  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const id = '123abc'
  const eventType = 'issues'

  const eventPromise = new Promise((resolve) => {
    server.webhookHandler.on(eventType, (event) => {
      delete event.host
      resolve(event)
    })
  })

  const res = await makeRequest(server, {
    path: '/webhook',
    headers: {
      'X-Hub-Signature': signBlob('foofaa', json),
      'X-Github-Event': eventType,
      'X-Github-Delivery': id
    },
    body: json
  })

  assert.strictEqual(res.status, 200)
  assert.ok(res.headers.get('content-type').includes('json'))

  const event = await eventPromise
  assert.strictEqual(event.event, eventType)
  assert.strictEqual(event.id, id)
  assert.deepStrictEqual(event.payload, obj)
})

test('valid request triggers rule', { skip: process.platform === 'win32' }, async () => {
  const tmpfile = path.join(__dirname, '__test_data.' + Math.random())
  const eventType = 'issues'
  const options = {
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [
      {
        event: eventType,
        match: 'some == xxgithub',
        exec: ['sh', '-c', `echo "w00t!" > ${tmpfile}2`]
      },
      {
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

  const eventPromise = new Promise((resolve) => {
    server.webhookHandler.on(eventType, (event) => {
      delete event.host
      resolve(event)
    })
  })

  const res = await makeRequest(server, {
    path: '/webhook',
    headers: {
      'X-Hub-Signature': signBlob('foofaa', json),
      'X-Github-Event': eventType,
      'X-Github-Delivery': id
    },
    body: json
  })

  assert.strictEqual(res.status, 200)

  const event = await eventPromise
  assert.strictEqual(event.event, eventType)
  assert.strictEqual(event.id, id)
  assert.deepStrictEqual(event.payload, obj)

  // Wait for the rule to execute
  await new Promise((resolve) => setTimeout(resolve, 200))

  const data = fs.readFileSync(tmpfile, 'utf8')
  assert.strictEqual(data, 'w00t!\n')

  // Verify second rule did not trigger
  assert.throws(() => fs.statSync(`${tmpfile}2`), { code: 'ENOENT' })

  // Cleanup
  fs.unlinkSync(tmpfile)
})
