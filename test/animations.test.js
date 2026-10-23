import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { listenUnixServer, unixRequest, createUnixFetch, startFakeApi } from './helpers/unixHttp.js';

// Pins the local, browser-less half of W2 of I-13 (Animations): AC2-AC8 of
// this work item (spec AC3-AC9). The deployed, actually-rendered half (real
// fade/transition timing, real layout at a viewport, real focus loss to the
// page background) is pinned by e2e/animations.spec.js, which this sandbox
// cannot run (see e2e/redesign.spec.js and test/redesign.test.js for the
// same split applied to the prior redesign intent).
//
// Entrance and exit are only testable here as something a jsdom query can
// see, so this suite pins a `data-animate` attribute convention that the
// build must use: "enter" set on a row the instant it is newly created (and
// never on a row that already existed), and "exit" set the instant a row
// starts fading out after delete (alongside `aria-hidden` and `inert`, and
// before the row is actually removed). Toggling done/undone never creates or
// destroys a row, so it needs no such marker: a CSS transition on an
// already-present class is enough, which this suite checks by requiring the
// done and not-done title classes to share a transition-capable class
// instead of swapping to wholly unrelated class lists.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

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

function waitUntil(predicate, { timeout = 2000, interval = 20 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      let result;
      try {
        result = predicate();
      } catch {
        result = false;
      }
      if (result) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeout) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(check, interval);
    };
    check();
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

test('AC1: the stylesheet gives the todo list a one-time fade-in on page load, neutralized under reduced motion', () => {
  const css = readFileSync(path.join(REPO_ROOT, 'src', 'styles.css'), 'utf8');

  assert.match(
    css,
    /\.todo-list\s*\{[^}]*\b(?:animation|transition)[^}]*\d+m?s/s,
    'expected a rule scoped to .todo-list with an animation or transition that takes a nonzero duration, so the list fades in once rather than appearing instantly',
  );

  const reducedMotionBlock = css.match(/@media\s*\([^)]*prefers-reduced-motion:\s*reduce[^)]*\)\s*\{(.*)/s);
  assert.ok(
    reducedMotionBlock,
    'expected an @media (prefers-reduced-motion: reduce) block neutralizing the app\'s animations/transitions',
  );
  assert.match(
    reducedMotionBlock[1],
    /\b(?:animation|transition)(?:-duration)?\s*:\s*(?:none|0)/,
    'expected the reduced-motion block to actually neutralize animation/transition duration, not just exist',
  );
});

test('AC2/AC5: adding a todo marks only the new row for an entrance animation, and a later due-date change marks no row as entering or exiting', async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: '2026-11-01', priority: 'normal', tags: [] };
  const created = { id: 'new1', title: 'Water plants', completed: false, due: null, priority: 'normal', tags: [] };
  const updated = { ...task1, due: '2026-12-25' };
  const api = await startFakeApi(async ({ method, url, body }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1] };
    if (method === 'POST' && url === '/tasks') {
      assert.deepEqual(body, { title: 'Water plants' });
      return { status: 201, body: created };
    }
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
  assert.equal(
    rowFor(document, 't1').dataset.animate,
    undefined,
    'expected a row already on the page at load not to carry an entrance marker',
  );

  const titleInput = document.querySelector('#title-input');
  titleInput.value = 'Water plants';
  document.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();

  const newRow = rowFor(document, 'new1');
  assert.ok(newRow, 'expected the newly added todo to appear in the list');
  assert.equal(newRow.dataset.animate, 'enter', 'expected the newly added row to carry data-animate="enter"');
  assert.equal(
    rowFor(document, 't1').dataset.animate,
    undefined,
    'expected the row that was already in the list not to replay the entrance animation',
  );

  const dueEdit = rowFor(document, 't1').querySelector('input.due-edit');
  dueEdit.value = '2026-12-25';
  dueEdit.dispatchEvent(new dom.window.Event('change'));
  await flush();

  for (const id of ['t1', 'new1']) {
    assert.equal(
      rowFor(document, id).dataset.animate,
      undefined,
      `expected changing a due date never to mark row ${id} as entering or exiting`,
    );
  }
});

