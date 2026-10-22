import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// Pins I-12 W2 (the shadcn-based visual redesign): the add form, the todo
// list, the sort control, and each row must come out of the chosen component
// library restyled (AC1/AC2), every existing interaction must keep working
// through that restyle (AC3), an overdue row must stay visibly distinguished
// (AC4), and sorting must keep working with a restyled control (AC5). These
// drive the real frontend (served by the web server) and its own script
// inside jsdom, the same way test/frontend.test.js does, so they run with
// neither a browser nor a deployed environment.
//
// "Restyled" is checked generically — by the presence of component-library
// classes on elements that carry none today — rather than by asserting any
// specific class name, since the exact classes are an implementation detail
// of the chosen component library and theme, not something this test should
// pin.

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
  return { dom, html: htmlRes.text };
}

function hasComponentStyling(el, pinnedClasses = 0) {
  return el.classList.length > pinnedClasses;
}

test('AC1/AC2: the add form, sort control, and a todo row are restyled with component-library classes while still showing the todo\'s title, done state, priority, tags, and due date', async (t) => {
  const tasks = [{ id: '1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'high', tags: ['home'] }];
  const api = await startFakeApi(async ({ method, url }) => {
    assert.equal(method, 'GET');
    assert.equal(url, '/tasks');
    return { status: 200, body: tasks };
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom, html } = await loadPage(web.socketPath);
  const { document } = dom.window;

  assert.doesNotMatch(
    html,
    /li\.overdue\s*\{\s*color:\s*#b00020/,
    "expected today's hard-coded inline overdue style to be replaced by the component library's theme",
  );
  assert.match(
    html,
    /<link[^>]+rel=["']stylesheet["'][^>]*>/,
    'expected the page to link a compiled stylesheet instead of relying on inline styles',
  );

  const form = document.querySelector('#add-form');
  assert.ok(form, 'expected #add-form to still exist');
  assert.ok(hasComponentStyling(form), 'expected #add-form to carry component-library classes');

  const titleInput = document.querySelector('#title-input');
  assert.ok(hasComponentStyling(titleInput), 'expected #title-input to carry component-library classes');

  const dueInput = document.querySelector('#due-input');
  assert.ok(hasComponentStyling(dueInput), 'expected #due-input to carry component-library classes');

  const submitBtn = form.querySelector('button[type="submit"]');
  assert.ok(submitBtn, 'expected a submit button inside #add-form');
  assert.ok(hasComponentStyling(submitBtn), 'expected the add form\'s submit button to carry component-library classes');

  const sortSelect = document.querySelector('#sort-select');
  assert.ok(hasComponentStyling(sortSelect), 'expected #sort-select to carry component-library classes');

  const list = document.querySelector('#todo-list');
  assert.ok(hasComponentStyling(list), 'expected #todo-list to carry component-library classes');

  const row = list.querySelector('li[data-id="1"]');
  assert.ok(row, 'expected the todo row to be rendered');
  assert.ok(hasComponentStyling(row), 'expected the todo row to carry component-library classes');
  assert.match(row.textContent, /Buy milk/);
  assert.match(row.textContent, /high/);
  assert.match(row.textContent, /home/);
  assert.match(row.textContent, /2026-11-01/);

  const checkbox = row.querySelector('input[type="checkbox"]');
  assert.ok(checkbox, 'expected a checkbox for the todo');
  assert.equal(checkbox.checked, false);
  assert.ok(hasComponentStyling(checkbox), 'expected the checkbox to carry component-library classes');

  const dueEdit = row.querySelector('input.due-edit');
  assert.ok(dueEdit, 'expected a due-edit input, keeping the pinned "due-edit" class');
  assert.ok(hasComponentStyling(dueEdit, 1), 'expected the due-edit input to gain component-library classes alongside "due-edit"');

  const deleteBtn = row.querySelector('button.delete-btn');
  assert.ok(deleteBtn, 'expected a delete button, keeping the pinned "delete-btn" class');
  assert.ok(hasComponentStyling(deleteBtn, 1), 'expected the delete button to gain component-library classes alongside "delete-btn"');
});

test('AC3: marking a todo done in the restyled UI still toggles it and still shows component-library styling', async (t) => {
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

  const { dom } = await loadPage(web.socketPath);
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
  assert.ok(hasComponentStyling(updatedCheckbox), 'expected the checkbox to carry component-library classes');
});

test('AC3: adding a todo without a due date in the restyled UI still appears in the list, restyled', async (t) => {
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

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#todo-list li').length, 0);

  const titleInput = document.querySelector('#title-input');
  titleInput.value = 'Buy milk';
  const form = document.querySelector('#add-form');
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="new1"]');
  assert.ok(item, 'expected the newly added todo to appear in the list');
  assert.match(item.textContent, /Buy milk/);
  assert.ok(hasComponentStyling(item), 'expected the newly added row to carry component-library classes');
});

test('AC3: adding a todo with a due date in the restyled UI saves it with that due date, restyled', async (t) => {
  const created = {
    id: 'new1',
    title: 'Buy milk',
    completed: false,
    due: '2026-12-01',
    priority: 'normal',
    tags: [],
  };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [] };
    if (method === 'POST' && url === '/tasks') {
      assert.deepEqual(body, { title: 'Buy milk', due: '2026-12-01' });
      return { status: 201, body: created };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;

  const titleInput = document.querySelector('#title-input');
  const dueInput = document.querySelector('#due-input');
  titleInput.value = 'Buy milk';
  dueInput.value = '2026-12-01';
  const form = document.querySelector('#add-form');
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="new1"]');
  assert.ok(item, 'expected the newly added todo to appear in the list');
  assert.match(item.textContent, /2026-12-01/);
  assert.ok(hasComponentStyling(item), 'expected the newly added row to carry component-library classes');
});

test("AC3: changing an existing todo's due date in the restyled UI still saves the change", async (t) => {
  const task = { id: 't1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'normal', tags: [] };
  const updated = { ...task, due: '2026-12-25' };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { due: '2026-12-25' });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;

  const dueEdit = document.querySelector('#todo-list li[data-id="t1"] input.due-edit');
  assert.ok(dueEdit, 'expected a due-date input on the todo row to change its due date');
  assert.equal(dueEdit.value, '2026-11-01');
  assert.ok(hasComponentStyling(dueEdit, 1), 'expected the due-edit input to carry component-library classes alongside "due-edit"');

  dueEdit.value = '2026-12-25';
  dueEdit.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="t1"]');
  assert.ok(item, 'expected the todo to still be in the list');
  assert.match(item.textContent, /2026-12-25/);
});

test("AC3: clearing an existing todo's due date in the restyled UI still saves the clearing", async (t) => {
  const task = { id: 't1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'normal', tags: [] };
  const updated = { ...task, due: null };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      assert.deepEqual(body, { due: null });
      return { status: 200, body: updated };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;

  const dueEdit = document.querySelector('#todo-list li[data-id="t1"] input.due-edit');
  assert.ok(dueEdit, 'expected a due-date input on the todo row to clear its due date');

  dueEdit.value = '';
  dueEdit.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const item = document.querySelector('#todo-list li[data-id="t1"]');
  assert.ok(item, 'expected the todo to still be in the list');
  assert.match(item.textContent, /due: none/);
  assert.ok(hasComponentStyling(item), 'expected the row to carry component-library classes');
});

test('AC3: deleting a todo in the restyled UI still removes it from the list', async (t) => {
  const task = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task] };
    if (method === 'DELETE' && url === '/tasks/t1') return { status: 204, body: undefined };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row = document.querySelector('#todo-list li[data-id="t1"]');
  assert.ok(row, 'expected the todo to be rendered first');

  const deleteBtn = row.querySelector('button.delete-btn');
  assert.ok(deleteBtn, 'expected a delete button for the todo');
  assert.ok(hasComponentStyling(deleteBtn, 1), 'expected the delete button to carry component-library classes alongside "delete-btn"');
  deleteBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();

  assert.equal(document.querySelector('#todo-list li[data-id="t1"]'), null);
});

test('AC4: a not-done, overdue todo remains visibly distinguished from a non-overdue todo in the restyled UI', async (t) => {
  const pastDue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdue = { id: 't1', title: 'Renew the parking permit', completed: false, due: pastDue, priority: 'high', tags: [] };
  const doneButOverdue = { id: 'd1', title: 'Water the office plants', completed: true, due: pastDue, priority: 'low', tags: [] };
  const dueFuture = { id: 'd2', title: 'Plan the team offsite', completed: false, due: future, priority: 'normal', tags: [] };
  const tasks = [overdue, doneButOverdue, dueFuture];
  const api = await startFakeApi(async () => ({ status: 200, body: tasks }));
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;

  const overdueItem = document.querySelector(`#todo-list li[data-id="${overdue.id}"]`);
  assert.ok(overdueItem, 'expected the overdue todo to be rendered');
  assert.equal(overdueItem.classList.contains('overdue'), true, 'expected the pinned "overdue" class to still be applied');

  const doneItem = document.querySelector(`#todo-list li[data-id="${doneButOverdue.id}"]`);
  const futureItem = document.querySelector(`#todo-list li[data-id="${dueFuture.id}"]`);
  assert.equal(doneItem.classList.contains('overdue'), false, 'expected a done todo not to be marked overdue even if its due date has passed');
  assert.equal(futureItem.classList.contains('overdue'), false, 'expected a todo due in the future not to be marked overdue');

  assert.ok(
    hasComponentStyling(futureItem),
    'expected a non-overdue row to carry component-library classes from the base row styling',
  );
  assert.ok(
    overdueItem.classList.length > 1,
    'expected the overdue row to carry component-library classes beyond the pinned "overdue" class, so it is visibly distinguished rather than only tagged with a class name',
  );
});

test('AC5: sorting by default, priority, and due date all still work, and the sort control is restyled', async (t) => {
  const low = { id: 'low', title: 'Water the plants', completed: false, due: null, priority: 'low', tags: [] };
  const normal = { id: 'normal', title: 'File the report', completed: false, due: null, priority: 'normal', tags: [] };
  const high = { id: 'high', title: 'Renew the permit', completed: false, due: null, priority: 'high', tags: [] };
  const soonest = { id: 'soonest', title: 'Soonest due', completed: false, due: '2026-10-01', priority: 'normal', tags: [] };
  const latest = { id: 'latest', title: 'Latest due', completed: false, due: '2026-12-01', priority: 'normal', tags: [] };

  const defaultOrder = [low, normal, high];
  const priorityOrder = [high, normal, low];
  const dueOrder = [soonest, latest];

  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: defaultOrder };
    if (method === 'GET' && url === '/tasks?sort=priority') return { status: 200, body: priorityOrder };
    if (method === 'GET' && url === '/tasks?sort=due') return { status: 200, body: dueOrder };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const { dom } = await loadPage(web.socketPath);
  const { document } = dom.window;

  const sortSelect = document.querySelector('#sort-select');
  assert.ok(sortSelect, 'expected a #sort-select control to choose the sort order');
  assert.ok(hasComponentStyling(sortSelect), 'expected #sort-select to carry component-library classes');

  const idsOf = () => [...document.querySelectorAll('#todo-list li')].map((li) => li.dataset.id);
  assert.deepEqual(idsOf(), ['low', 'normal', 'high'], 'expected the default order on initial load');

  sortSelect.value = 'priority';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.deepEqual(idsOf(), ['high', 'normal', 'low'], 'expected GET /api/tasks?sort=priority to drive the rendered order');

  sortSelect.value = 'due';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.deepEqual(idsOf(), ['soonest', 'latest'], 'expected GET /api/tasks?sort=due to drive the rendered order');
});
