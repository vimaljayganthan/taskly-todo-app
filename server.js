const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initializeStorage, getStorage } = require('./storage/taskStore');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Disable Express fingerprinting
app.disable('x-powered-by');

// Security: HTTP Response Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS Middleware (Enables Capacitor mobile apps on iOS & Android to communicate with API)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Structured Production Request Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
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

// Storage Initialization Middleware (Guarantees database adapter is ready in serverless environments like Vercel)
app.use('/api', async (req, res, next) => {
  try {
    await initializeStorage();
    next();
  } catch (err) {
    console.error('[Storage Error in Request]:', err.message);
    res.status(500).json({
      error: err.message || 'Database connection error'
    });
  }
});

// GET /api/todos - Retrieve all todos
app.get('/api/todos', async (req, res, next) => {
  try {
    const storage = getStorage();
    const todos = await storage.getAllTasks();
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

    const newTodo = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      dueDate: parsedDueDate,
      completed: false,
      createdAt: new Date().toISOString()
    };

    const storage = getStorage();
    await storage.createTask(newTodo);

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
    const storage = getStorage();

    const updateFields = {
      updatedAt: new Date().toISOString()
    };

    if (typeof completed === 'boolean') {
      updateFields.completed = completed;
    }

    if (typeof title === 'string') {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      if (trimmedTitle.length > 150) {
        return res.status(400).json({ error: 'Title must not exceed 150 characters' });
      }
      updateFields.title = trimmedTitle;
    }

    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === '') {
        updateFields.dueDate = null;
      } else if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
        updateFields.dueDate = dueDate.trim();
      } else {
        return res.status(400).json({ error: 'Due date must be in YYYY-MM-DD format' });
      }
    }

    const updated = await storage.updateTask(id, updateFields);
    if (!updated) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos/:id - Delete a single todo
app.delete('/api/todos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const storage = getStorage();
    const success = await storage.deleteTask(id);

    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos - Bulk clear completed
app.delete('/api/todos', async (req, res, next) => {
  try {
    const storage = getStorage();
    const deletedCount = await storage.clearCompleted();
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
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

async function startServer() {
  try {
    await initializeStorage();
  } catch (err) {
    console.error('Fatal storage initialization error:', err.message);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`To-Do server is running on http://localhost:${PORT}`);
  });
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

if (require.main === module) {
  startServer();
}

module.exports = app;
