import { createServer as createHttpServer } from 'node:http';

// Stub: the real server will serve the static frontend from `publicDir` for
// everything outside `/api/*`, and forward `/api/<rest>` to
// `${apiUrl}/<rest>` using `agent` for the outbound connection (tests inject
// an agent that redirects to a Unix socket; production leaves it undefined
// so Node's default agent makes a real TCP connection to `apiUrl`).
// Not implemented yet: every request gets a 501 placeholder response.
export async function createServer({ apiUrl, agent, publicDir } = {}) {
  return createHttpServer((req, res) => {
    const body = JSON.stringify({ error: 'Not implemented.' });
    res.writeHead(501, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  });
}
