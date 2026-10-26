import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// Pins W2 of I-14 (a new layout for the todo page): the "needs attention,
// bottom composer" arrangement picked in the spec's Q2 — open overdue and
// high-priority todos grouped into their own block above everything else —
// plus the new tag and overdue filter controls wired to GET /api/tasks's
// existing `tag` and `overdue` query parameters. Every interaction already
// pinned by the prior redesign (I-12, test/redesign.test.js) and animations
// (I-13, test/animations.test.js) work must keep working through this
// rearrangement (AC3-AC6 here); the deployed-only half of this work item —
// real layout and no horizontal overflow at a common desktop and phone width
// (AC1/AC2) — is pinned by e2e/layout.spec.js instead, the same split those
// two prior suites already use between a jsdom test and a browser test.
//
// Q2's own wording only commits to "pinned in their own block at the top"
// and "filters ... as chips", not to any specific markup, so this suite
// pins that structurally rather than exactly: a #attention-section ahead of
// a #rest-section (both still inside #todo-list, so the existing
// "#todo-list li[data-id=...]" contract used by every other suite keeps
// matching), and a toggle button per filter exposing its on/off state via
// aria-pressed, the same generic-but-checkable approach test/redesign.test.js
// took for "restyled with component-library classes".
//
// AC5 here only exercises the priority and due-date sorts themselves, not
// the unsorted "default order" test/redesign.test.js separately pins —
// grouping a high-priority or overdue todo to the top of the page on every
// sort (including no sort) is the Q2 decision itself, so this suite does not
// re-assert a flat insertion order across mixed-priority todos.

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function parseRequestUrl(url) {
  const [pathname, search] = url.split('?');
  return { pathname, params: new URLSearchParams(search || '') };
}

