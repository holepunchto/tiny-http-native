const stream = require('streamx')
const { EventEmitter } = require('events')
const b4a = require('b4a')
const binding = require('./binding')

const STATUS_CODES = new Map([
  [100, 'Continue'],
  [101, 'Switching Protocols'],
  [102, 'Processing'],
  [200, 'OK'],
  [201, 'Created'],
  [202, 'Accepted'],
  [203, 'Non Authoritative Information'],
  [204, 'No Content'],
  [205, 'Reset Content'],
  [206, 'Partial Content'],
  [207, 'Multi-Status'],
  [300, 'Multiple Choices'],
  [301, 'Moved Permanently'],
  [302, 'Moved Temporarily'],
  [303, 'See Other'],
  [304, 'Not Modified'],
  [305, 'Use Proxy'],
  [307, 'Temporary Redirect'],
  [308, 'Permanent Redirect'],
  [400, 'Bad Request'],
  [401, 'Unauthorized'],
  [402, 'Payment Required'],
  [403, 'Forbidden'],
  [404, 'Not Found'],
  [405, 'Method Not Allowed'],
  [406, 'Not Acceptable'],
  [407, 'Proxy Authentication Required'],
  [408, 'Request Timeout'],
  [409, 'Conflict'],
  [410, 'Gone'],
  [411, 'Length Required'],
  [412, 'Precondition Failed'],
  [413, 'Request Entity Too Large'],
  [414, 'Request-URI Too Long'],
  [415, 'Unsupported Media Type'],
  [416, 'Requested Range Not Satisfiable'],
  [417, 'Expectation Failed'],
  [418, 'I\'m a teapot'],
  [419, 'Insufficient Space on Resource'],
  [420, 'Method Failure'],
  [421, 'Misdirected Request'],
  [422, 'Unprocessable Entity'],
  [423, 'Locked'],
  [424, 'Failed Dependency'],
  [428, 'Precondition Required'],
  [429, 'Too Many Requests'],
  [431, 'Request Header Fields Too Large'],
  [451, 'Unavailable For Legal Reasons'],
  [500, 'Internal Server Error'],
  [501, 'Not Implemented'],
  [502, 'Bad Gateway'],
  [503, 'Service Unavailable'],
  [504, 'Gateway Timeout'],
  [505, 'HTTP Version Not Supported'],
  [507, 'Insufficient Storage'],
  [511, 'Network Authentication Required']
])

class Socket extends stream.Writable {
  constructor (server, id) {
    super()

    const buf = b4a.alloc(binding.sizeof_tiny_http_connection_t + binding.sizeof_uv_write_t + binding.sizeof_uv_shutdown_t)
    let pos = 0

    this.id = id
    this.server = server

    this.handle = buf.subarray(0, pos += binding.sizeof_tiny_http_connection_t)
    this.writeRequest = buf.subarray(pos, pos += binding.sizeof_uv_write_t)
    this.shutdownRequest = buf.subarray(pos, pos += binding.sizeof_uv_shutdown_t)

    this.callback = null

    this.view = new Uint32Array(this.handle.buffer, this.handle.byteOffset + binding.offsetof_tiny_http_connection_t_id, 1)
    this.view[0] = id

    this.buffer = null
    this.requests = new Set()
  }

  _writev (datas, callback) {
    this.callback = callback
    binding.tiny_http_connection_write(this.handle, this.writeRequest, datas)
  }

  _final (callback) {
    this.callback = callback
    binding.tiny_http_connection_shutdown(this.handle, this.shutdownRequest)
  }

  _destroy (callback) {
    for (const req of this.requests) req.destroy()
    this.callback = callback
    binding.tiny_http_connection_close(this.handle)
  }

  oncallback (status) {
    const callback = this.callback
    if (callback === null) return
    this.callback = null
    callback(status !== 0 ? new Error('Socket destroyed') : null)
  }

  ondata (data) {
    if (this.buffer !== null) {
      this.buffer = b4a.concat([this.buffer, data])
    } else {
      this.buffer = data
    }

    let hits = 0

    for (let i = 0; i < this.buffer.byteLength; i++) {
      const b = this.buffer[i]

      if (hits === 0 && b === 13) {
        hits++
      } else if (hits === 1 && b === 10) {
        hits++
      } else if (hits === 2 && b === 13) {
        hits++
      } else if (hits === 3 && b === 10) {
        hits = 0

        const head = this.buffer.subarray(0, i + 1)
        this.buffer = i + 1 === this.buffer.byteLength ? null : this.buffer.subarray(i + 1)
        this.onrequest(head)

        if (this.buffer === null) break
      } else {
        hits = 0
      }
    }
  }

  onrequest (head) {
    const r = b4a.toString(head).trim().split('\r\n')

    if (r.length === 0) return this.destroy()

    const [method, url] = r[0].split(' ')
    if (!method || !url) return this.destroy()

    const headers = {}
    for (let i = 1; i < r.length; i++) {
      const [name, value] = r[i].split(': ')
      headers[name.toLowerCase()] = value
    }

    const req = new Request(this, method, url, headers)
    const res = new Response(this, req, headers.connection === 'close')

    this.requests.add(req)
    req.on('close', () => this.requests.delete(req))

    this.server.emit('request', req, res)
  }
}

