const http = require('./')

const server = http.createServer(function (req, res) {
  res.statusCode = 200
  res.setHeader('Content-Length', 11)
  res.write('hello world!')
  res.end()
})

server.listen(0, function () {
  console.log('server is bound on', server.address().port)
})
