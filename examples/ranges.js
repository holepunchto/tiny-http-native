const http = require('../')
const parseRange = require('range-parser')
const pump = require('pump')
const mime = require('mime-types')
const fs = require('fs')

const path = process.argv[2] // pass the filename to host
const { size } = fs.statSync(path)

const server = http.createServer(function (req, res) {
  console.log(req.method, req.url, req.headers)

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', mime.lookup(path))

  const range = req.headers.range && parseRange(size, req.headers.range)[0]
  let stream = null

  if (range) {
    const opts = { start: range.start, end: range.end }

    res.statusCode = 206
    res.setHeader(
      'Content-Range',
      'bytes ' + range.start + '-' + range.end + '/' + size
    )
    res.setHeader('Content-Length', range.end - range.start + 1)

    stream = fs.createReadStream(path, opts)
  } else {
    res.statusCode = 200
    res.setHeader('Content-Length', size)

    stream = fs.createReadStream(path)
  }

  pump(stream, res, err => {
    console.log('pump done', err)
  })
})

server.on('connection', function (socket) {
  console.log('got socket', server.connections.length)
  socket.on('close', function () {
    console.log('closed socket', server.connections.length)
  })
})

server.listen(9090, '127.0.0.1', function () {
  console.log(server.address())
})
