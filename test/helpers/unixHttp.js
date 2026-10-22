import { createServer as createHttpServer } from 'node:http';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// This sandbox's network namespace accepts a TCP loopback connect() but does
// not deliver data over it, so every server here listens on a Unix domain
// socket instead of a TCP port, and every outbound call — whether the test's
// own client or the web server's proxy to the "upstream" API — is routed
// over a socket the same way. http.Server.listen()/http.request() are
// transport-agnostic, so this exercises the exact same code a TCP client and
// a TCP upstream would.

export async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), 'todo-web-test-'));
}

// Listens an already-constructed http.Server (e.g. from `createServer()`) on
// a fresh Unix socket.
export async function listenUnixServer(server) {
  const dir = await makeTempDir();
  const socketPath = path.join(dir, 'server.sock');
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function startUnixServer(requestListener) {
  return listenUnixServer(createHttpServer(requestListener));
}

export function unixRequest(socketPath, { method = 'GET', path: reqPath, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path: reqPath,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
          : headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// An http.Agent that redirects every outbound connection to a Unix socket,
// regardless of the host/port in the request URL. Lets `createServer`'s
// proxy code use a plain `http://<host>/<path>` URL — exactly as it does in
// production against `TODO_API_URL` — while tests point it at a fake
// upstream API listening on a socket instead of a real TCP host.
export function unixAgent(socketPath) {
  return new http.Agent({
    createConnection(options, callback) {
      const socket = net.createConnection(socketPath);
      socket.once('connect', () => callback(null, socket));
      socket.once('error', (err) => callback(err));
    },
  });
}

// A `fetch`-compatible function that routes every call over a Unix socket
// instead of the network, for driving a page's own script (e.g. inside
// jsdom) against a real server running in this sandbox.
export function createUnixFetch(socketPath) {
  return async function fetchViaSocket(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const res = await unixRequest(socketPath, {
      method: init.method || 'GET',
      path,
      body: init.body,
      headers: init.headers || {},
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.json(),
      text: async () => res.text,
    };
  };
}

// A fake "upstream" todo API: records every request it receives and replies
// using `handler(req, body)` (`body` already parsed from JSON, or `{}`).
export async function startFakeApi(handler) {
  const received = [];
  const { socketPath, close } = await startUnixServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : {};
    received.push({ method: req.method, url: req.url, body });
    const { status, body: resBody } = await handler({ method: req.method, url: req.url, body });
    if (resBody === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    const data = JSON.stringify(resBody);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
    res.end(data);
  });
  return { socketPath, agent: unixAgent(socketPath), received, close };
}
