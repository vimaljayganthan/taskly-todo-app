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
const SmartListStore = require('./storage/smartListStore');
const SupportStore = require('./storage/supportStore');
const HabitStreakService = require('./services/habitStreakService');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Idempotency-Key');
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

// Middleware: JSON Body Parser with strict 20kb payload limit and rawBody capture for cryptographic signature verification
app.use(express.json({
  limit: '20kb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

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

// ==========================================================================
// Smart Lists API Endpoints (v1.9.0 Build 10)
// ==========================================================================
app.use('/api/smart-lists', authenticateUser);

// Routines CRUD
app.get('/api/smart-lists/routines', async (req, res, next) => {
  try {
    const date = req.query.date;
    const routines = await SmartListStore.getRoutines(req.user.id, date);
    res.json(routines);
  } catch (err) {
    next(err);
  }
});

app.post('/api/smart-lists/routines', async (req, res, next) => {
  try {
    const { title, orderIndex } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Routine title is required' });
    }
    const trimmed = title.trim();
    if (trimmed.length > 150) {
      return res.status(400).json({ error: 'Routine title must not exceed 150 characters' });
    }
    const existing = await SmartListStore.getRoutines(req.user.id);
    if (existing.some(r => r.title.toLowerCase() === trimmed.toLowerCase())) {
      return res.status(409).json({ error: 'A routine with this name already exists' });
    }
    const routine = await SmartListStore.addRoutine(req.user.id, { title: trimmed, orderIndex });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/smart-lists/routines/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, orderIndex } = req.body;
    if (title !== undefined && (!title || typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'Routine title cannot be empty' });
    }
    const updated = await SmartListStore.updateRoutine(req.user.id, id, { title, orderIndex });
    if (!updated) return res.status(404).json({ error: 'Routine not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/smart-lists/routines/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const success = await SmartListStore.deleteRoutine(req.user.id, id);
    if (!success) return res.status(404).json({ error: 'Routine not found' });
    res.json({ success: true, id });
  } catch (err) {
    next(err);
  }
});

// Daily Completions & 4-State Routine Operations
app.get('/api/smart-lists/completions', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const completions = await SmartListStore.getCompletions(req.user.id, date);
    res.json(completions);
  } catch (err) {
    next(err);
  }
});

