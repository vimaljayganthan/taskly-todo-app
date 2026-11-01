const express = require('express');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

// Security: Disable Express fingerprinting
app.disable('x-powered-by');

// Ensure data directory exists synchronously at startup
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

// Asynchronous helper to read todos
async function readTodos() {
  try {
    const raw = await fsPromises.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultTodos;
    }
    console.error('Error reading todos file:', err);
    return [];
  }
}

// Asynchronous atomic write helper (writes to temporary file, then atomically renames)
async function writeTodos(todos) {
  const tempFile = `${DATA_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    await fsPromises.writeFile(tempFile, JSON.stringify(todos, null, 2), 'utf8');
    await fsPromises.rename(tempFile, DATA_FILE);
  } catch (err) {
    console.error('Error writing todos file:', err);
    try {
      if (fs.existsSync(tempFile)) await fsPromises.unlink(tempFile);
    } catch (_) {}
    throw err;
  }
}

// Security: HTTP Response Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Structured Production Request Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Keep liveness probes quiet in logs
    if (req.path !== '/healthz') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Middleware: JSON Body Parser with strict 20kb payload limit
app.use(express.json({ limit: '20kb' }));

// Static Assets: Serve public directory with caching headers in production
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
}));

// ==========================================================================
// Health Check Endpoints (Required for Google Cloud Run / Load Balancers)
// ==========================================================================
app.get(['/healthz', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ==========================================================================
// REST API Routes
// ==========================================================================

// GET /api/todos - Retrieve all todos
app.get('/api/todos', async (req, res, next) => {
  try {
    const todos = await readTodos();
    res.json(todos);
  } catch (err) {
    next(err);
  }
});

// POST /api/todos - Add a new todo with input validation
app.post('/api/todos', async (req, res, next) => {
  try {
    const { title, dueDate } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 150) {
      return res.status(400).json({ error: 'Title must not exceed 150 characters' });
    }

    let parsedDueDate = null;
    if (dueDate && typeof dueDate === 'string' && dueDate.trim()) {
      const trimmedDate = dueDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        return res.status(400).json({ error: 'Due date must be in YYYY-MM-DD format' });
      }
      parsedDueDate = trimmedDate;
    }

    const todos = await readTodos();
    const newTodo = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      dueDate: parsedDueDate,
      completed: false,
      createdAt: new Date().toISOString()
    };

    todos.unshift(newTodo);
    await writeTodos(todos);

    res.status(201).json(newTodo);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/todos/:id - Update todo with validation
app.patch('/api/todos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { completed, title, dueDate } = req.body;

    const todos = await readTodos();
    const todoIndex = todos.findIndex(t => t.id === id);

    if (todoIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (typeof completed === 'boolean') {
      todos[todoIndex].completed = completed;
      todos[todoIndex].updatedAt = new Date().toISOString();
    }

    if (typeof title === 'string') {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      if (trimmedTitle.length > 150) {
        return res.status(400).json({ error: 'Title must not exceed 150 characters' });
      }
      todos[todoIndex].title = trimmedTitle;
      todos[todoIndex].updatedAt = new Date().toISOString();
    }

    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === '') {
        todos[todoIndex].dueDate = null;
      } else if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
        todos[todoIndex].dueDate = dueDate.trim();
      } else {
        return res.status(400).json({ error: 'Due date must be in YYYY-MM-DD format' });
      }
      todos[todoIndex].updatedAt = new Date().toISOString();
    }

    await writeTodos(todos);
    res.json(todos[todoIndex]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos/:id - Delete a single todo
app.delete('/api/todos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const todos = await readTodos();
    const exists = todos.some(t => t.id === id);

    if (!exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updatedTodos = todos.filter(t => t.id !== id);
    await writeTodos(updatedTodos);

    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos - Bulk clear completed
app.delete('/api/todos', async (req, res, next) => {
  try {
    const todos = await readTodos();
    const remaining = todos.filter(t => !t.completed);
    const deletedCount = todos.length - remaining.length;
    await writeTodos(remaining);

    res.json({ success: true, count: deletedCount });
  } catch (err) {
    next(err);
  }
});

// 404 Handler for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Centralized Production Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ==========================================================================
// Server Startup & Graceful Shutdown (Cloud Run Lifecycle Support)
// ==========================================================================
let server;

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed. Exiting process.');
      process.exit(0);
    });
    // Force shutdown if connections do not close in 10s
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`To-Do server is running on http://localhost:${PORT}`);
  });
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