test('AC3/AC5: deleting a todo fades its row out before removing it, and a later sort change marks no remaining row as newly added', async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const sortedByDue = [task1];
  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2] };
    if (method === 'DELETE' && url === '/tasks/t2') return { status: 204, body: undefined };
    if (method === 'GET' && url === '/tasks?sort=due') return { status: 200, body: sortedByDue };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row2 = rowFor(document, 't2');
  assert.ok(row2, 'expected the todo to be rendered first');

  row2.querySelector('button.delete-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(
    rowFor(document, 't2'),
    row2,
    'expected the row to still be present immediately after delete is triggered, fading out rather than disappearing at once',
  );
  assert.equal(row2.dataset.animate, 'exit', 'expected the deleted row to carry data-animate="exit" while it fades');

  await waitUntil(() => rowFor(document, 't2') === null);

  assert.equal(
    rowFor(document, 't1').dataset.animate,
    undefined,
    'expected the remaining row not to be marked as though it were newly added or removed',
  );

  const sortSelect = document.querySelector('#sort-select');
  sortSelect.value = 'due';
  sortSelect.dispatchEvent(new dom.window.Event('change'));
  await flush();

  assert.equal(
    rowFor(document, 't1').dataset.animate,
    undefined,
    'expected changing the sort order never to mark a row as entering or exiting',
  );
});

test("AC4: toggling a todo's done state keeps a transition-capable class so the style change animates rather than snapping instantly", async (t) => {
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
  const row = rowFor(document, 't1');
  const titleSpan = () => row.querySelectorAll('span')[0];
  const classNotDone = titleSpan().className;

  const checkbox = row.querySelector('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();

  const classDone = titleSpan().className;
  assert.notEqual(classDone, classNotDone, 'expected the title to actually restyle once done');
  assert.match(
    classNotDone,
    /transition/,
    'expected the not-done title to carry a transition-capable class so toggling animates rather than snaps',
  );
  assert.match(
    classDone,
    /transition/,
    'expected the done title to carry a transition-capable class so toggling animates rather than snaps',
  );
});

test('AC7: a row fading out after delete is hidden from assistive technology and removed from the tab order, and focus does not fall back to the page background', async (t) => {
  const task1 = { id: 't1', title: 'Buy milk', completed: false, due: null, priority: 'normal', tags: [] };
  const task2 = { id: 't2', title: 'Walk the dog', completed: false, due: null, priority: 'low', tags: [] };
  const api = await startFakeApi(async ({ method, url }) => {
    if (method === 'GET' && url === '/tasks') return { status: 200, body: [task1, task2] };
    if (method === 'DELETE' && url === '/tasks/t2') return { status: 204, body: undefined };
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  t.after(api.close);
  const web = await startWebServer({ agent: api.agent });
  t.after(web.close);

  const dom = await loadPage(web.socketPath);
  const { document } = dom.window;
  const row2 = rowFor(document, 't2');
  const deleteBtn = row2.querySelector('button.delete-btn');
  deleteBtn.focus();
  assert.equal(document.activeElement, deleteBtn, 'expected the delete button to be focused before delete is triggered');

  deleteBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(row2.getAttribute('aria-hidden'), 'true', 'expected the fading-out row to be hidden from assistive technology');
  assert.ok(
    row2.hasAttribute('inert') || row2.inert === true,
    'expected the fading-out row to be inert, taking it and its controls out of the tab order',
  );
  assert.notEqual(
    document.activeElement,
    deleteBtn,
    'expected focus to move off the delete button as soon as its row starts fading out, not stay inside a row that is now aria-hidden',
  );
  assert.ok(
    !row2.contains(document.activeElement),
    'expected focus not to be left anywhere inside the fading-out row',
  );

  await waitUntil(() => rowFor(document, 't2') === null);

  assert.ok(document.activeElement, 'expected some element to hold focus once the row is actually removed');
  assert.notEqual(
    document.activeElement,
    document.body,
    'expected focus to land somewhere sane once the row is removed, not fall back to the page background',
  );
  assert.ok(
    document.contains(document.activeElement),
    'expected the element holding focus after removal to still be part of the page',
  );
});