module.exports = class Server extends EventEmitter {
  constructor (onrequest) {
    super()

    this.buffer = b4a.allocUnsafe(65536)
    this.handle = b4a.alloc(binding.sizeof_tiny_http_t)
    this.host = null
    this.port = 0
    this.closing = false

    this.connections = []

    binding.tiny_http_init(this.handle, this.buffer, this,
      this._onconnection,
      this._onread,
      this._onwrite,
      this._onclose,
      this._onserverclose
    )

    if (onrequest) this.on('request', onrequest)
  }

  _onconnection () {
    const id = this.connections.push(null) - 1
    const c = new Socket(this, id)

    this.connections[c.id] = c

    c.on('error', noop)
    c.on('close', () => {
      const last = this.connections.pop()
      if (last !== c) this.connections[last.view[0] = last.id = c.id] = last
      else if (this.closing && this.connections.length === 0) binding.tiny_http_close(this.handle)
    })

    this.emit('connection', c)

    return c.handle
  }

  _onread (id, read) {
    const c = this.connections[id]

    if (read < 0) c.destroy()
    else if (read === 0 && c.requests.size === 0) c.destroy()
    else if (read > 0) c.ondata(this.buffer.subarray(0, read))
  }

  _onwrite (id, status) {
    const c = this.connections[id]

    c.oncallback(status)
  }

  _onclose (id) {
    const c = this.connections[id]

    c.oncallback(0)
  }

  _onserverclose () {
    this.host = null
    this.port = null
    this.emit('close')
  }

  static createServer (onrequest) {
    return new Server(onrequest)
  }

  close (onclose) {
    if (onclose) this.once('close', onclose)
    if (this.closing) return
    this.closing = true
    if (this.connections.length === 0) binding.tiny_http_close(this.handle)
  }

  address () {
    if (!this.host) throw new Error('Server is not bound')

    return { address: this.host, family: 'IPv4', port: this.port }
  }

  listen (port, host, onlistening) {
    if (typeof port === 'function') return this.listen(0, null, port)
    if (typeof host === 'function') return this.listen(port, null, host)

    if (this.host) throw new Error('Server is already bound')
    if (this.closing) throw new Error('Server is closed')

    if (onlistening) this.once('listening', onlistening)

    if (!host) host = '0.0.0.0'

    try {
      this.port = binding.tiny_http_bind(this.handle, port, host)
      this.host = host
    } catch (err) {
      queueMicrotask(() => {
        if (!this.closing) this.emit('error', err) // silly but node compat
      })

      return this
    }

    queueMicrotask(() => {
      if (this.host) this.emit('listening')
    })

    return this
  }
}

class Request extends stream.Readable {
  constructor (socket, method, url, headers) {
    super()

    this.method = method
    this.url = url
    this.headers = headers
    this.socket = socket
    this.push(null)
  }

  getHeader (name) {
    return this.headers[name.toLowerCase()]
  }

  _predestroy () {
    this.socket.destroy()
  }
}

class Response extends stream.Writable {
  constructor (socket, request, close) {
    super()

    this.statusCode = 200
    this.headers = {}
    this.socket = socket
    this.request = request
    this.headersFlushed = false
    this.chunked = true
    this.close = close
    this.ondrain = null
    this.onlyHeaders = this.request.method === 'HEAD'

    socket.on('drain', () => this._writeContinue())
  }

  writeHead (statusCode, headers) {
    this.statusCode = statusCode
    if (typeof headers === 'object') {
      for (const name in headers) this.setHeader(name, headers[name])
    }
    this.flushHeaders()
  }

  _writeContinue () {
    const ondrain = this.ondrain
    if (ondrain === null) return
    this.ondrain = null
    ondrain(null)
  }

  _predestroy () {
    this.request.destroy()
    this.socket.destroy()
    this._writeContinue()
  }

  _write (data, callback) {
    if (this.headersFlushed === false) this.flushHeaders()
    if (this.onlyHeaders === true) return callback(null)

    if (typeof data === 'string') data = b4a.from(data)

    if (this.chunked) {
      data = b4a.concat([
        b4a.from('' + data.byteLength.toString(16) + '\r\n'),
        data,
        b4a.from('\r\n')
      ])
    }

    if (this.socket.write(data) === false) {
      this.ondrain = callback
      return
    }

    callback(null)
  }

  _final (callback) {
    if (this.headersFlushed === false) this.flushHeaders()

    if (this.chunked && this.onlyHeaders === false) this.socket.write(b4a.from('0\r\n\r\n'))
    if (this.close) this.socket.end()

    callback(null)
  }

  setHeader (name, value) {
    this.headers[name.toLowerCase()] = value
  }

  getHeader (name) {
    return this.headers[name.toLowerCase()]
  }

  flushHeaders () {
    if (this.headersFlushed === true) return

    let h = 'HTTP/1.1 ' + this.statusCode + ' ' + STATUS_CODES.get(this.statusCode) + '\r\n'
    for (const name of Object.keys(this.headers)) {
      const n = name.toLowerCase()
      const v = this.headers[name]

      if (n === 'content-length') this.chunked = false
      if (n === 'connection' && v === 'close') this.close = true

      h += httpCase(n) + ': ' + v + '\r\n'
    }
    if (this.chunked) h += 'Transfer-Encoding: chunked\r\n'
    h += '\r\n'

    this.socket.write(b4a.from(h))
    this.headersFlushed = true
  }
}

function httpCase (n) {
  let s = ''
  for (const part of n.split('-')) {
    s += (s ? '-' : '') + part.slice(0, 1).toUpperCase() + part.slice(1)
  }
  return s
}

function noop () {}
