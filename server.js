const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initializeStorage, getStorage, getScopedStorage } = require('./storage/taskStore');

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
// Public Client Configuration Discovery (No Secrets Exposed)
// ==========================================================================
app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://liucmamlownxfshnaxtc.supabase.co',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
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

// Authentication Middleware: Verifies Bearer JWT for all task endpoints
async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }

  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const isDevelopment = process.env.NODE_ENV === 'development';

  // 1. In production, never accept tokens beginning with mock-user:
  if (isProduction && token.startsWith('mock-user:')) {
    return res.status(401).json({ error: 'Unauthorized: Mock tokens are forbidden in production' });
  }

  // 2. Test mock verifier: ONLY permitted in non-production environments
  if (!isProduction && req.app.locals && req.app.locals.mockAuthVerifier) {
    try {
      const user = await req.app.locals.mockAuthVerifier(token);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }
      req.user = user;
      req.userToken = token;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: Mock authentication failed' });
    }
  }

  // 3. Mock-token authentication: ONLY allowed when process.env.NODE_ENV === 'development'
  if (token.startsWith('mock-user:')) {
    if (isDevelopment) {
      const parts = token.split(':');
      if (parts.length >= 2 && parts[1]) {
        req.user = {
          id: parts[1],
          email: parts[2] ? decodeURIComponent(parts[2]) : 'dev@taskly.app'
        };
        req.userToken = token;
        return next();
      }
    }
    return res.status(401).json({ error: 'Unauthorized: Mock tokens are only allowed in development' });
  }

  // 4. Supabase JWT Authentication
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  // In production, fail closed if Supabase authentication configuration is missing
  if (isProduction && (!supabaseUrl || !supabaseAnonKey)) {
    console.error('[Auth Security]: Supabase configuration missing in production for authenticated request.');
    return res.status(500).json({ error: 'Server configuration error: Authentication service is unavailable' });
  }

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const { createClient } = require('@supabase/supabase-js');

      // Test client injection allowed ONLY in non-production environments
      const authClient = (!isProduction && req.app.locals && req.app.locals.mockAuthClient)
        ? req.app.locals.mockAuthClient
        : createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false }
          });

      const { data, error } = await authClient.auth.getUser(token);
      const user = data ? data.user : null;

      if (error || !user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }

      req.user = user;
      req.userToken = token;
      return next();
    } catch (err) {
      console.error('[Auth Error]: Token validation exception:', err.message);
      return res.status(401).json({ error: 'Unauthorized: Token validation failed' });
    }
  }

  // Non-production without Supabase configuration: unverified tokens are rejected
  return res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
}

app.authenticateUser = authenticateUser;

// Enforce authentication on all /api/todos endpoints
app.use('/api/todos', authenticateUser);

// GET /api/todos - Retrieve todos for authenticated user
app.get('/api/todos', async (req, res, next) => {
  try {
    const storage = getScopedStorage(req);
    const todos = await storage.getAllTasks(req.user.id);
    res.json(todos);
  } catch (err) {
    next(err);
  }
});

// POST /api/todos - Add a new todo scoped to authenticated user
app.post('/api/todos', async (req, res, next) => {
  try {
    const { title, dueDate, description, priority, category, time, reminder } = req.body;
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

    const validPriorities = ['High', 'Medium', 'Low'];
    const parsedPriority = validPriorities.includes(priority) ? priority : 'Medium';

    const validCategories = ['Project', 'Work', 'Study', 'Personal'];
    const parsedCategory = validCategories.includes(category) ? category : 'Personal';

    const newTodo = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      user_id: req.user.id,
      title: trimmedTitle,
      dueDate: parsedDueDate,
      time: typeof time === 'string' && time.trim() ? time.trim().slice(0, 30) : null,
      description: typeof description === 'string' ? description.trim().slice(0, 1000) : '',
      priority: parsedPriority,
      category: parsedCategory,
      reminder: Boolean(reminder),
      completed: false,
      createdAt: new Date().toISOString()
    };

    const storage = getScopedStorage(req);
    await storage.createTask(newTodo, req.user.id);

    res.status(201).json(newTodo);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/todos/:id - Update todo with validation (scoped to authenticated user)
app.patch('/api/todos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { completed, title, dueDate, description, priority, category, time, reminder } = req.body;
    const storage = getScopedStorage(req);

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

    if (typeof description === 'string') {
      updateFields.description = description.trim().slice(0, 1000);
    }

    if (['High', 'Medium', 'Low'].includes(priority)) {
      updateFields.priority = priority;
    }

    if (['Project', 'Work', 'Study', 'Personal'].includes(category)) {
      updateFields.category = category;
    }

    if (time !== undefined) {
      updateFields.time = typeof time === 'string' && time.trim() ? time.trim().slice(0, 30) : null;
    }

    if (typeof reminder === 'boolean') {
      updateFields.reminder = reminder;
    }

    const updated = await storage.updateTask(id, updateFields, req.user.id);
    if (!updated) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos/:id - Delete a single todo (scoped to authenticated user)
app.delete('/api/todos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const storage = getScopedStorage(req);
    const success = await storage.deleteTask(id, req.user.id);

    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos - Bulk clear completed (scoped to authenticated user)
app.delete('/api/todos', async (req, res, next) => {
  try {
    const storage = getScopedStorage(req);
    const deletedCount = await storage.clearCompleted(req.user.id);
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
