# tiny-http-native

Tiny HTTP library made purely on libuv and napi.

```
npm install tiny-http-native
```

Useful for embedded devices that only have n-api but not node.

Only HTTP servers at the moment and current does NOT support server request bodies,
but supports most other HTTP features (keep-alive, chunked encoding etc)
and streaming server responses.

## Usage

``` js
const http = require('tiny-http-native')

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
