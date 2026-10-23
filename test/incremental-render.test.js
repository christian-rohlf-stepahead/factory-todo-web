import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// Pins W1 of I-13 (Animations): a mutation must update only the rows that
// were actually added, removed, or changed, instead of tearing down and
// rebuilding the whole #todo-list on every change (today's behaviour). The
// next work item's row animations depend on telling "a row was added/
// removed" apart from "something else changed", which only holds if a row
// untouched by a given change keeps its own DOM element across the render
// rather than being replaced by a freshly built lookalike. These tests drive
// the real frontend the same way test/frontend.test.js does, so they run
// with neither a browser nor a deployed environment, and they pin DOM
// element identity alongside the already-pinned visible behaviour.

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

function rowFor(document, id) {
  return document.querySelector(`#todo-list li[data-id="${id}"]`);
}

test('AC1: adding a todo leaves the DOM elements of the todos already in the list untouched', async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const created = { id: 'new1', title: 'Water plants', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2] };
    if (method === 'POST' && url === '/tasks') {
      assert.deepEqual(body, { title: 'Water plants' });
      return { status: 201, body: created };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row1Before = rowFor(document, 't1');
  const row2Before = rowFor(document, 't2');
  assert.ok(row1Before && row2Before, 'expected both seeded todos to be rendered');

  const titleInput = document.querySelector('#title-input');
  titleInput.value = 'Water plants';
  document.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  assert.equal(
    rowFor(document, 't1'),
    row1Before,
    "expected the first todo's row element to still be the same DOM node, not a freshly rebuilt one",
  );
  assert.equal(
    rowFor(document, 't2'),
    row2Before,
    "expected the second todo's row element to still be the same DOM node, not a freshly rebuilt one",
  );
  assert.ok(rowFor(document, 'new1'), 'expected the newly added todo to appear in the list');
});

test('AC1: deleting a todo leaves the DOM elements of the todos that remain untouched', async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const task3 = { id: 't3', title: 'Water plants', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2, task3] };
    if (method === 'DELETE' && url === '/tasks/t2') return { status: 204, body: undefined };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row1Before = rowFor(document, 't1');
  const row3Before = rowFor(document, 't3');
  assert.ok(row1Before && row3Before, 'expected the other two todos to be rendered');

  rowFor(document, 't2')
    .querySelector('button.delete-btn')
    .dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();

  assert.equal(rowFor(document, 't2'), null, 'expected the deleted todo to be removed from the list');
  assert.equal(
    rowFor(document, 't1'),
    row1Before,
    "expected the first remaining todo's row element to still be the same DOM node",
  );
  assert.equal(
    rowFor(document, 't3'),
    row3Before,
    "expected the third remaining todo's row element to still be the same DOM node",
  );
});

test("AC1: toggling a todo's done state updates only that todo's own row, leaving other rows' DOM elements untouched", async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { completed: true });
      return { status: 200, body: { ...task1, completed: true } };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row1Before = rowFor(document, 't1');
  const row2Before = rowFor(document, 't2');

  const checkbox = row1Before.querySelector('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(
    rowFor(document, 't1'),
    row1Before,
    "expected the toggled todo's own row element to stay the same DOM node, updated in place",
  );
  assert.equal(rowFor(document, 't1').querySelector('input[type="checkbox"]').checked, true);
  assert.equal(
    rowFor(document, 't2'),
    row2Before,
    "expected the untouched todo's row element to stay the same DOM node",
  );
});

test("AC1: changing a todo's due date updates only that todo's own row, leaving other rows' DOM elements untouched", async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const updated = { ...task1, due: '2026-12-25' };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { due: '2026-12-25' });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row1Before = rowFor(document, 't1');
  const row2Before = rowFor(document, 't2');

  const dueEdit = row1Before.querySelector('input.due-edit');
  dueEdit.value = '2026-12-25';
  dueEdit.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(
    rowFor(document, 't1'),
    row1Before,
    "expected the edited todo's own row element to stay the same DOM node, updated in place",
  );
  assert.match(rowFor(document, 't1').textContent, /2026-12-25/);
  assert.equal(
    rowFor(document, 't2'),
    row2Before,
    "expected the untouched todo's row element to stay the same DOM node",
  );
});

test("AC1: changing the sort order reuses each todo's existing row element and only reorders them in the list", async (t) => {
  const taskFuture = { id: 'future', title: 'Plan the team offsite', completed: false, due: '2026-12-01', priority: 'normal', tags: [] };
  const taskUndated = { id: 'undated', title: 'Water the office plants', completed: true, due: null, priority: 'low', tags: [] };
  const taskSoonest = { id: 'soonest', title: 'Renew the parking permit', completed: false, due: '2026-10-01', priority: 'high', tags: ['errands'] };
  const unsorted = [taskFuture, taskUndated, taskSoonest];
  const sortedByDue = [taskSoonest, taskFuture, taskUndated];

  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: unsorted };
    if (method === 'GET' && url === '/tasks?sort=due') return { status: 200, body: sortedByDue };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const rowsBefore = {
    future: rowFor(document, 'future'),
    undated: rowFor(document, 'undated'),
    soonest: rowFor(document, 'soonest'),
  };

  const sortSelect = document.querySelector('#sort-select');
  sortSelect.value = 'due';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const rowsAfter = [...document.querySelectorAll('#todo-list li')];
  assert.deepEqual(
    rowsAfter.map((li) => li.dataset.id),
    ['soonest', 'future', 'undated'],
    'expected the list to be reordered by due date',
  );
  assert.equal(
    rowsAfter[0],
    rowsBefore.soonest,
    "expected the 'soonest' row to be the same DOM node, just moved, not rebuilt",
  );
  assert.equal(
    rowsAfter[1],
    rowsBefore.future,
    "expected the 'future' row to be the same DOM node, just moved, not rebuilt",
  );
  assert.equal(
    rowsAfter[2],
    rowsBefore.undated,
    "expected the 'undated' row to be the same DOM node, just moved, not rebuilt",
  );
});
