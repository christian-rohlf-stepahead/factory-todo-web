// Keeps the rendered list in sync with a local copy of the tasks, updated
// from each mutating call's own response, rather than re-fetching the whole
// list after every change.
let tasks = [];
let sort = '';

function isOverdue(task) {
  if (task.completed || !task.due) return false;
  return task.due < todayDate();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createTaskElement(task) {
  const li = document.createElement('li');
  li.dataset.id = task.id;
  li.classList.toggle('overdue', isOverdue(task));

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', () => toggleDone(task.id, checkbox.checked));

  const label = document.createElement('span');
  const tags = task.tags && task.tags.length ? task.tags.join(', ') : 'none';
  const due = task.due || 'none';
  label.textContent = ` ${task.title} — priority: ${task.priority}, tags: ${tags}, due: ${due} `;

  const dueEdit = document.createElement('input');
  dueEdit.type = 'date';
  dueEdit.className = 'due-edit';
  dueEdit.value = task.due || '';
  dueEdit.addEventListener('change', () => changeDue(task.id, dueEdit.value));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  li.append(checkbox, label, dueEdit, deleteBtn);
  return li;
}

function renderTasks() {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';
  for (const task of tasks) list.appendChild(createTaskElement(task));
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
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  tasks = tasks.filter((task) => task.id !== id);
  renderTasks();
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
