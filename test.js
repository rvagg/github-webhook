import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
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

async function waitForLines (file, count, timeout = 5000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
    if (lines.length >= count || Date.now() > deadline) {
      return lines
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('events arriving during a run coalesce into one rerun with the newest payload', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-webhook-'))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  const out = path.join(dir, 'out')
  const server = webhook({
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [{ event: 'push', match: 'true', exec: `sleep 0.2; echo "$gh_n" >> ${out}` }]
  })

  for (const n of [1, 2, 3]) {
    server.webhookHandler.emit('*', { event: 'push', payload: { n } })
  }

  assert.deepStrictEqual(await waitForLines(out, 2), ['1', '3'])
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.deepStrictEqual(await waitForLines(out, 3, 0), ['1', '3'])
})

test('array exec rule runs repeatedly', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-webhook-'))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  const out = path.join(dir, 'out')
  const server = webhook({
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [{ event: 'push', match: 'true', exec: ['sh', '-c', `echo "$gh_n" >> ${out}`] }]
  })

  server.webhookHandler.emit('*', { event: 'push', payload: { n: 1 } })
  assert.deepStrictEqual(await waitForLines(out, 1), ['1'])
  server.webhookHandler.emit('*', { event: 'push', payload: { n: 2 } })
  assert.deepStrictEqual(await waitForLines(out, 2), ['1', '2'])
})

test('rule recovers when spawn throws', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-webhook-'))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  const out = path.join(dir, 'out')
  const server = webhook({
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [{ event: 'push', match: 'true', exec: `echo "$gh_n" >> ${out}` }]
  })

  // env values can't contain NUL
  server.webhookHandler.emit('*', { event: 'push', payload: { n: 'a\u0000b' } })
  server.webhookHandler.emit('*', { event: 'push', payload: { n: 2 } })
  assert.deepStrictEqual(await waitForLines(out, 1), ['2'])
})

test('rule with large output completes without a log', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-webhook-'))
  t.after(() => fs.rmSync(dir, { recursive: true }))
  const out = path.join(dir, 'out')
  const server = webhook({
    port: 0,
    path: '/webhook',
    secret: 'foofaa',
    rules: [{ event: 'push', match: 'true', exec: `head -c 1000000 /dev/zero; echo "$gh_n" >> ${out}` }]
  })

  server.webhookHandler.emit('*', { event: 'push', payload: { n: 1 } })
  assert.deepStrictEqual(await waitForLines(out, 1), ['1'])
})

test('CLI exits on SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const cp = spawn(process.execPath, [path.join(__dirname, 'github-webhook.js'), '--port', '0', '--path', '/webhook', '--secret', 'foofaa'], {
    env: { ...process.env, DEBUG: 'github-webhook:server' }
  })

  const exited = new Promise((resolve) => cp.on('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    cp.stderr.on('data', (data) => {
      if (data.toString().includes('Listening on')) {
        resolve()
      }
    })
    exited.then(({ code }) => reject(new Error(`CLI exited early with code ${code}`)))
  })

  cp.kill('SIGTERM')
  assert.deepStrictEqual(await exited, { code: 143, signal: null })
})
