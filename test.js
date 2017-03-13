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
                , exec  : 'echo $gw_ref > ' + tmpfile
              }
          ]
      }
    , server    = webhook(options)
    , obj       = { some: 'github', object: 'with', properties: true, ref: 'refs/heads/dev' }
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
        t.equal(data, 'refs/heads/dev\n')
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