function isoDateOffset(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('AC6/AC7: open overdue and high-priority todos are grouped into a needs-attention block above everything else, and an overdue row still carries the pinned "overdue" class', async (t) => {
  const overdueHigh = { id: 'a1', title: 'Renew the parking permit', completed: false, due: isoDateOffset(-7), priority: 'high', tags: ['errands'] };
  const notDueHighPriority = { id: 'a2', title: 'Review the quarterly roadmap', completed: false, due: null, priority: 'high', tags: ['work'] };
  const doneOverdue = { id: 'r1', title: 'Water the office plants', completed: true, due: isoDateOffset(-7), priority: 'low', tags: [] };
  const futureNormal = { id: 'r2', title: 'Plan the team offsite', completed: false, due: isoDateOffset(30), priority: 'normal', tags: [] };
  const tasks = [overdueHigh, notDueHighPriority, doneOverdue, futureNormal];
  const api = await startFakeApi(async () => ({ status: 200, body: tasks }));
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  const attention = document.querySelector('#attention-section');
  const rest = document.querySelector('#rest-section');
  assert.ok(attention, 'expected a needs-attention section');
  assert.ok(rest, 'expected an everything-else section');
  assert.ok(
    attention.compareDocumentPosition(rest) & 4, // Node.DOCUMENT_POSITION_FOLLOWING
    'expected the needs-attention section to come before the everything-else section',
  );

  for (const task of [overdueHigh, notDueHighPriority]) {
    assert.ok(
      attention.querySelector(`li[data-id="${task.id}"]`),
      `expected ${task.id} (not done, and overdue or high-priority) to be in the needs-attention section`,
    );
  }
  for (const task of [doneOverdue, futureNormal]) {
    assert.ok(
      rest.querySelector(`li[data-id="${task.id}"]`),
      `expected ${task.id} not to be in the needs-attention section`,
    );
  }

  const overdueRow = document.querySelector('#todo-list li[data-id="a1"]');
  assert.equal(overdueRow.classList.contains('overdue'), true, 'expected the pinned "overdue" class on the overdue row');
  assert.match(overdueRow.textContent, /high/);
  assert.match(overdueRow.textContent, /errands/);

  const doneOverdueRow = document.querySelector('#todo-list li[data-id="r1"]');
  assert.equal(doneOverdueRow.classList.contains('overdue'), false, 'expected a done todo not to be marked overdue even if its due date has passed');

  const futureRow = document.querySelector('#todo-list li[data-id="r2"]');
  assert.equal(futureRow.classList.contains('overdue'), false, 'expected a todo due in the future not to be marked overdue');
});

test('AC3: adding a todo, with or without a due date, still appears in the list in the new layout', async (t) => {
  const createdNoDue = { id: 'new1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const createdWithDue = { id: 'new2', title: 'File taxes', completed: false, due: '2026-12-01', priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [] };
    if (method === 'POST' && url === '/tasks' && body.title === 'Buy milk') {
      assert.deepEqual(body, { title: 'Buy milk' });
      return { status: 201, body: createdNoDue };
    }
    if (method === 'POST' && url === '/tasks' && body.title === 'File taxes') {
      assert.deepEqual(body, { title: 'File taxes', due: '2026-12-01' });
      return { status: 201, body: createdWithDue };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#todo-list li').length, 0);

  document.querySelector('#title-input').value = 'Buy milk';
  document.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const noDueItem = document.querySelector('#todo-list li[data-id="new1"]');
  assert.ok(noDueItem, 'expected the todo added without a due date to appear in the list');
  assert.match(noDueItem.textContent, /Buy milk/);
  const restSection = document.querySelector('#rest-section');
  assert.ok(restSection, "expected the new layout's everything-else section");
  assert.ok(
    restSection.querySelector('li[data-id="new1"]'),
    'expected the newly added todo (not overdue, not high-priority) to render inside the everything-else section',
  );

  document.querySelector('#title-input').value = 'File taxes';
  document.querySelector('#due-input').value = '2026-12-01';
  document.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const withDueItem = document.querySelector('#todo-list li[data-id="new2"]');
  assert.ok(withDueItem, 'expected the todo added with a due date to appear in the list');
  assert.match(withDueItem.textContent, /2026-12-01/);
  assert.ok(
    document.querySelector('#rest-section').querySelector('li[data-id="new2"]'),
    'expected the newly added todo (due in the future, not high-priority) to render inside the everything-else section',
  );
});

test("AC4: changing a todo's due date, toggling it done, and deleting it still work in the new layout", async (t) => {
  let current = { id: 't1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [current] };
    if (method === 'PATCH' && url === '/tasks/t1') {
      current = { ...current, ...body };
      return { status: 200, body: current };
    }
    if (method === 'DELETE' && url === '/tasks/t1') return { status: 204, body: undefined };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;

  assert.ok(
    document.querySelector('#rest-section li[data-id="t1"]'),
    "expected the todo (not overdue, not high-priority) to render inside the new layout's everything-else section",
  );

  const dueEdit = document.querySelector('#todo-list li[data-id="t1"] input.due-edit');
  assert.ok(dueEdit, 'expected a due-date input on the todo row');
  dueEdit.value = '2026-12-25';
  dueEdit.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.match(document.querySelector('#todo-list li[data-id="t1"]').textContent, /2026-12-25/);

  const checkbox = document.querySelector('#todo-list li[data-id="t1"] input[type="checkbox"]');
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.equal(
    document.querySelector('#todo-list li[data-id="t1"] input[type="checkbox"]').checked,
    true,
    'expected toggling done to still save',
  );

  const deleteBtn = document.querySelector('#todo-list li[data-id="t1"] button.delete-btn');
  assert.ok(deleteBtn, 'expected a delete button for the todo');
  deleteBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  await wait(250);
  assert.equal(document.querySelector('#todo-list li[data-id="t1"]'), null, 'expected deleting to still remove the todo');
});

test('AC5: sorting by priority and by due date still reorders the list correctly in the new layout', async (t) => {
  const low = { id: 'low', title: 'Water the plants', completed: false, due: null, priority: 'low', tags: [] };
  const normal = { id: 'normal', title: 'File the report', completed: false, due: null, priority: 'normal', tags: [] };
  const high = { id: 'high', title: 'Renew the permit', completed: false, due: null, priority: 'high', tags: [] };
  const priorityOrder = [high, normal, low];

  const soonest = { id: 'soonest', title: 'Soonest due', completed: false, due: isoDateOffset(10), priority: 'normal', tags: [] };
  const latest = { id: 'latest', title: 'Latest due', completed: false, due: isoDateOffset(60), priority: 'normal', tags: [] };
  const dueOrder = [soonest, latest];

  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [] };
    if (method === 'GET' && url === '/tasks?sort=priority') return { status: 200, body: priorityOrder };
    if (method === 'GET' && url === '/tasks?sort=due') return { status: 200, body: dueOrder };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const idsOf = () => [...document.querySelectorAll('#todo-list li')].map((li) => li.dataset.id);

  const sortSelect = document.querySelector('#sort-select');
  sortSelect.value = 'priority';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.deepEqual(idsOf(), ['high', 'normal', 'low'], 'expected GET /api/tasks?sort=priority to drive the rendered order, high first');
  assert.ok(
    document.querySelector('#attention-section li[data-id="high"]'),
    'expected the high-priority todo to render inside the needs-attention section even without a sort re-grouping it away',
  );
  assert.ok(
    document.querySelector('#rest-section li[data-id="normal"]') && document.querySelector('#rest-section li[data-id="low"]'),
    'expected the normal- and low-priority todos to render inside the everything-else section, still ordered by priority within it',
  );

  sortSelect.value = 'due';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.deepEqual(idsOf(), ['soonest', 'latest'], 'expected GET /api/tasks?sort=due to drive the rendered order, soonest first');
});

test('AC8: the list can be narrowed to only todos carrying a given tag', async (t) => {
  const home1 = { id: 'h1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: ['home'] };
  const work1 = { id: 'w1', title: 'File the report', completed: false, due: null, priority: 'normal', tags: ['work'] };
  const api = await startFakeApi(async ({ method, url }) => {
    const { pathname, params } = parseRequestUrl(url);
    assert.equal(method, 'GET');
    assert.equal(pathname, '/tasks');
    if (params.get('tag') === 'home') return { status: 200, body: [home1] };
    if (!params.has('tag') && !params.has('overdue')) return { status: 200, body: [home1, work1] };
    throw new Error(`unexpected query: ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#todo-list li').length, 2, 'expected both todos before filtering');

  const tagButton = document.querySelector('#tag-filters button[data-tag="home"]');
  assert.ok(tagButton, 'expected a filter control offering the "home" tag');
  assert.equal(tagButton.getAttribute('aria-pressed'), 'false', 'expected the tag filter to start inactive');

  tagButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();

  const ids = [...document.querySelectorAll('#todo-list li')].map((li) => li.dataset.id);
  assert.deepEqual(ids, ['h1'], 'expected the list to narrow to only todos carrying the "home" tag');
  assert.equal(tagButton.getAttribute('aria-pressed'), 'true', 'expected the active tag filter to be marked pressed');
});

test('AC9: the list can be narrowed to only overdue todos', async (t) => {
  const overdue = { id: 'o1', title: 'Renew the parking permit', completed: false, due: isoDateOffset(-7), priority: 'normal', tags: [] };
  const notOverdue = { id: 'n1', title: 'Plan the team offsite', completed: false, due: isoDateOffset(30), priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    const { pathname, params } = parseRequestUrl(url);
    assert.equal(method, 'GET');
    assert.equal(pathname, '/tasks');
    if (params.get('overdue') === 'true') return { status: 200, body: [overdue] };
    if (!params.has('tag') && !params.has('overdue')) return { status: 200, body: [overdue, notOverdue] };
    throw new Error(`unexpected query: ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#todo-list li').length, 2, 'expected both todos before filtering');

  const overdueButton = document.querySelector('#filter-overdue');
  assert.ok(overdueButton, 'expected a filter control for overdue-only');
  assert.equal(overdueButton.getAttribute('aria-pressed'), 'false', 'expected the overdue filter to start inactive');

  overdueButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();

  const ids = [...document.querySelectorAll('#todo-list li')].map((li) => li.dataset.id);
  assert.deepEqual(ids, ['o1'], 'expected the list to narrow to only overdue todos');
  assert.equal(overdueButton.getAttribute('aria-pressed'), 'true', 'expected the active overdue filter to be marked pressed');
});

test('AC10: clearing an applied tag or overdue filter returns the list to its unfiltered state', async (t) => {
  const taggedOverdue = { id: 'o1', title: 'Renew the parking permit', completed: false, due: isoDateOffset(-7), priority: 'normal', tags: ['home'] };
  const plainFuture = { id: 'n1', title: 'Plan the team offsite', completed: false, due: isoDateOffset(30), priority: 'normal', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    const { pathname, params } = parseRequestUrl(url);
    assert.equal(method, 'GET');
    assert.equal(pathname, '/tasks');
    if (params.get('tag') === 'home') return { status: 200, body: [taggedOverdue] };
    if (params.get('overdue') === 'true') return { status: 200, body: [taggedOverdue] };
    if (!params.has('tag') && !params.has('overdue')) return { status: 200, body: [taggedOverdue, plainFuture] };
    throw new Error(`unexpected query: ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const idsOf = () => [...document.querySelectorAll('#todo-list li')].map((li) => li.dataset.id);

  const tagButton = document.querySelector('#tag-filters button[data-tag="home"]');
  assert.ok(tagButton, 'expected a filter control offering the "home" tag');
  tagButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  assert.deepEqual(idsOf(), ['o1'], 'expected the tag filter to narrow the list first');

  tagButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  assert.deepEqual(idsOf(), ['o1', 'n1'], 'expected clearing the tag filter to return the list to its unfiltered state');
  assert.equal(tagButton.getAttribute('aria-pressed'), 'false', 'expected the cleared tag filter to no longer be marked pressed');

  const overdueButton = document.querySelector('#filter-overdue');
  assert.ok(overdueButton, 'expected a filter control for overdue-only');
  overdueButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  assert.deepEqual(idsOf(), ['o1'], 'expected the overdue filter to narrow the list first');

  overdueButton.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await flush();
  assert.deepEqual(idsOf(), ['o1', 'n1'], 'expected clearing the overdue filter to return the list to its unfiltered state');
  assert.equal(overdueButton.getAttribute('aria-pressed'), 'false', 'expected the cleared overdue filter to no longer be marked pressed');
});
