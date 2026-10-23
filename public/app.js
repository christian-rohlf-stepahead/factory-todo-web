// Keeps the rendered list in sync with a local copy of the tasks, updated
// from each mutating call's own response, rather than re-fetching the whole
// list after every change.
let tasks = [];
let sort = '';

// Rows mid-fade-out after a delete: still in the DOM (so the exit animation
// can finish) but no longer in `tasks`, so renderTasks's cleanup pass must
// not rip them out before their timer below does.
const exitingIds = new Set();

const ROW_ANIMATION_MS = 200;

function reducedMotionPreferred() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rowAnimationDelay() {
  return reducedMotionPreferred() ? 0 : ROW_ANIMATION_MS;
}

function isOverdue(task) {
  if (task.completed || !task.due) return false;
  return task.due < todayDate();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Each row keeps its field elements on `li._refs` so a later render can
// update an existing row's content in place (applyTask) instead of
// rebuilding it, which is what lets a mutation touch only the rows that
// actually changed.
function createTaskElement(task) {
  const li = document.createElement('li');
  li.dataset.id = task.id;
  li.className = 'todo-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox-input';
  checkbox.addEventListener('change', () => toggleDone(task.id, checkbox.checked));

  const info = document.createElement('div');
  info.className = 'flex min-w-0 flex-1 flex-col gap-1 text-sm';

  const titleRow = document.createElement('div');
  titleRow.className = 'flex flex-wrap items-center gap-2';

  const titleSpan = document.createElement('span');

  const priorityBadge = document.createElement('span');
  priorityBadge.className = 'badge';

  titleRow.append(titleSpan, priorityBadge);

  const metaSpan = document.createElement('span');
  metaSpan.className = 'text-muted-foreground';

  info.append(titleRow, metaSpan);

  const dueEdit = document.createElement('input');
  dueEdit.type = 'date';
  dueEdit.className = 'due-edit input h-8 w-36 shrink-0 text-xs';
  dueEdit.addEventListener('change', () => changeDue(task.id, dueEdit.value));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn btn-ghost';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  li.append(checkbox, info, dueEdit, deleteBtn);

  li._refs = { checkbox, titleRow, titleSpan, priorityBadge, metaSpan, dueEdit, overdueBadge: null };
  applyTask(li, task);
  return li;
}

function applyTask(li, task) {
  const refs = li._refs;
  // Any update to a row's content (an edit, a toggle, a refetched sort)
  // means it is no longer "just entered" — clearing this here, rather than
  // on a timer, is what stops a later unrelated change from replaying the
  // entrance animation on a row that only just finished it.
  delete li.dataset.animate;
  li.classList.toggle('overdue', isOverdue(task));

  refs.checkbox.checked = task.completed;

  refs.titleSpan.className = task.completed
    ? 'font-medium text-muted-foreground line-through transition-colors'
    : 'font-medium text-foreground transition-colors';
  refs.titleSpan.textContent = task.title;

  refs.priorityBadge.textContent = task.priority;

  if (isOverdue(task)) {
    if (!refs.overdueBadge) {
      refs.overdueBadge = document.createElement('span');
      refs.overdueBadge.className = 'badge badge-overdue';
      refs.overdueBadge.textContent = 'Overdue';
      refs.titleRow.append(refs.overdueBadge);
    }
  } else if (refs.overdueBadge) {
    refs.overdueBadge.remove();
    refs.overdueBadge = null;
  }

  const tags = task.tags && task.tags.length ? task.tags.join(', ') : 'none';
  const due = task.due || 'none';
  refs.metaSpan.textContent = `tags: ${tags}, due: ${due}`;

  refs.dueEdit.value = task.due || '';
}

function renderTasks() {
  const list = document.getElementById('todo-list');
  const existingRows = new Map();
  for (const li of list.children) existingRows.set(li.dataset.id, li);

  const seenIds = new Set();
  for (const task of tasks) {
    seenIds.add(task.id);
    let li = existingRows.get(task.id);
    if (li) applyTask(li, task);
    else li = createTaskElement(task);
    list.appendChild(li);
  }

  for (const [id, li] of existingRows) {
    if (!seenIds.has(id) && !exitingIds.has(id)) li.remove();
  }
}

// Picks where focus should land once a row currently holding it is taken
// out of the tab order (mid delete-fade) or removed outright, so it never
// silently falls back to the page background.
function pickFocusTarget(li) {
  const next = li.nextElementSibling?.querySelector('button.delete-btn');
  if (next) return next;
  const prev = li.previousElementSibling?.querySelector('button.delete-btn');
  if (prev) return prev;
  return document.getElementById('title-input');
}

function beginExit(li) {
  exitingIds.add(li.dataset.id);
  li.dataset.animate = 'exit';
  li.setAttribute('aria-hidden', 'true');
  li.setAttribute('inert', '');
  if (li.contains(document.activeElement)) {
    pickFocusTarget(li)?.focus();
  }
}

function finishExit(li) {
  exitingIds.delete(li.dataset.id);
  li.remove();
}

function tasksUrl() {
  return sort ? `/api/tasks?sort=${sort}` : '/api/tasks';
}

async function loadTasks() {
  const res = await fetch(tasksUrl());
  tasks = await res.json();
  renderTasks();
}

async function addTask(title, due) {
  const payload = due ? { title, due } : { title };
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const created = await res.json();
  tasks.push(created);
  renderTasks();
  const newLi = document.querySelector(`#todo-list li[data-id="${created.id}"]`);
  if (newLi) newLi.dataset.animate = 'enter';
}

async function changeDue(id, due) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ due: due || null }),
  });
  const updated = await res.json();
  tasks = tasks.map((task) => (task.id === id ? updated : task));
  renderTasks();
}

async function toggleDone(id, completed) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  const updated = await res.json();
  tasks = tasks.map((task) => (task.id === id ? updated : task));
  renderTasks();
}

async function deleteTask(id) {
  const li = document.querySelector(`#todo-list li[data-id="${id}"]`);
  if (li) beginExit(li);
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  tasks = tasks.filter((task) => task.id !== id);
  if (li) setTimeout(() => finishExit(li), rowAnimationDelay());
  else renderTasks();
}

function init() {
  loadTasks();
  document.getElementById('sort-select').addEventListener('change', (event) => {
    sort = event.target.value;
    loadTasks();
  });
  document.getElementById('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('title-input');
    const dueInput = document.getElementById('due-input');
    const title = input.value;
    const due = dueInput.value;
    input.value = '';
    dueInput.value = '';
    addTask(title, due);
  });
}

// `{ once: true }` guards against jsdom (used by the sandbox tests) firing
// DOMContentLoaded itself in addition to a test's own explicit dispatch.
document.addEventListener('DOMContentLoaded', init, { once: true });
