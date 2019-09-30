#!/usr/bin/env node

const http = require('http')
const fs = require('fs')
const childProcess = require('child_process')
const PassThrough = require('stream').PassThrough
const createHandler = require('github-webhook-handler')
const debug = require('debug')
const matchme = require('matchme')
const split2 = require('split2')
const through2 = require('through2')
const bl = require('bl')
const argv = require('minimist')(process.argv.slice(2))
const serverDebug = debug('github-webhook:server')
const eventsDebug = debug('github-webhook:events')

if (require.main === module) {
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
      return
    }

    const event = rule.substring(0, c)

    rule = rule.substring(c + 1)
    c = rule.indexOf(':')
    if (c < 0) {
      return
    }

    const match = rule.substring(0, c)
    const exec = rule.substring(c + 1)

    return event && match && exec && {
      event: event,
      match: match,
      exec: exec
    }
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
        const address = req.socket.address()

        serverDebug('Response to %s:%s: %d "%s"'
          , address ? address.address : 'unknown'
          , address ? address.port : '??'
          , code
          , msg
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

  if (payload.ref && payload.ref.startsWith('refs/heads/')) {
    payload.branch = payload.ref.substring('refs/heads/'.length)
  } else {
    payload.branch = null
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
    const past = new PassThrough()

    eventsDebug('Matched rule for %s', eventStr)
    const childOpts = {
      env: Object.assign(envFromPayload(event.payload, 'gh_'), process.env)
    }

    const cp = childProcess.spawn(exec.shift(), exec, childOpts)

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

    if (logStream || rule.report) {
      cp.stdout.pipe(past)
      prefixStream(cp.stderr, '! ').pipe(past)
    }

    if (logStream) {
      past.pipe(logStream, { end: false })
    }
    if (rule.report) {
      past.pipe(bl((err, data) => {
        if (err) {
          console.error('Cannot buffer executed command output', err)
        } else {
          childOpts.env.gh_report = data.toString()
          childProcess.exec(rule.report, childOpts, function (err) {
            if (err) {
              eventsDebug('Error executing report [%s]: %s', rule.report, err.message)
            }
          })
        }
      }))
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

module.exports = createServer