app.post('/api/smart-lists/completions', async (req, res, next) => {
  try {
    const { routineId, date, completed, carriedForward, status, postponedTo, cancellationReason } = req.body;
    if (!routineId || !date) {
      return res.status(400).json({ error: 'routineId and date are required' });
    }
    const record = await SmartListStore.setCompletion(req.user.id, {
      routineId,
      date,
      completed,
      carriedForward,
      status,
      postponedTo,
      cancellationReason
    });
    res.json(record);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Update authoritative routine status (completed, pending, postponed, cancelled)
app.patch('/api/smart-lists/completions/status', async (req, res, next) => {
  try {
    const { routineId, date, status, postponedTo, cancellationReason } = req.body;
    if (!routineId || !date || !status) {
      return res.status(400).json({ error: 'routineId, date, and status are required' });
    }
    const result = await SmartListStore.setRoutineStatus(req.user.id, {
      routineId,
      date,
      status,
      postponedTo,
      cancellationReason
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Postpone a routine to a future date
app.post('/api/smart-lists/routines/:id/postpone', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, postponedTo } = req.body;
    if (!date || !postponedTo) {
      return res.status(400).json({ error: 'date and postponedTo are required' });
    }
    const result = await SmartListStore.postponeRoutine(req.user.id, id, date, postponedTo);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Cancel a routine with optional cancellation reason
app.post('/api/smart-lists/routines/:id/cancel', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, cancellationReason } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }
    const record = await SmartListStore.cancelRoutine(req.user.id, id, date, cancellationReason);
    res.json({ success: true, record });
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Undo cancellation of a routine
app.post('/api/smart-lists/routines/:id/undo-cancel', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }
    const record = await SmartListStore.undoCancelRoutine(req.user.id, id, date);
    res.json({ success: true, record });
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Carry-Forward Decision Execution (Yes: carry incomplete routines forward to tomorrow; No: finish today)
app.post('/api/smart-lists/carry-forward', async (req, res, next) => {
  try {
    const { date, decision } = req.body;
    if (!date || !decision) {
      return res.status(400).json({ error: 'date and decision ("yes" | "no") are required' });
    }
    const result = await SmartListStore.carryForward(req.user.id, { date, decision });
    res.json(result);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// Next-Day Routines Management Endpoints
app.get('/api/smart-lists/next-day', async (req, res, next) => {
  try {
    const date = req.query.date;
    const result = await SmartListStore.getNextDayRoutines(req.user.id, { date });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/smart-lists/next-day/assign', async (req, res, next) => {
  try {
    const { routineId, date, title, isOneDay } = req.body;
    const result = await SmartListStore.assignRoutineToDate(req.user.id, { routineId, date, title, isOneDay });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

app.patch('/api/smart-lists/next-day/occurrences/:routineId', async (req, res, next) => {
  try {
    const { routineId } = req.params;
    const { date, title, applyToFuture } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Routine title is required' });
    }
    const result = await SmartListStore.updateOccurrenceTitle(req.user.id, {
      routineId,
      date,
      title,
      applyToFuture: Boolean(applyToFuture)
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

app.delete('/api/smart-lists/next-day/occurrences/:routineId', async (req, res, next) => {
  try {
    const { routineId } = req.params;
    const date = req.query.date || req.body?.date;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }
    const result = await SmartListStore.removeOccurrenceFromDate(req.user.id, { routineId, date });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Reset Habit Streak Endpoint
app.post('/api/smart-lists/streaks/reset', async (req, res, next) => {
  try {
    const { resetAt } = req.body;
    const result = await SmartListStore.resetStreak(req.user.id, { resetAt });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Habit Streaks & Consistency Analytics Endpoints
app.get('/api/smart-lists/statistics/daily', async (req, res, next) => {
  try {
    const date = req.query.date || HabitStreakService.toYmdString(new Date());
    const settings = await SmartListStore.getSettings(req.user.id);
    const routines = await SmartListStore.getRoutines(req.user.id);
    const completions = await SmartListStore.getCompletions(req.user.id, date);
    const stats = HabitStreakService.calculateDayStatistics({
      routines,
      completions,
      date,
      resetAt: settings?.streakResetAt || null
    });
    res.json(stats);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

app.get('/api/smart-lists/statistics/consistency', async (req, res, next) => {
  try {
    const date = req.query.date || HabitStreakService.toYmdString(new Date());
    const settings = await SmartListStore.getSettings(req.user.id);
    const routines = await SmartListStore.getRoutines(req.user.id);
    const completions = await SmartListStore.getAllCompletions(req.user.id);
    const consistency = HabitStreakService.calculateConsistency({
      routines,
      completions,
      date,
      resetAt: settings?.streakResetAt || null
    });
    res.json(consistency);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

app.get('/api/smart-lists/streaks', async (req, res, next) => {
  try {
    const refDate = req.query.refDate || HabitStreakService.toYmdString(new Date());
    const settings = await SmartListStore.getSettings(req.user.id);
    const routines = await SmartListStore.getRoutines(req.user.id);
    const completions = await SmartListStore.getAllCompletions(req.user.id);
    const streaks = HabitStreakService.calculateStreaks({
      routines,
      completions,
      refDate,
      resetAt: settings?.streakResetAt || null
    });
    res.json(streaks);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

app.get('/api/smart-lists/performance', async (req, res, next) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const routines = await SmartListStore.getRoutines(req.user.id);
    const completions = await SmartListStore.getAllCompletions(req.user.id);
    const performance = HabitStreakService.getHistoricalPerformance({
      routines,
      completions,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : 30
    });
    res.json(performance);
  } catch (err) {
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// Daily Summary Reports
app.get('/api/smart-lists/reports', async (req, res, next) => {
  try {
    const reports = await SmartListStore.getReports(req.user.id);
    res.json(reports);
  } catch (err) {
    next(err);
  }
});

app.get('/api/smart-lists/reports/:date', async (req, res, next) => {
  try {
    const report = await SmartListStore.getReport(req.user.id, req.params.date);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

app.post('/api/smart-lists/reports', async (req, res, next) => {
  try {
    const { date, totalRoutines, completedCount, incompleteCount, completionRate, status, completedRoutines, incompleteRoutines, carryForwardDecision } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });
    const report = await SmartListStore.saveReport(req.user.id, {
      date,
      totalRoutines,
      completedCount,
      incompleteCount,
      completionRate,
      status,
      completedRoutines,
      incompleteRoutines,
      carryForwardDecision
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/smart-lists/reports/:id', async (req, res, next) => {
  try {
    const success = await SmartListStore.deleteReport(req.user.id, req.params.id);
    if (!success) return res.status(404).json({ error: 'Report not found' });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Settings (Daily summary time & toggle)
app.get('/api/smart-lists/settings', async (req, res, next) => {
  try {
    const settings = await SmartListStore.getSettings(req.user.id);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

app.post('/api/smart-lists/settings', async (req, res, next) => {
  try {
    const settings = await SmartListStore.saveSettings(req.user.id, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
// Productivity Analytics API Endpoints (v2.0.0 Build 11)
// ==========================================================================
app.use('/api/analytics', authenticateUser);

app.get('/api/analytics/productivity', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const refDate = req.query.refDate || HabitStreakService.toYmdString(new Date());

    // 1. Fetch user's tasks
    const storage = getScopedStorage(req);
    const todos = await storage.getAllTasks(userId);

    // 2. Fetch routines, completions, and settings
    const settings = await SmartListStore.getSettings(userId);
    const resetAt = settings?.streakResetAt || null;
    const routines = await SmartListStore.getRoutines(userId);
    const allCompletions = await SmartListStore.getAllCompletions(userId);
    const todayCompletions = await SmartListStore.getCompletions(userId, refDate);

    // 3. Compute habit streaks and consistency
    const streaks = HabitStreakService.calculateStreaks({ routines, completions: allCompletions, refDate, resetAt });
    const consistency = HabitStreakService.calculateConsistency({ routines, completions: allCompletions, date: refDate, resetAt });
    const todayStats = HabitStreakService.calculateDayStatistics({ routines, completions: todayCompletions, date: refDate, resetAt });

    // 4. Compute task metrics
    const now = new Date(refDate + 'T23:59:59');
    let completedCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    let onTimeCount = 0;
    let tasksWithDueDateCount = 0;
    const categoryCounts = {};

    todos.forEach(task => {
      const cat = (task.category || 'General').trim();
      if (!categoryCounts[cat]) categoryCounts[cat] = { total: 0, completed: 0, pending: 0 };
      categoryCounts[cat].total++;

      if (task.completed) {
        completedCount++;
        categoryCounts[cat].completed++;
        if (task.dueDate) {
          tasksWithDueDateCount++;
          const due = new Date(task.dueDate);
          const completedAt = task.completedAt ? new Date(task.completedAt) : new Date(task.updatedAt || task.createdAt || now);
          if (completedAt <= due) {
            onTimeCount++;
          }
        }
      } else {
        pendingCount++;
        categoryCounts[cat].pending++;
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueCount++;
        }
      }
    });

    const totalTasks = completedCount + pendingCount;
    const taskCompletionRate = totalTasks > 0 ? (completedCount / totalTasks) : null;
    const onTimeCompletionRate = tasksWithDueDateCount > 0 ? (onTimeCount / tasksWithDueDateCount) : null;

    // Overall Productivity Score Calculation
    let overallScore = null;
    let taskScoreComponent = null;
    if (taskCompletionRate !== null) {
      if (onTimeCompletionRate !== null) {
        taskScoreComponent = (0.7 * taskCompletionRate) + (0.3 * onTimeCompletionRate);
      } else {
        taskScoreComponent = taskCompletionRate;
      }
    }

    const routineScoreComponent = (consistency && consistency.weekly && consistency.weekly.totalDays > 0)
      ? (consistency.weekly.percentage / 100)
      : null;

    if (taskScoreComponent !== null && routineScoreComponent !== null) {
      overallScore = Math.round(((taskScoreComponent * 0.6) + (routineScoreComponent * 0.4)) * 100);
    } else if (taskScoreComponent !== null) {
      overallScore = Math.round(taskScoreComponent * 100);
    } else if (routineScoreComponent !== null) {
      overallScore = Math.round(routineScoreComponent * 100);
    }

    res.json({
      refDate,
      overallScore,
      taskMetrics: {
        total: totalTasks,
        completed: completedCount,
        pending: pendingCount,
        overdue: overdueCount,
        taskCompletionRate: taskCompletionRate !== null ? Math.round(taskCompletionRate * 100) : null,
        onTimeCompletionRate: onTimeCompletionRate !== null ? Math.round(onTimeCompletionRate * 100) : null,
        categoryCounts
      },
      routineMetrics: {
        currentStreak: streaks.currentStreak,
        longestStreak: streaks.longestStreak,
        todayCompletionRate: todayStats.completionRate,
        weeklyConsistency: consistency.weekly.percentage,
        monthlyConsistency: consistency.monthly.percentage,
        breakdown: {
          completed: todayStats.completedCount,
          pending: todayStats.pendingCount,
          postponed: todayStats.postponedCount,
          cancelled: todayStats.cancelledCount,
          eligible: todayStats.eligibleCount
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
// Customer Support & Ticket Management API Routes (Stage 1 Foundation)
// ==========================================================================

// Enforce authentication on all /api/support/tickets routes
app.use('/api/support/tickets', authenticateUser);

// POST /api/support/tickets - Create a new support ticket
app.post('/api/support/tickets', async (req, res, next) => {
  try {
    const { subject, description, body, priority, category } = req.body || {};
    const idempotencyKey = (
      req.headers['idempotency-key'] ||
      (req.body && (req.body.idempotency_key || req.body.idempotencyKey)) ||
      null
    );

    // Validate subject (1..255 characters)
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required and must not be empty' });
    }
    const trimmedSubject = subject.trim();
    if (trimmedSubject.length > 255) {
      return res.status(400).json({ error: 'Subject must not exceed 255 characters' });
    }

    // Validate description / body (1..10000 characters)
    const rawBody = description !== undefined ? description : body;
    if (!rawBody || typeof rawBody !== 'string' || !rawBody.trim()) {
      return res.status(400).json({ error: 'Description/body is required and must not be empty' });
    }
    const trimmedBody = rawBody.trim();
    if (trimmedBody.length > 10000) {
      return res.status(400).json({ error: 'Description/body must not exceed 10000 characters' });
    }

    // Validate priority (optional, default 'normal')
    let parsedPriority = 'normal';
    if (priority !== undefined && priority !== null) {
      if (typeof priority !== 'string' || !SupportStore.VALID_PRIORITIES.includes(priority.trim().toLowerCase())) {
        return res.status(400).json({
          error: `Invalid priority. Must be one of: ${SupportStore.VALID_PRIORITIES.join(', ')}`
        });
      }
      parsedPriority = priority.trim().toLowerCase();
    }

    // Validate category (optional, default 'general')
    let parsedCategory = 'general';
    if (category !== undefined && category !== null) {
      if (typeof category !== 'string' || !SupportStore.VALID_CATEGORIES.includes(category.trim().toLowerCase())) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${SupportStore.VALID_CATEGORIES.join(', ')}`
        });
      }
      parsedCategory = category.trim().toLowerCase();
    }

    // Validate idempotencyKey length if provided
    let cleanIdempotencyKey = null;
    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.trim().length > 255) {
        return res.status(400).json({ error: 'Idempotency key must be a non-empty string up to 255 characters' });
      }
      cleanIdempotencyKey = idempotencyKey.trim();
    }

    // Identity is strictly bound to verified JWT - ignore client spoofing
    const userId = req.user.id;
    const userEmail = req.user.email || 'customer@taskly.app';

    const storage = SupportStore.getScopedStorage(req);
    const ticket = await storage.createTicket({
      userId,
      userEmail,
      subject: trimmedSubject,
      description: trimmedBody,
      priority: parsedPriority,
      category: parsedCategory,
      idempotencyKey: cleanIdempotencyKey
    });

    if (ticket.is_replay) {
      return res.status(200).json(ticket);
    }
    return res.status(201).json(ticket);
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/support/tickets - List authenticated user's tickets
app.get('/api/support/tickets', async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;

    let cleanStatus = null;
    if (status) {
      cleanStatus = SupportStore.normalizeStatus(status);
      if (!SupportStore.VALID_STATUSES.includes(cleanStatus)) {
        return res.status(400).json({
          error: `Invalid status filter. Must be one of: ${SupportStore.VALID_STATUSES.join(', ')}`
        });
      }
    }

    const storage = SupportStore.getScopedStorage(req);
    const tickets = await storage.listTickets(req.user.id, {
      status: cleanStatus,
      limit,
      offset
    });

    res.json(tickets);
  } catch (err) {
    next(err);
  }
});

// GET /api/support/tickets/:id - View single ticket with conversation messages
app.get('/api/support/tickets/:id', async (req, res, next) => {
  try {
    const storage = SupportStore.getScopedStorage(req);
    const ticket = await storage.getTicket(req.params.id, req.user.id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

// POST /api/support/tickets/:id/messages - Add customer message to own ticket
app.post('/api/support/tickets/:id/messages', async (req, res, next) => {
  try {
    const { body } = req.body || {};
    const idempotencyKey = (
      req.headers['idempotency-key'] ||
      (req.body && (req.body.idempotency_key || req.body.idempotencyKey)) ||
      null
    );

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'Message body is required and must not be empty' });
    }
    const trimmedBody = body.trim();
    if (trimmedBody.length > 10000) {
      return res.status(400).json({ error: 'Message body must not exceed 10000 characters' });
    }

    let cleanIdempotencyKey = null;
    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.trim().length > 255) {
        return res.status(400).json({ error: 'Idempotency key must be a non-empty string up to 255 characters' });
      }
      cleanIdempotencyKey = idempotencyKey.trim();
    }

    const storage = SupportStore.getScopedStorage(req);
    const message = await storage.addMessage({
      ticketId: req.params.id,
      userId: req.user.id,
      userEmail: req.user.email || 'customer@taskly.app',
      body: trimmedBody,
      idempotencyKey: cleanIdempotencyKey
    });

    if (!message) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (message.is_replay) {
      return res.status(200).json(message);
    }
    return res.status(201).json(message);
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 409) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/support/tickets/:id/messages - List messages for a ticket
app.get('/api/support/tickets/:id/messages', async (req, res, next) => {
  try {
    const storage = SupportStore.getScopedStorage(req);
    const messages = await storage.getMessages(req.params.id, req.user.id);

    if (!messages) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
// Developer Support Operations & Dashboard Endpoints (Stage 4)
// ==========================================================================
function requireDeveloperAuth(req, res, next) {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ error: 'Unauthorized: login required' });
  }

  const authorizedDevEmail = (process.env.SUPPORT_DEVELOPER_EMAIL || 'tasklypets@gmail.com').toLowerCase().trim();
  const userEmail = (req.user.email || '').toLowerCase().trim();
  const userRole = (req.user.role || '').toLowerCase().trim();

  // Allow if email matches developer email OR user has role 'developer' or 'service_role'
  if (userEmail === authorizedDevEmail || userRole === 'developer' || userRole === 'service_role') {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden: developer access required' });
}

app.use('/api/support/developer', authenticateUser, requireDeveloperAuth);

// GET /api/support/developer/tickets - List all customer tickets across system
app.get('/api/support/developer/tickets', async (req, res, next) => {
  try {
    const { status, search, limit, offset } = req.query;
    const storage = SupportStore.getServiceStorage();
    const result = await storage.developerListTickets({ status, search, limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/support/developer/stats - High-level metrics for dashboard
app.get('/api/support/developer/stats', async (req, res, next) => {
  try {
    const storage = SupportStore.getServiceStorage();
    const stats = await storage.developerGetStats();
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
});

// GET /api/support/developer/tickets/:id - View any ticket with full conversation history
app.get('/api/support/developer/tickets/:id', async (req, res, next) => {
  try {
    const storage = SupportStore.getServiceStorage();
    const ticket = await storage.developerGetTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

// POST /api/support/developer/tickets/:id/messages - Post developer response
app.post('/api/support/developer/tickets/:id/messages', async (req, res, next) => {
  try {
    const { body, status } = req.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'Message body is required and must not be empty' });
    }
    const cleanBody = body.trim();
    if (cleanBody.length > 10000) {
      return res.status(400).json({ error: 'Message body must not exceed 10000 characters' });
    }

    const storage = SupportStore.getServiceStorage();
    const message = await storage.developerAddMessage({
      ticketId: req.params.id,
      developerId: req.user.id,
      developerEmail: req.user.email,
      body: cleanBody,
      status: status || null
    });

    if (!message) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/support/developer/tickets/:id/status - Update ticket status
app.patch('/api/support/developer/tickets/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'Status is required' });
    }

    const cleanStatus = SupportStore.normalizeStatus(status);
    if (!cleanStatus || !SupportStore.VALID_STATUSES.includes(cleanStatus)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${SupportStore.VALID_STATUSES.join(', ')}`
      });
    }

    const storage = SupportStore.getServiceStorage();
    const updated = await storage.developerUpdateStatus(req.params.id, cleanStatus, req.user.id);

    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
// Internal Outbox Operations & Health Monitoring Endpoints
// ==========================================================================
function requireInternalCronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const providedAuth = req.headers['authorization'] || req.headers['x-cron-secret'];
  
  if (!cronSecret && process.env.NODE_ENV !== 'production') {
    return next(); // Allow in non-production local development
  }

  if (!providedAuth) {
    return res.status(401).json({ error: 'Unauthorized: missing cron secret header' });
  }

  const expectedBearer = cronSecret ? `Bearer ${cronSecret}` : null;
  if (providedAuth === expectedBearer || providedAuth === cronSecret) {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden: invalid cron secret' });
}

// ==========================================================================
// Inbound Webhook Operations (Stage 3 Resend Managed Inbound)
// ==========================================================================
const { handleInboundWebhook } = require('./services/inboundWebhookService');
app.post('/api/support/resend-inbound', handleInboundWebhook);

// POST /api/internal/support/outbox/process - Process batch of pending outbox emails
app.post('/api/internal/support/outbox/process', requireInternalCronAuth, async (req, res, next) => {
  try {
    const { OutboxWorker } = require('./services/outboxWorker');
    const worker = new OutboxWorker();
    const result = await worker.processBatch();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/internal/support/outbox/sweep - Sweep expired ambiguous delivery timeouts
app.post('/api/internal/support/outbox/sweep', requireInternalCronAuth, async (req, res, next) => {
  try {
    const { OutboxWorker } = require('./services/outboxWorker');
    const worker = new OutboxWorker();
    const swept = await worker.sweepTimeouts();
    res.json({ success: true, sweptTimeouts: swept });
  } catch (err) {
    next(err);
  }
});

// GET /api/internal/support/outbox/metrics - Operational queue health & metrics
app.get('/api/internal/support/outbox/metrics', requireInternalCronAuth, async (req, res, next) => {
  try {
    const { getOutboxStore } = require('./services/outboxStore');
    const store = getOutboxStore();
    const metrics = await store.getMetrics();
    res.json({ success: true, queue: metrics });
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
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: (process.env.NODE_ENV === 'production' && status === 500) ? 'Internal server error' : err.message
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
