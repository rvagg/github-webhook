#!/usr/bin/env node

import http from 'node:http'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import createHandler from 'github-webhook-handler'
import debug from 'debug'
import matchme from 'matchme'
import split2 from 'split2'
import through2 from 'through2'
import minimist from 'minimist'

const serverDebug = debug('github-webhook:server')
const eventsDebug = debug('github-webhook:events')

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const argv = minimist(process.argv.slice(2))
  let config = {}

  if (typeof argv.config === 'string') {
    config = JSON.parse(fs.readFileSync(argv.config))
  }

  if (argv.port !== undefined) {
    config.port = argv.port
  } else if (process.env.PORT !== undefined) {
    config.port = process.env.PORT
  }

  if (argv.host !== undefined) {
    config.host = String(argv.host)
  }

  if (argv.secret !== undefined) {
    config.secret = String(argv.secret)
  }

  if (argv.path !== undefined) {
    config.path = String(argv.path)
  }

  if (argv.log !== undefined) {
    config.log = String(argv.log)
  }

  if (!Array.isArray(config.rules)) {
    config.rules = []
  }

  if (argv.rule) {
    config.rules = config.rules.concat(
      collectRules(Array.isArray(argv.rule) ? argv.rule : [argv.rule])
    )
  }

  const listening = function listening (err) {
    if (err) {
      throw err
    }

    serverDebug(`Listening on http://${this.address().address}:${this.address().port}`)
  }

  const server = createServer(config)

  server.listen.apply(server, config.host
    ? [config.port, config.host, listening]
    : [config.port, listening]
  )
}

function collectRules (rules) {
  return rules.map((rule) => {
    let c = rule.indexOf(':')
    if (c < 0) {
      return null
    }

    const event = rule.substring(0, c)

    rule = rule.substring(c + 1)
    c = rule.indexOf(':')
    if (c < 0) {
      return null
    }

    const match = rule.substring(0, c)
    const exec = rule.substring(c + 1)

    if (!event || !match || !exec) {
      return null
    }

    return { event, match, exec }
  }).filter(Boolean)
}

function createServer (options) {
  if (options.port === undefined) {
    throw new TypeError('must provide a \'port\' option')
  }

  if (!Array.isArray(options.rules)) {
    options.rules = []
  }

  const server = http.createServer()
  const handler = createHandler(options)
  const logStream = typeof options.log === 'string' && (
    options.log === 'stdout'
      ? process.stdout
      : options.log === 'stderr'
        ? process.stderr
        : fs.createWriteStream(options.log)
  )

  server.webhookHandler = handler

  server.on('request', (req, res) => {
    serverDebug(`Connection from ${req.socket.address().address}:${req.socket.address().port}`)

    handler(req, res, (err) => {
      function response (code, msg) {
        if (res.headersSent) {
          return
        }

        const address = req.socket.address()

        serverDebug('Response to %s:%s: %d "%s"',
          address ? address.address : 'unknown',
          address ? address.port : '??',
          code,
          msg
        )

        res.writeHead(code, { 'content-type': 'text/json' })
        res.end(JSON.stringify({ error: msg }))
      }

      if (err) {
        return response(500, `Internal server error: ${err.message}`)
      }

      response(404, 'Resource not found on this server')
    })
  })

  handler.on('error', (err) => {
    eventsDebug('Non-fatal error: ' + JSON.stringify(err.message))
  })

  handler.on('*', (event) => {
    eventsDebug(JSON.stringify(event))
    handleRules(logStream, options.rules, event)
  })

  return server
}

function prefixStream (stream, prefix) {
  return stream.pipe(split2()).pipe(through2((data, enc, callback) => {
    callback(null, `${prefix}${data}\n`)
  }))
}

function envFromPayload (payload, prefix, env) {
  if (!env) {
    env = {}
  }

  // Add branch as an env var without mutating the payload
  if (payload.ref && payload.ref.startsWith('refs/heads/')) {
    env[prefix + 'branch'] = payload.ref.substring('refs/heads/'.length)
  }

  Object.keys(payload).forEach((k) => {
    const val = payload[k]
    switch (typeof val) {
      case 'boolean':
      case 'number':
      case 'string':
        env[prefix + k] = val
        break
      case 'object':
        if (val) {
          envFromPayload(val, prefix + k + '_', env)
        }
        break
    }
  })

  return env
}

function handleRules (logStream, rules, event) {
  function executeRule (rule) {
    if (rule.executing === true) {
      rule.queued = true // we're busy working on this rule, queue up another run
      return
    }

    rule.executing = true

    const startTs = Date.now()
    const eventStr = `event="${rule.event}", match="${rule.match}", exec="${rule.exec}"`
    const exec = Array.isArray(rule.exec) ? rule.exec : ['sh', '-c', rule.exec]

    eventsDebug('Matched rule for %s', eventStr)

    const cp = spawn(exec.shift(), exec, {
      env: Object.assign(envFromPayload(event.payload, 'gh_'), process.env)
    })

    cp.on('error', (err) => {
      return eventsDebug('Error executing command [%s]: %s', rule.exec, err.message)
    })

    cp.on('close', (code) => {
      eventsDebug('Executed command [%s] exited with [%d]', rule.exec, code)

      if (logStream) {
        logStream.write(eventStr + '\n')
        logStream.write(new Date() + '\n')
        logStream.write('Took ' + (Date.now() - startTs) + ' ms\n')
      }

      rule.executing = false
      if (rule.queued === true) {
        rule.queued = false
        executeRule(rule) // do it again!
      }
    })

    if (logStream) {
      prefixStream(cp.stdout, 'stdout: ').pipe(logStream, { end: false })
      prefixStream(cp.stderr, 'stderr: ').pipe(logStream, { end: false })
    }
  }

  rules.forEach((rule) => {
    if (rule.event !== '*' && rule.event !== event.event) {
      return
    }

    if (!matchme(event.payload, rule.match)) {
      return
    }

    executeRule(rule)
  })
}

export default createServer
