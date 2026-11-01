const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

// Ensure data directory and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultTodos = [
  {
    id: 'sample-1',
    title: 'Explore your new To-Do app',
    completed: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'sample-2',
    title: 'Check off this task when completed',
    completed: true,
    createdAt: new Date(Date.now() - 3600000).toISOString()
  }
];

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultTodos, null, 2), 'utf8');
}

// Helper to read todos
function readTodos() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading todos file:', err);
    return [];
  }
}

// Helper to write todos
function writeTodos(todos) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing todos file:', err);
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// GET /api/todos - Retrieve all todos
app.get('/api/todos', (req, res) => {
  const todos = readTodos();
  res.json(todos);
});

// POST /api/todos - Add a new todo
app.post('/api/todos', (req, res) => {
  const { title, dueDate } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const todos = readTodos();
  const newTodo = {
    id: crypto.randomUUID(),
    title: title.trim(),
    dueDate: dueDate && typeof dueDate === 'string' && dueDate.trim() ? dueDate.trim() : null,
    completed: false,
    createdAt: new Date().toISOString()
  };

  todos.unshift(newTodo);
  writeTodos(todos);

  res.status(201).json(newTodo);
});

// PATCH /api/todos/:id - Update todo (completion, title, or dueDate)
app.patch('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const { completed, title, dueDate } = req.body;

  const todos = readTodos();
  const todoIndex = todos.findIndex(t => t.id === id);

  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (typeof completed === 'boolean') {
    todos[todoIndex].completed = completed;
    todos[todoIndex].updatedAt = new Date().toISOString();
  }

  if (typeof title === 'string' && title.trim()) {
    todos[todoIndex].title = title.trim();
    todos[todoIndex].updatedAt = new Date().toISOString();
  }

  if (dueDate !== undefined) {
    todos[todoIndex].dueDate = dueDate && typeof dueDate === 'string' && dueDate.trim() ? dueDate.trim() : null;
    todos[todoIndex].updatedAt = new Date().toISOString();
  }

  writeTodos(todos);
  res.json(todos[todoIndex]);
});

// DELETE /api/todos/:id - Delete a single todo
app.delete('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const todos = readTodos();
  const exists = todos.some(t => t.id === id);

  if (!exists) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const updatedTodos = todos.filter(t => t.id !== id);
  writeTodos(updatedTodos);

  res.json({ success: true, id });
});

// DELETE /api/todos - Bulk clear completed
app.delete('/api/todos', (req, res) => {
  const todos = readTodos();
  const remaining = todos.filter(t => !t.completed);
  const deletedCount = todos.length - remaining.length;
  writeTodos(remaining);

  res.json({ success: true, count: deletedCount });
});

app.listen(PORT, () => {
  console.log(`To-Do server is running on http://localhost:${PORT}`);
});
