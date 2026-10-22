import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, startFakeApi } from './helpers/unixHttp.js';

const FAKE_API_URL = 'http://todo-api.internal:3000';

async function startWebServer({ agent } = {}) {
  const server = await createServer({ apiUrl: FAKE_API_URL, agent });
  return listenUnixServer(server);
}

test('AC5/AC6: GET /api/tasks is forwarded to TODO_API_URL/tasks and the upstream response is returned unchanged', async (t) => {
  const tasks = [
    { id: '1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'high', tags: ['home'] },
  ];
  const api = await startFakeApi(async ({ method, url }) => {
    assert.equal(method, 'GET');
    assert.equal(url, '/tasks');
    return { status: 200, body: tasks };
  });
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const res = await unixRequest(web.socketPath, { path: '/api/tasks' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), tasks);
  assert.equal(api.received.length, 1);
});

test('AC6: POST /api/tasks forwards the method and body to the upstream API unchanged', async (t) => {
  const created = { id: 'new1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    assert.equal(method, 'POST');
    assert.equal(url, '/tasks');
    assert.deepEqual(body, { title: 'Buy milk' });
    return { status: 201, body: created };
  });
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const res = await unixRequest(web.socketPath, { method: 'POST', path: '/api/tasks', body: { title: 'Buy milk' } });

  assert.equal(res.status, 201);
  assert.deepEqual(res.json(), created);
  assert.equal(api.received.length, 1);
});

test('AC6: PATCH /api/tasks/:id forwards the path and body to the upstream API unchanged', async (t) => {
  const updated = { id: 't1', title: 'Buy milk', completed: true, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    assert.equal(method, 'PATCH');
    assert.equal(url, '/tasks/t1');
    assert.deepEqual(body, { completed: true });
    return { status: 200, body: updated };
  });
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const res = await unixRequest(web.socketPath, {
    method: 'PATCH',
    path: '/api/tasks/t1',
    body: { completed: true },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), updated);
});

test('AC6: DELETE /api/tasks/:id forwards the request to the upstream API and returns its status unchanged', async (t) => {
  const api = await startFakeApi(async ({ method, url }) => {
    assert.equal(method, 'DELETE');
    assert.equal(url, '/tasks/t1');
    return { status: 204, body: undefined };
  });
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const res = await unixRequest(web.socketPath, { method: 'DELETE', path: '/api/tasks/t1' });

  assert.equal(res.status, 204);
  assert.equal(res.text, '');
  assert.equal(api.received.length, 1);
});

test('AC6: a 4xx error response from the upstream API is passed through unchanged', async (t) => {
  const error = { error: 'A non-empty "title" is required.' };
  const api = await startFakeApi(async () => ({ status: 400, body: error }));
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const res = await unixRequest(web.socketPath, { method: 'POST', path: '/api/tasks', body: {} });

  assert.equal(res.status, 400);
  assert.deepEqual(res.json(), error);
});

test('AC5: a request outside /api/ is served locally and never reaches the upstream API', async (t) => {
  const api = await startFakeApi(async () => ({ status: 200, body: [] }));
  t.after(api.close);

  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  await unixRequest(web.socketPath, { path: '/' });

  assert.equal(api.received.length, 0);
});
