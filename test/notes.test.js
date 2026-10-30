import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// Pins I-15 W3 (Notes on todos — the web UI): a todo's note shows under its
// title when it has one (AC1), a person can add, edit, and clear it in
// place via the existing row's own field, the same edit-on-blur shape the
// due-date field already uses (AC2/AC3/AC4), and a note the API refuses
// (over 500 characters) shows its error while leaving the todo's previous
// note in place (AC5). These drive the real frontend (served by the web
// server) and its own script inside jsdom, the same way test/frontend.test.js
// does, so they run with neither a browser nor a deployed environment.
// AC6 (a Playwright test exercising add/edit/clear through the browser) is
// pinned separately, in e2e/notes.spec.js.
//
// The note field is selected via `.note-input`, matching the class the
// approved Q1 mock (r1/q1-note-inline.html) uses for it; the error a refused
// note shows is selected via `.note-error`, a convention this suite
// introduces since no note-refusal error display exists yet to follow (see
// this work item's concerns.json).

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

function noteFieldFor(document, id) {
  return document.querySelector(`#todo-list li[data-id="${id}"] .note-input`);
}

test("AC1: a todo's note shows under its title when it has one", async (t) => {
  const withNote = {
    id: 't1',
    title: 'Renew the parking permit',
    completed: false,
    due: null,
    priority: 'normal',
    tags: [],
    note: 'Ask Sam at the front desk, he has the renewal form',
  };
  const api = await startFakeApi(async ({ method, url }) => {
    assert.equal(method, 'GET');
    assert.equal(url, '/tasks');
    return { status: 200, body: [withNote] };
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const item = document.querySelector('#todo-list li[data-id="t1"]');
  assert.ok(item, 'expected the todo to be rendered');

  const noteField = noteFieldFor(document, 't1');
  assert.ok(noteField, 'expected a note field on the todo row');
  assert.equal(noteField.value, withNote.note);

  const titleEl = [...item.querySelectorAll('span')].find((el) => el.textContent.trim() === withNote.title);
  assert.ok(titleEl, "expected to find the todo's title element");
  const position = titleEl.compareDocumentPosition(noteField);
  assert.ok(
    position & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    "expected the note field to appear under (after) the todo's title",
  );
});

test('AC2: a person can add a note to a todo that has none, in place, without leaving the list', async (t) => {
  const task = {
    id: 't1',
    title: 'Water the office plants',
    completed: false,
    due: null,
    priority: 'normal',
    tags: [],
    note: '',
  };
  const note = 'Check the soil moisture before watering';
  const updated = { ...task, note };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { note });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const noteField = noteFieldFor(document, 't1');
  assert.ok(noteField, 'expected a note field on the todo row');
  assert.equal(noteField.value, '');

  noteField.value = note;
  noteField.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(document.querySelectorAll('#todo-list li').length, 1, 'expected to still be showing the list, not a separate view');
  assert.equal(noteFieldFor(document, 't1').value, note);
});

test("AC3: a person can edit an existing todo's note in place", async (t) => {
  const task = {
    id: 't1',
    title: 'Renew the parking permit',
    completed: false,
    due: null,
    priority: 'normal',
    tags: [],
    note: 'Ask Sam at the front desk',
  };
  const revisedNote = 'Ask Priya instead, Sam is out this week';
  const updated = { ...task, note: revisedNote };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { note: revisedNote });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const noteField = noteFieldFor(document, 't1');
  assert.equal(noteField.value, task.note);

  noteField.value = revisedNote;
  noteField.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(noteFieldFor(document, 't1').value, revisedNote);
});

test("AC4: a person can clear a todo's note in place", async (t) => {
  const task = {
    id: 't1',
    title: 'Renew the parking permit',
    completed: false,
    due: null,
    priority: 'normal',
    tags: [],
    note: 'Ask Sam at the front desk',
  };
  const updated = { ...task, note: '' };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { note: '' });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const noteField = noteFieldFor(document, 't1');
  assert.equal(noteField.value, task.note);

  noteField.value = '';
  noteField.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(noteFieldFor(document, 't1').value, '');
});

test("AC5: when the API refuses a note over 500 characters, the web UI shows an error and keeps the todo's previous note", async (t) => {
  const task = {
    id: 't1',
    title: 'Renew the parking permit',
    completed: false,
    due: null,
    priority: 'normal',
    tags: [],
    note: 'Ask Sam at the front desk',
  };
  const longNote = 'x'.repeat(501);
  const errorMessage = 'A "note" must be at most 500 characters.';
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { note: longNote });
      return { status: 400, body: { error: errorMessage } };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const noteField = noteFieldFor(document, 't1');
  noteField.value = longNote;
  noteField.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="t1"]');
  const errorEl = item.querySelector('.note-error');
  assert.ok(errorEl, 'expected an error element on the todo row');
  assert.match(errorEl.textContent, new RegExp(errorMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.equal(
    noteFieldFor(document, 't1').value,
    task.note,
    "expected the todo's previous note to remain after the API refused the new one",
  );
});
