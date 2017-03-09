const test      = require('tape')
    , fs        = require('fs')
    , crypto    = require('crypto')
    , supertest = require('supertest')
    , webhook   = require('./')


function signBlob (key, blob) {
  return 'sha1=' + crypto.createHmac('sha1', key).update(blob).digest('hex')
}


test('invalid url gets 404', function (t) {
  t.plan(1)

  var options = { port: 0, path: '/webhook', secret: 'foofaa' }
    , server  = webhook(options)

  supertest(server)
    .get('/')
    .expect('Content-Type', /json/)
    .expect(404)
    .end(function(err){
      t.error(err)
    })

})


test('valid url, incomplete data gets 400', function (t) {
  t.plan(1)

  var options = { port: 0, path: '/webhook', secret: 'foofaa' }
    , server  = webhook(options)

  supertest(server)
    .get('/webhook')
    .expect('Content-Type', /json/)
    .expect(400)
    .end(function(err){
      t.error(err)
    })

})


test('valid url, complete data gets 200', function (t) {
  t.plan(2)

  var options   = { port: 0, path: '/webhook', secret: 'foofaa' }
    , server    = webhook(options)
    , obj       = { some: 'github', object: 'with', properties: true }
    , json      = JSON.stringify(obj)
    , id        = '123abc'
    , eventType = 'issues'

  server.webhookHandler.on(eventType, function (event) {
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
    .end(function(err){
      t.error(err)
    })

})


test('valid request triggers rule', function (t) {
  t.plan(5)

  var tmpfile   = __dirname + '/__test_data.' + Math.random()
    , eventType = 'issues'
    , options   = {
          port   : 0
        , path   : '/webhook'
        , secret : 'foofaa'
        , rules  : [
              {   // should not trigger this event
                  event : eventType
                , match : 'some == xxgithub'
                , exec  : [ 'sh', '-c', 'echo "w00t!" > ' + tmpfile + '2' ]
              }
            , {   // should trigger this event
                  event : eventType
                , match : 'some == github'
                , exec  : 'echo "w00t!" > ' + tmpfile
              }
          ]
      }
    , server    = webhook(options)
    , obj       = { some: 'github', object: 'with', properties: true }
    , json      = JSON.stringify(obj)
    , id        = '123abc'

  t.on('end', function () {
    fs.unlink(tmpfile, function () {})
  })

  server.webhookHandler.on(eventType, function (event) {
    t.deepEqual(event, { event: eventType, id: id, payload: obj, url: '/webhook' })
    setTimeout(function () {
      fs.readFile(tmpfile, 'utf8', function (err, data) {
        t.error(err)
        t.equal(data, 'w00t!\n')
      })
      fs.exists(tmpfile + '2', function (exists) {
        t.notOk(exists, 'does not exist, didn\'t trigger second event')
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
    .end(function(err){
      t.error(err)
    })

})

test('valid request triggers rule 2', function (t) {
  t.plan(5)

  var tmpfile   = __dirname + '/__test_data.' + Math.random()
    , eventType = 'issues'
    , options   = {
          port   : 0
        , path   : '/webhook'
        , secret : 'foofaa'
        , rules  : [
              {   // should not trigger this event
                  event : eventType
                , match : 'some == xxgithub'
                , exec  : [ 'sh', '-c', 'echo "w00t!" > ' + tmpfile + '2' ]
              }
            , {   // should trigger this event
                  event : eventType
                , match : 'some == github'
                , exec  : 'echo $some > ' + tmpfile
              }
          ]
      }
    , server    = webhook(options)
    , obj       = {ref: 'refs/heads/master', before: 'a250b47f054d1d2d4a5ce484635c8b4b365c5d36', after: 'b411c26d3db3df0eb24027cace219f3ceaeb1c3b', compare: 'https://github.com/AttestationLegale/site-bo/compare/a250b47f054d...b411c26d3db3'}
    , json      = JSON.stringify(obj)
    , id        = '123abc'

  t.on('end', function () {
    fs.unlink(tmpfile, function () {})
  })

  server.webhookHandler.on(eventType, function (event) {
    t.deepEqual(event, { event: eventType, id: id, payload: obj, url: '/webhook' })
    setTimeout(function () {
      fs.readFile(tmpfile, 'utf8', function (err, data) {
        t.error(err)
        t.equal(data, 'github\n')
      })
      fs.exists(tmpfile + '2', function (exists) {
        t.notOk(exists, 'does not exist, didn\'t trigger second event')
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
    .end(function(err){
      t.error(err)
    })

})
