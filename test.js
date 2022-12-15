const test = require('brittle')
const { createServer } = require('./')
const http = require('http')
const b4a = require('b4a')

test('basic', async function (t) {
  t.plan(43)

  const server = createServer()
  t.is(server.host, null)
  t.is(server.port, 0)
  t.is(server.closing, false)
  t.is(server.connections.length, 0)

  server.on('listening', function () {
    t.pass('server listening')
  })

  server.on('connection', function (socket) {
    t.is(server.connections.length, 1)

    t.ok(socket)
    t.is(typeof socket.id, 'number')
    t.is(socket.server, server)
    t.is(socket.requests.size, 0)

    socket.on('close', () => {
      t.is(server.connections.length, 0)
      t.pass('server socket closed')
    })

    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    t.ok(req)
    t.is(req.method, 'GET')
    t.is(req.url, '/something/?key1=value1&key2=value2&enabled')
    t.alike(req.headers, { host: server.address().address + ':' + server.address().port, connection: 'close' })
    t.alike(req.getHeader('connection'), 'close')
    t.alike(req.getHeader('Connection'), 'close')
    t.ok(req.socket)
    t.is(req.socket.requests.size, 1)

    t.ok(res)
    t.is(res.statusCode, 200, 'default status code')
    t.alike(res.headers, {})
    t.ok(res.socket)
    t.is(res.request, req) // + should req also have req.response?
    t.is(res.headersFlushed, false, 'headers not flushed')
    t.is(res.chunked, true, 'chunked by default')
    t.is(res.onlyHeaders, false)

    t.is(req.socket, res.socket)
    t.is(server.connections[req.socket.id], req.socket)

    res.setHeader('Content-Length', 12)
    t.alike(res.headers, { 'content-length': 12 })
    t.is(res.getHeader('content-length'), 12)
    t.is(res.getHeader('Content-Length'), 12)

    res.end('Hello world!')

    req.on('close', function () {
      t.pass('server request closed')
    })

    res.on('close', function () {
      t.is(res.headersFlushed, true, 'headers flushed')
      t.is(res.chunked, false, 'not chunked')
      t.pass('server response closed')
    })
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/something/?key1=value1&key2=value2&enabled'
  }, function (res) {
    t.is(res.statusCode, 200)

    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => {
      const body = b4a.concat(chunks)
      t.alike(body, b4a.from('Hello world!'), 'client response ended')
    })
  })

  req.on('close', () => {
    t.pass('request closed')

    t.is(server.closing, false)
    server.close()
    t.is(server.closing, true)

    server.on('close', function () {
      t.pass('server closed')
    })
  })

  req.on('error', (err) => t.fail('client req error: ' + err.message + ' (' + err.code + ')'))

  req.end()
})

test('port already in use', async function (t) {
  t.plan(2)

  const server = createServer()
  server.listen(0)
  await waitForServer(server)

  const server2 = createServer()
  server2.listen(server.address().port)

  server2.on('error', function (err) {
    t.is(err.code, 'EADDRINUSE')

    server.close()
    server.on('close', () => t.pass('original server closed'))
  })
})

// ../deps/uv/src/unix/core.c:178: uv_close: Assertion `0' failed
// Aborted (core dumped)
/* test.solo('destroy socket', async function (t) {
  t.plan(99)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.destroy()

    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    t.fail('server should not receive request')
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.fail('client should not receive a response')
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.is(err.code, 'ECONNRESET', 'client socket hang up'))

  req.end()
}) */

test('destroy request', async function (t) {
  t.plan(5)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    // res.end()
    req.destroy()

    req.on('close', () => t.pass('server request closed'))
    // res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.fail('client should not receive a response')
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.is(err.code, 'ECONNRESET', 'client socket hang up'))

  req.end()
})

test('destroy response', async function (t) {
  t.plan(6)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    res.destroy()

    req.on('close', () => t.pass('server request closed'))
    res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.fail('client should not receive a response')
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.is(err.code, 'ECONNRESET', 'client socket hang up'))

  req.end()
})

test('write head', async function (t) {
  t.plan(7)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    res.writeHead(404) // + should set content-length to zero?
    res.end()

    req.on('close', () => t.pass('server request closed'))
    res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.is(res.statusCode, 404)

    res.on('data', () => t.fail('client should not receive data'))
    res.on('end', () => t.pass('client response ended'))
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.fail('client req error: ' + err.message + ' (' + err.code + ')'))

  req.end()
})

test('write head with headers', async function (t) {
  t.plan(9)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    res.writeHead(404, { 'x-custom': 1234 }) // + should set content-length to zero? otherwise the client receives "transfer-enconding: chunked"
    res.end()

    req.on('close', () => t.pass('server request closed'))
    res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.is(res.statusCode, 404)

    const customHeader = res.rawHeaders.indexOf('X-Custom')
    t.is(res.rawHeaders[customHeader], 'X-Custom')
    t.is(res.rawHeaders[customHeader + 1], '1234')

    res.on('data', () => t.fail('client should not receive data'))
    res.on('end', () => t.pass('client response ended'))
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.fail('client req error: ' + err.message + ' (' + err.code + ')'))

  req.end()
})

test('chunked', async function (t) {
  t.plan(9)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => t.fail('server socket error: ' + err.message + ' (' + err.code + ')'))
  })

  server.on('request', function (req, res) {
    res.write('part 1 + ')
    setImmediate(() => {
      res.end('part 2')
    })

    t.is(res.chunked, true, 'chunked by default')
    res.on('close', () => {
      t.is(res.chunked, true, 'still chunked')
    })

    req.on('close', () => t.pass('server request closed'))
    res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.is(res.statusCode, 200)

    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => {
      const body = b4a.concat(chunks)
      t.alike(body, b4a.from('part 1 + part 2'), 'client response ended')
    })
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.fail('client req error: ' + err.message + ' (' + err.code + ')'))

  req.end()
})

// + solo this test and it would randomly fail
test('server does a big write', async function (t) {
  t.plan(7)

  const server = createServer()
  server.on('close', () => t.pass('server closed'))

  server.on('connection', function (socket) {
    socket.on('close', () => t.pass('server socket closed'))
    socket.on('error', (err) => {
      console.error(err)
      t.fail('server socket error: ' + err.message + ' (' + err.code + ')')
    })
  })

  server.on('request', function (req, res) {
    res.write(b4a.alloc(2 * 1024 * 1024, 'abcd'))
    setImmediate(() => {
      res.end(b4a.alloc(2 * 1024 * 1024, 'efgh'))
    })

    req.on('close', () => t.pass('server request closed'))
    res.on('close', () => t.pass('server response closed'))
  })

  server.listen(0)
  await waitForServer(server)

  const req = http.request({
    method: 'GET',
    host: server.address().address,
    port: server.address().port,
    path: '/'
  }, function (res) {
    t.is(res.statusCode, 200)

    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => {
      const body = b4a.concat(chunks)
      const expected = b4a.concat([b4a.alloc(2 * 1024 * 1024, 'abcd'), b4a.alloc(2 * 1024 * 1024, 'efgh')])
      t.alike(body, expected, 'client response ended')
    })
  })

  req.on('close', () => {
    t.pass('client request closed')
    server.close()
  })

  req.on('error', (err) => t.fail('client req error: ' + err.message + ' (' + err.code + ')'))

  req.end()
})

/* function listen (server) {
  return new Promise(resolve => server.listen(0, resolve))
} */

function waitForServer (server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done)
    server.on('error', done)

    function done (error) {
      server.removeListener('listening', done)
      server.removeListener('error', done)
      error ? reject(error) : resolve()
    }
  })
}
