# tiny-http-server

Tiny HTTP server made purely on libuv and napi.

```
npm install tiny-http-server
```

Useful for embedded devices that only have napi but not node.

For simplicity reasons it does NOT support request bodies,
but supports most other HTTP features (keep-alive, chunked encoding etc)
and streaming responses.

## Usage

``` js
const http = require('tiny-http-server')

// same api as node

const server = http.createServer(function (req, res) {
  res.statusCode = 200
  res.setHeader('Content-Length', 10)
  res.write('hello world!')
  res.end()
})

server.listen(0, function () {
  console.log('server is bound on', server.address().port)
})
```

## License

MIT
