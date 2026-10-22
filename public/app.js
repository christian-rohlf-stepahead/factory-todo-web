// Keeps the rendered list in sync with a local copy of the tasks, updated
// from each mutating call's own response, rather than re-fetching the whole
// list after every change.
let tasks = [];

function createTaskElement(task) {
  const li = document.createElement('li');
  li.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', () => toggleDone(task.id, checkbox.checked));

  const label = document.createElement('span');
  const tags = task.tags && task.tags.length ? task.tags.join(', ') : 'none';
  const due = task.due || 'none';
  label.textContent = ` ${task.title} — priority: ${task.priority}, tags: ${tags}, due: ${due} `;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  li.append(checkbox, label, deleteBtn);
  return li;
}

function renderTasks() {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';
  for (const task of tasks) list.appendChild(createTaskElement(task));
}

async function loadTasks() {
  const res = await fetch('/api/tasks');
  tasks = await res.json();
  renderTasks();
}

async function addTask(title) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const created = await res.json();
  tasks.push(created);
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
  document.getElementById('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('title-input');
    const title = input.value;
    input.value = '';
    addTask(title);
  });
}

// `{ once: true }` guards against jsdom (used by the sandbox tests) firing
// DOMContentLoaded itself in addition to a test's own explicit dispatch.
document.addEventListener('DOMContentLoaded', init, { once: true });
