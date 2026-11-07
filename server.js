const fs = require('fs');
const path = require('path');

// Safely load local .env before configuration is initialized
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
    } else {
      require('dotenv').config({ path: envPath });
    }
  } catch (_) {}
}

const express = require('express');
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

// Centralized Version Update Manifest Endpoint (no-cache to ensure immediate updates)
app.use('/releases', express.static(path.join(__dirname, 'releases'), {
  maxAge: '0'
}));

// Dedicated Email Confirmation Success Page
app.get(['/auth/confirmed', '/auth/confirmed.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth', 'confirmed.html'));
});

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
// Canonical Application URL Discovery (Environment-Aware)
// ==========================================================================
function getCanonicalAppUrl() {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const vercelEnv = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'

  function validateUrl(urlStr, requireHttps = false) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const trimmed = urlStr.trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (requireHttps) {
        if (parsed.protocol !== 'https:') return null;
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
      }
      return `${parsed.protocol}//${parsed.host}`;
    } catch (_) {
      return null;
    }
  }

  // 1. In Vercel Preview: Deployment-specific VERCEL_URL always wins over a globally configured Production APP_URL
  if (isVercel && vercelEnv === 'preview') {
    if (process.env.VERCEL_URL) {
      const previewUrl = validateUrl(process.env.VERCEL_URL, true);
      if (previewUrl) return previewUrl;
    }
    // If VERCEL_URL is missing, fallback to explicit APP_URL or VERCEL_PROJECT_PRODUCTION_URL
    const rawExplicit = process.env.APP_URL || process.env.SITE_URL;
    if (rawExplicit) {
      const validated = validateUrl(rawExplicit, true);
      if (validated) return validated;
    }
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      const prodUrl = validateUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL, true);
      if (prodUrl) return prodUrl;
    }
    return null;
  }

  // 2. Explicitly configured APP_URL or SITE_URL environment variable (Production & Development)
  const rawExplicit = process.env.APP_URL || process.env.SITE_URL;
  if (rawExplicit) {
    const validated = validateUrl(rawExplicit, isProduction);
    if (validated) {
      return validated;
    }
    // In production, reject invalid, malformed, non-HTTPS, or localhost APP_URL
    if (isProduction) {
      return null;
    }
  }

  // 3. Vercel Production environment detection
  if (isVercel) {
    // In Vercel Production: Prioritize VERCEL_PROJECT_PRODUCTION_URL
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      const prodUrl = validateUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL, true);
      if (prodUrl) return prodUrl;
    }
    if (process.env.VERCEL_URL) {
      const vercelUrl = validateUrl(process.env.VERCEL_URL, true);
      if (vercelUrl) return vercelUrl;
    }
  }

  // 4. For deployed production environments, do NOT derive from untrusted Host headers.
  // If no canonical APP_URL is configured in production, fail closed by returning null.
  if (isProduction) {
    return null;
  }

  // 5. For local development, default to local server URL
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

app.getCanonicalAppUrl = getCanonicalAppUrl;

// ==========================================================================
// Local UI Preview Gate (Strict Environment Isolation)
// ==========================================================================
function isLocalPreviewAllowed(req) {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  // Condition 1: NODE_ENV must be exactly 'development' (never in production or Vercel)
  if (process.env.NODE_ENV !== 'development' || isVercel) {
    return false;
  }

  // Condition 2: The application is running on localhost (not a deployed domain or mobile origin)
  const rawHost = (req ? (req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '') : '').toLowerCase();
  const hostWithoutPort = rawHost.split(':')[0];
  const isLocalHost = hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1' || hostWithoutPort === '::1';
  if (!isLocalHost) {
    return false;
  }

  // Condition 3: Preview flag must be explicitly enabled
  const previewFlagEnabled = process.env.ENABLE_LOCAL_PREVIEW === 'true' || process.env.ALLOW_LOCAL_PREVIEW === 'true' || process.env.LOCAL_PREVIEW === 'true';
  if (!previewFlagEnabled) {
    return false;
  }

  return true;
}

app.isLocalPreviewAllowed = isLocalPreviewAllowed;

// ==========================================================================
// Public Client Configuration Discovery (No Secrets Exposed)
// ==========================================================================
app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://liucmamlownxfshnaxtc.supabase.co',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    appUrl: getCanonicalAppUrl(),
    previewModeAllowed: isLocalPreviewAllowed(req)
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
          email: parts[2] ? decodeURIComponent(parts[2]) : 'dev@taskly.app',
          email_confirmed_at: new Date().toISOString()
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
        if (error) {
          console.warn('[Auth]: Supabase getUser verification rejected token:', error.message || error);
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }

      // Enforce verified email requirement using trusted Supabase Auth user data
      const isEmailVerified = Boolean(
        user.email_confirmed_at ||
        user.confirmed_at ||
        (user.app_metadata && user.app_metadata.provider && user.app_metadata.provider !== 'email')
      );

      if (!isEmailVerified) {
        return res.status(403).json({
          error: 'Forbidden: Email address is not verified. Please verify your email to access tasks.'
        });
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

    let parsedCategory = 'Personal';
    if (typeof category === 'string' && category.trim()) {
      const trimmedCat = category.trim().slice(0, 50);
      const standard = ['project', 'work', 'study', 'personal'];
      const matchedStandard = standard.find(s => s.toLowerCase() === trimmedCat.toLowerCase());
      if (matchedStandard) {
        parsedCategory = matchedStandard.charAt(0).toUpperCase() + matchedStandard.slice(1);
      } else {
        parsedCategory = trimmedCat;
      }
    }

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

    if (category !== undefined) {
      if (typeof category === 'string' && category.trim()) {
        const trimmedCat = category.trim().slice(0, 50);
        const standard = ['project', 'work', 'study', 'personal'];
        const matchedStandard = standard.find(s => s.toLowerCase() === trimmedCat.toLowerCase());
        updateFields.category = matchedStandard
          ? matchedStandard.charAt(0).toUpperCase() + matchedStandard.slice(1)
          : trimmedCat;
      } else {
        updateFields.category = 'Personal';
      }
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
