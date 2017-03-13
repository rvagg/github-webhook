#!/usr/bin/env node

const http          = require('http')
    , fs            = require('fs')
    , spawn         = require('child_process').spawn
    , createHandler = require('github-webhook-handler')
    , debug         = require('debug')
    , matchme       = require('matchme')
    , split2        = require('split2')
    , through2      = require('through2')
    , argv          = require('minimist')(process.argv.slice(2))
    , eventKeys     = Object.keys(require('github-webhook-handler/events'))
    , serverDebug   = debug('github-webhook:server')
    , eventsDebug   = debug('github-webhook:events')


if (require.main === module) {
  var config = {}
    , server
    , listening

  if (typeof argv.config == 'string')
    config = JSON.parse(fs.readFileSync(argv.config))

  if (argv.port !== undefined)
    config.port = argv.port
  else if (process.env.PORT !== undefined)
    config.port = process.env.PORT

  if (argv.host !== undefined)
    config.host = String(argv.host)

  if (argv.secret !== undefined)
    config.secret = String(argv.secret)

  if (argv.path !== undefined)
    config.path = String(argv.path)

  if (argv.log !== undefined)
    config.log = String(argv.log)

  if (!Array.isArray(config.rules))
    config.rules = []

  if (argv.rule) {
    config.rules = config.rules.concat(
      collectRules(Array.isArray(argv.rule) ? argv.rule : [ argv.rule ])
    )
  }

  var listening = function listening (err) {
    if (err)
      throw err

    serverDebug('Listening on http://'
        + this.address().address
        + ':'
        + this.address().port
    )
  }

  server = createServer(config)

  server.listen.apply(server, config.host
      ? [ config.port, config.host, listening ]
      : [ config.port, listening ]
  )
}


function collectRules (rules) {
  return rules.map(function (rule) {
    var c = rule.indexOf(':')
      , event
      , match
      , exec

    if (c < 0)
      return

    event = rule.substring(0, c)

    rule = rule.substring(c + 1)
    c = rule.indexOf(':')
    if (c < 0)
      return

    match = rule.substring(0, c)
    exec = rule.substring(c + 1)

    return event && match && exec && {
        event : event
      , match : match
      , exec  : exec
    }
  }).filter(Boolean)
}


function createServer (options) {
  if (options.port === undefined)
    throw new TypeError('must provide a \'port\' option')

  if (!Array.isArray(options.rules))
    options.rules = []

  var server    = http.createServer()
    , handler   = createHandler(options)
    , logStream = options.log && fs.createWriteStream(options.log)

  server.webhookHandler = handler

  server.on('request', function (req, res) {
    serverDebug('Connection from '
        + req.socket.address().address
        + ':'
        + req.socket.address().port
    )

    handler(req, res, function (err) {
      function response (code, msg) {

        var address = req.socket.address()
        serverDebug('Response to %s:%s: %d "%s"'
            , address ? address.address : 'unknown'
            , address ? address.port : '??'
            , code
            , msg
        )

        res.writeHead(code, { 'content-type': 'text/json' })
        res.end(JSON.stringify({ error: msg }))
      }

      if (err)
        return response(500, 'Internal server error: ' + err.message)

      response(404, 'Resource not found on this server')
    })
  })

  handler.on('error', function (err) {
    eventsDebug('Non-fatal error: ' + JSON.stringify(err.message))
  })

  eventKeys.forEach(function (key) {
    handler.on(key, function (event) {
      eventsDebug(JSON.stringify(event))
      handleRules(logStream, options.rules, event)
    })
  })

  return server
}


function prefixStream (stream, prefix) {
  return stream.pipe(split2()).pipe(through2(function (data, enc, callback) {
    callback(null, prefix + data + '\n')
  }))
}


function handleRules (logStream, rules, event) {
  function executeRule (rule, payload) {
    if (rule.executing === true) {
      rule.queued = true // we're busy working on this rule, queue up another run
      return
    }

    rule.executing = true

    var startTs = Date.now()
      , eventStr = 'event="'
          + rule.event
          + '", match="'
          + rule.match
          + '", exec="'
          + rule.exec
          + '"'
      , exec = Array.isArray(rule.exec) ? rule.exec : [ 'sh', '-c', rule.exec ]
      , cp

    eventsDebug('Matched rule for %s', eventStr)

    var addEnvProperties = ['ref'];
    for(prop in payload) {
        if (addEnvProperties.indexOf(prop) !== -1) {
            Object.defineProperty(process.env, 'gw_' + prop, {value: payload[prop]})
        }
    }

    cp = spawn(exec.shift(), exec, { env: process.env })
    
    cp.on('error', function (err) {
      return eventsDebug('Error executing command [%s]: %s', rule.exec, err.message)
    })

    cp.on('close', function (code) {
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

  rules.forEach(function (rule) {
    if (rule.event != '*' && rule.event != event.event)
      return

    if (!matchme(event.payload, rule.match))
      return

    executeRule(rule, event.payload)
  })
}


module.exports = createServer
