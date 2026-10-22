import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// These tests drive the real static frontend (served by the web server) and
// its own script inside jsdom — a headless DOM implementation, not a browser
// — so they need neither a browser nor a deployed environment (AC6). The
// page's own `fetch` is pointed at the web server over a Unix socket instead
// of the network, for the same sandbox reason as server.test.js.
//
// This pins the frontend's contract: a `#todo-list` of `<li data-id="...">`
// rows, each with a checkbox to mark done and a `button.delete-btn` to
// delete, plus a `#add-form` with a `#title-input` to add a todo.

const FAKE_API_URL = 'http://todo-api.internal:3000';

async function startWebServer({ agent } = {}) {
  const server = await createServer({ apiUrl: FAKE_API_URL, agent });
  return listenUnixServer(server);
}

function flush(times = 10) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i += 1;
      if (i >= times) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

async function loadPage(webSocketPath) {
  const htmlRes = await unixRequest(webSocketPath, { path: '/' });
  const jsRes = await unixRequest(webSocketPath, { path: '/app.js' });
  const dom = new JSDOM(htmlRes.text, {
    url: 'http://todo-web.local/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  dom.window.fetch = createUnixFetch(webSocketPath);
  dom.window.eval(jsRes.text);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await flush();
  return dom;
}

test('AC1: opening the web app shows every existing todo with its title, done state, priority, tags, and due date', async (t) => {
  const tasks = [
    { id: '1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'high', tags: ['home'] },
    { id: '2', title: 'Write report', completed: true, due: null, priority: 'low', tags: [] },
  ];
  const api = await startFakeApi(async ({ method, url }) => {
    assert.equal(method, 'GET');
    assert.equal(url, '/tasks');
    return { status: 200, body: tasks };
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const list = dom.window.document.querySelector('#todo-list');
  assert.ok(list, 'expected a #todo-list element');

  const first = list.querySelector('li[data-id="1"]');
  assert.ok(first, 'expected the first todo to be rendered');
  assert.match(first.textContent, /Buy milk/);
  assert.match(first.textContent, /high/);
  assert.match(first.textContent, /home/);
  assert.match(first.textContent, /2026-11-01/);
  const firstCheckbox = first.querySelector('input[type="checkbox"]');
  assert.ok(firstCheckbox, 'expected a checkbox for the first todo');
  assert.equal(firstCheckbox.checked, false);

  const second = list.querySelector('li[data-id="2"]');
  assert.ok(second, 'expected the second todo to be rendered');
  assert.match(second.textContent, /Write report/);
  assert.match(second.textContent, /low/);
  const secondCheckbox = second.querySelector('input[type="checkbox"]');
  assert.ok(secondCheckbox, 'expected a checkbox for the second todo');
  assert.equal(secondCheckbox.checked, true);
});

test('AC2: a todo added through the web UI appears in its list', async (t) => {
  const created = { id: 'new1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [] };
    if (method === 'POST' && url === '/tasks') {
      assert.deepEqual(body, { title: 'Buy milk' });
      return { status: 201, body: created };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#todo-list li').length, 0);

  const titleInput = document.querySelector('#title-input');
  assert.ok(titleInput, 'expected a #title-input field');
  titleInput.value = 'Buy milk';
  const form = document.querySelector('#add-form');
  assert.ok(form, 'expected an #add-form element');
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="new1"]');
  assert.ok(item, 'expected the newly added todo to appear in the list');
  assert.match(item.textContent, /Buy milk/);
});

test('AC3: marking a todo done in the web UI is reflected in the list as done', async (t) => {
  const task = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { completed: true });
      return { status: 200, body: { ...task, completed: true } };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const checkbox = document.querySelector('#todo-list li[data-id="t1"] input[type="checkbox"]');
  assert.ok(checkbox, 'expected a checkbox for the todo');
  assert.equal(checkbox.checked, false);

  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const updatedCheckbox = document.querySelector('#todo-list li[data-id="t1"] input[type="checkbox"]');
  assert.ok(updatedCheckbox, 'expected the todo to still be in the list');
  assert.equal(updatedCheckbox.checked, true);
});

test('AC4: deleting a todo in the web UI removes it from the list', async (t) => {
  const task = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'DELETE' && url === '/tasks/t1') return { status: 204, body: undefined };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.ok(document.querySelector('#todo-list li[data-id="t1"]'), 'expected the todo to be rendered first');

  const deleteBtn = document.querySelector('#todo-list li[data-id="t1"] button.delete-btn');
  assert.ok(deleteBtn, 'expected a delete button for the todo');
  deleteBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();

  assert.equal(document.querySelector('#todo-list li[data-id="t1"]'), null);
});
