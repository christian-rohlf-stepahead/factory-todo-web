import { createServer as createHttpServer } from 'node:http';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Serves the static frontend from `publicDir` for everything outside
// `/api/*`, and forwards `/api/<rest>` to `${apiUrl}/<rest>` (method, body
// and status unchanged), using `agent` for the outbound connection so the
// browser never talks to the API's host directly (AC5). Tests inject an
// agent that redirects to a Unix socket; production leaves it undefined so
// Node's default agent makes a real TCP connection to `apiUrl`.
export async function createServer({ apiUrl, agent, publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  // node:http's Agent only honours a `createConnection` passed as a
  // constructor option if it's also copied onto the instance — the
  // constructor itself never does this (it only reads pooling settings like
  // `keepAlive`), so an injected test agent's override would silently never
  // run without this.
  if (agent && typeof agent.options?.createConnection === 'function') {
    agent.createConnection = agent.options.createConnection;
  }
  return createHttpServer((req, res) => {
    const url = new URL(req.url, 'http://todo-web.local');
    if (url.pathname.startsWith('/api/')) {
      proxyToApi(req, res, { apiUrl, agent, url });
      return;
    }
    serveStatic(req, res, { publicDir, url });
  });
}

function proxyToApi(req, res, { apiUrl, agent, url }) {
  const target = new URL(apiUrl.replace(/\/$/, '') + url.pathname.slice('/api'.length) + url.search);
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: target.host };
    if (body.length) headers['content-length'] = body.length;
    else delete headers['content-length'];

    const proxyReq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers,
        agent,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      const message = JSON.stringify({ error: 'Bad gateway' });
      res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(message) });
      res.end(message);
    });
    if (body.length) proxyReq.write(body);
    proxyReq.end();
  });
}

async function serveStatic(req, res, { publicDir, url }) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(publicDir, pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType });
    res.end(data);
  } catch {
    const message = JSON.stringify({ error: 'Not found.' });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(message);
  }
}
