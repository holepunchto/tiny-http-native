#include <napi-macros.h>
#include <node_api.h>
#include <uv.h>

#ifdef _WIN32
#include <winsock.h>
#include <stdlib.h>
#endif

#define TINY_HTTP_THROW(err) \
  { \
    napi_throw_error(env, uv_err_name(err), uv_strerror(err)); \
    return NULL; \
  }

#define TINY_HTTP_CALLBACK(self, fn, src) \
  napi_env env = self->env; \
  napi_handle_scope scope; \
  napi_open_handle_scope(env, &scope); \
  napi_value ctx; \
  napi_get_reference_value(env, self->ctx, &ctx); \
  napi_value callback; \
  napi_get_reference_value(env, fn, &callback); \
  src \
  napi_close_handle_scope(env, scope);

typedef struct {
  uv_tcp_t tcp;

  napi_env env;
  napi_ref ctx;
  napi_ref on_connection;
  napi_ref on_read;
  napi_ref on_write;
  napi_ref on_close;
  napi_ref on_server_close;

  char *read_buf;
  size_t read_buf_len;
} tiny_http_t;

typedef struct {
  uv_tcp_t tcp;
  tiny_http_t *server;
  uint32_t id;
} tiny_http_connection_t;

static void
alloc_buffer (uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  tiny_http_connection_t *c = (tiny_http_connection_t *) handle;
  tiny_http_t *self = c->server;

  buf->base = self->read_buf;
  buf->len = self->read_buf_len;
}

static void
on_connection_close (uv_handle_t *handle) {
  tiny_http_connection_t *c = (tiny_http_connection_t *) handle;
  tiny_http_t *self = c->server;

  TINY_HTTP_CALLBACK(self, self->on_close, {
    napi_value argv[1];

    napi_create_uint32(env, c->id, &(argv[0]));

    if (napi_make_callback(env, NULL, ctx, callback, 1, argv, NULL) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    }
  })
}

static void
on_server_close (uv_handle_t *handle) {
  tiny_http_t *self = (tiny_http_t *) handle;

  TINY_HTTP_CALLBACK(self, self->on_server_close, {
    if (napi_make_callback(env, NULL, ctx, callback, 0, NULL, NULL) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    }

    napi_delete_reference(env, self->on_connection);
    napi_delete_reference(env, self->on_read);
    napi_delete_reference(env, self->on_write);
    napi_delete_reference(env, self->on_close);
    napi_delete_reference(env, self->on_server_close);

    napi_delete_reference(env, self->ctx);
  })
}

static void
on_write (uv_write_t *req, int status) {
  tiny_http_connection_t *c = (tiny_http_connection_t *) req->data;
  tiny_http_t *self = c->server;

  TINY_HTTP_CALLBACK(self, self->on_write, {
    napi_value argv[2];

    napi_create_uint32(env, c->id, &(argv[0]));
    napi_create_int32(env, status, &(argv[1]));

    if (napi_make_callback(env, NULL, ctx, callback, 2, argv, NULL) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    }
  })
}

static void
on_shutdown (uv_shutdown_t *req, int status) {
  tiny_http_connection_t *c = (tiny_http_connection_t *) req->data;
  tiny_http_t *self = c->server;

  TINY_HTTP_CALLBACK(self, self->on_write, {
    napi_value argv[2];

    napi_create_uint32(env, c->id, &(argv[0]));
    napi_create_int32(env, status, &(argv[1]));

    if (napi_make_callback(env, NULL, ctx, callback, 2, argv, NULL) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    }
  })
}

static void
on_read (uv_stream_t *client, ssize_t nread, const uv_buf_t *buf) {
  tiny_http_connection_t *c = (tiny_http_connection_t *) client;
  tiny_http_t *self = (tiny_http_t *) c->server;

  if (nread == 0) return;

  TINY_HTTP_CALLBACK(self, self->on_read, {
    napi_value argv[2];

    napi_create_uint32(env, c->id, &(argv[0]));
    napi_create_int32(env, nread == UV_EOF ? 0 : (int) nread, &(argv[1]));

    if (napi_make_callback(env, NULL, ctx, callback, 2, argv, NULL) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    }
  })
}

static void
on_new_connection (uv_stream_t *server, int status) {
  if (status < 0) return; // TODO: mb bubble up?

  tiny_http_t *self = (tiny_http_t *) server;

  uv_loop_t *loop;
  napi_get_uv_event_loop(self->env, &loop);

  TINY_HTTP_CALLBACK(self, self->on_connection, {
    napi_value res;

    if (napi_make_callback(env, NULL, ctx, callback, 0, NULL, &res) == napi_pending_exception) {
      napi_value fatal_exception;
      napi_get_and_clear_last_exception(env, &fatal_exception);
      napi_fatal_exception(env, fatal_exception);
    } else {
      tiny_http_connection_t *client;
      size_t client_size;

      napi_get_buffer_info(env, res, (void **) &client, &client_size);

      uv_tcp_init(loop, (uv_tcp_t *) client);
      client->server = self;

      if (uv_accept(server, (uv_stream_t *) client) == 0) {
        uv_read_start((uv_stream_t *) client, alloc_buffer, on_read);
      }
      else {
        // Just simple error handling...
        uv_close((uv_handle_t*) client, NULL);
      }
    }
  })
}

NAPI_METHOD(tiny_http_init) {
  NAPI_ARGV(8)
  NAPI_ARGV_BUFFER_CAST(tiny_http_t *, self, 0)
  NAPI_ARGV_BUFFER(read_buf, 1)

  self->env = env;

  uv_loop_t *loop;
  napi_get_uv_event_loop(env, &loop);

  uv_tcp_init(loop, &(self->tcp));

  self->read_buf = read_buf;
  self->read_buf_len = read_buf_len;

  napi_create_reference(env, argv[2], 1, &(self->ctx));
  napi_create_reference(env, argv[3], 1, &(self->on_connection));
  napi_create_reference(env, argv[4], 1, &(self->on_read));
  napi_create_reference(env, argv[5], 1, &(self->on_write));
  napi_create_reference(env, argv[6], 1, &(self->on_close));
  napi_create_reference(env, argv[7], 1, &(self->on_server_close));

  return NULL;
}

NAPI_METHOD(tiny_http_bind) {
  NAPI_ARGV(3)
  NAPI_ARGV_BUFFER_CAST(tiny_http_t *, self, 0)
  NAPI_ARGV_UINT32(port, 1)
  NAPI_ARGV_UTF8(ip, 17, 2)

  int err;

  struct sockaddr_storage addr;
  int addr_len = sizeof(struct sockaddr_in);
  err = uv_ip4_addr(ip, port, (struct sockaddr_in *) &addr);
  if (err < 0) TINY_HTTP_THROW(err)

  err = uv_tcp_bind(&(self->tcp), (struct sockaddr *) &addr, 0);
  if (err < 0) TINY_HTTP_THROW(err)

  struct sockaddr_storage name;

  err = uv_tcp_getsockname(&(self->tcp), (struct sockaddr *) &name, &addr_len);
  if (err < 0) TINY_HTTP_THROW(err)

  int local_port = ntohs(((struct sockaddr_in *) &name)->sin_port);

  err = uv_listen((uv_stream_t*) &(self->tcp), 128, on_new_connection);

  NAPI_RETURN_UINT32(local_port)
}

NAPI_METHOD(tiny_http_close) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_http_t *, self, 0)

  uv_close((uv_handle_t *) self, on_server_close);

  return NULL;
}

NAPI_METHOD(tiny_http_connection_write) {
  NAPI_ARGV(3)
  NAPI_ARGV_BUFFER_CAST(tiny_http_connection_t *, c, 0)
  NAPI_ARGV_BUFFER_CAST(uv_write_t *, req, 1)

  napi_value arr = argv[2];
  napi_value item;

  uint32_t nbufs;
  napi_get_array_length(env, arr, &nbufs);

#ifdef _WIN32
  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * nbufs);
#else
  uv_buf_t bufs[nbufs];
#endif

  for (uint32_t i = 0; i < nbufs; i++) {
    napi_get_element(env, arr, i, &item);
    uv_buf_t *buf = &(bufs[i]);
    napi_get_buffer_info(env, item, (void **) &(buf->base), &(buf->len));
  }

  req->data = c;
  uv_write(req, (uv_stream_t *) c, bufs, nbufs, on_write);

#ifdef _WIN32
  free(bufs);
#endif

  return NULL;
}

NAPI_METHOD(tiny_http_connection_shutdown) {
  NAPI_ARGV(2)
  NAPI_ARGV_BUFFER_CAST(tiny_http_connection_t *, c, 0)
  NAPI_ARGV_BUFFER_CAST(uv_shutdown_t *, req, 1)

  req->data = c;
  uv_shutdown(req, (uv_stream_t *) c, on_shutdown);

  return NULL;
}

NAPI_METHOD(tiny_http_connection_close) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_http_connection_t *, c, 0)

  uv_close((uv_handle_t *) c, on_connection_close);

  return NULL;
}

NAPI_INIT() {
  NAPI_EXPORT_SIZEOF(tiny_http_t)
  NAPI_EXPORT_SIZEOF(tiny_http_connection_t)
  NAPI_EXPORT_SIZEOF(uv_write_t)
  NAPI_EXPORT_SIZEOF(uv_shutdown_t)
  NAPI_EXPORT_OFFSETOF(tiny_http_connection_t, id)
  NAPI_EXPORT_FUNCTION(tiny_http_init)
  NAPI_EXPORT_FUNCTION(tiny_http_bind)
  NAPI_EXPORT_FUNCTION(tiny_http_close)
  NAPI_EXPORT_FUNCTION(tiny_http_connection_write)
  NAPI_EXPORT_FUNCTION(tiny_http_connection_shutdown)
  NAPI_EXPORT_FUNCTION(tiny_http_connection_close)
}
