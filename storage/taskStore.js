const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
function getDataFile() {
  return process.env.TODO_DATA_FILE || path.join(DATA_DIR, 'todos.json');
}

const defaultTodos = [
  {
    id: 'sample-1',
    title: 'Finish AIML assignment',
    description: 'Complete gradient descent exercises and model evaluation',
    dueDate: new Date().toISOString().split('T')[0],
    time: '2:00 PM',
    priority: 'High',
    category: 'Study',
    reminder: true,
    completed: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'sample-2',
    title: 'Update project report',
    description: 'Review Q4 deliverables and push presentation slides',
    dueDate: new Date().toISOString().split('T')[0],
    time: '4:00 PM',
    priority: 'Medium',
    category: 'Project',
    reminder: false,
    completed: true,
    createdAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'sample-3',
    title: 'Team meeting',
    description: 'Weekly sprint planning and backlog grooming with engineers',
    dueDate: new Date().toISOString().split('T')[0],
    time: '5:30 PM',
    priority: 'Medium',
    category: 'Work',
    reminder: true,
    completed: false,
    createdAt: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: 'sample-4',
    title: 'Build ColdGuard UI',
    description: 'Complete dashboard and connect with FastAPI backend',
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    time: '6:00 PM',
    priority: 'High',
    category: 'Project',
    reminder: true,
    completed: false,
    createdAt: new Date(Date.now() - 10800000).toISOString()
  }
];

// ==============================================================================
// 1. Local File-Based Storage Adapter (Local Development & Fallback)
// ==============================================================================
class FileStorageAdapter {
  constructor(filePath) {
    this.filePath = filePath || getDataFile();
    this.dataDir = path.dirname(this.filePath);
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify(defaultTodos, null, 2), 'utf8');
      }
    } catch (err) {
      // In read-only serverless filesystems (e.g. Vercel / AWS Lambda), gracefully log warning
      console.warn(`[FileStorageAdapter] Warning: Could not initialize local data directory (${err.message}). Expected in serverless production environments.`);
    }
  }

  async getAllTasks(userId = null) {
    try {
      const raw = await fsPromises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const all = Array.isArray(parsed) ? parsed : [];
      if (!userId) return all;
      return all.filter(t => t.user_id === userId || t.userId === userId);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return defaultTodos;
      }
      console.error('Error reading local todos file:', err);
      return [];
    }
  }

  async createTask(todo, userId = null) {
    const todos = await this.getAllTasks();
    if (userId) {
      todo.user_id = userId;
      todo.userId = userId;
    }
    todos.unshift(todo);
    await this._writeTodos(todos);
    return todo;
  }

  async updateTask(id, fields, userId = null) {
    const todos = await this.getAllTasks();
    const index = todos.findIndex(t => {
      if (t.id !== id) return false;
      if (!userId) return true;
      return t.user_id === userId || t.userId === userId;
    });
    if (index === -1) return null;

    todos[index] = Object.assign({}, todos[index], fields);
    await this._writeTodos(todos);
    return todos[index];
  }

  async deleteTask(id, userId = null) {
    const todos = await this.getAllTasks();
    const index = todos.findIndex(t => {
      if (t.id !== id) return false;
      if (!userId) return true;
      return t.user_id === userId || t.userId === userId;
    });
    if (index === -1) return false;

    todos.splice(index, 1);
    await this._writeTodos(todos);
    return true;
  }

  async clearCompleted(userId = null) {
    const todos = await this.getAllTasks();
    const initialCount = todos.length;
    const remaining = todos.filter(t => {
      if (!t.completed) return true;
      if (!userId) return false;
      // If user specified, only delete matching user completed
      return !(t.user_id === userId || t.userId === userId);
    });
    const deletedCount = initialCount - remaining.length;
    await this._writeTodos(remaining);
    return deletedCount;
  }

  async _writeTodos(todos) {
    const tempFile = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fsPromises.writeFile(tempFile, JSON.stringify(todos, null, 2), 'utf8');
      await fsPromises.rename(tempFile, this.filePath);
    } catch (err) {
      console.error('Error atomically writing local todos file:', err);
      try {
        if (fs.existsSync(tempFile)) await fsPromises.unlink(tempFile);
      } catch (_) {}
      throw err;
    }
  }
}

// ==============================================================================
// 2. Production Supabase PostgreSQL Adapter (Vercel Serverless Ready)
// ==============================================================================
class SupabaseStorageAdapter {
  constructor(supabaseClient, tableName = 'todos') {
    if (!supabaseClient) {
      throw new Error('Supabase client instance is required');
    }
    this.client = supabaseClient;
    this.tableName = tableName;
  }

  _mapFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      completed: Boolean(row.completed),
      dueDate: row.due_date || row.dueDate || null,
      time: row.time || null,
      description: row.description || '',
      priority: row.priority || 'Medium',
      category: row.category || 'Personal',
      reminder: Boolean(row.reminder),
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
      updatedAt: row.updated_at || row.updatedAt || null
    };
  }

  _validateUserId(userId, operationName) {
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new Error(`[SupabaseStorageAdapter] Mandatory userId is missing, empty, or invalid for ${operationName}`);
    }
    return userId.trim();
  }

  async getAllTasks(userId) {
    const validUserId = this._validateUserId(userId, 'getAllTasks');
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('user_id', validUserId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      return (data || []).map(row => this._mapFromDb(row));
    } catch (err) {
      console.error('[SupabaseStorageAdapter] Error fetching tasks:', err.message || err);
      throw new Error(`Supabase query failed: ${err.message || err}`);
    }
  }

  async createTask(todo, userId) {
    const validUserId = this._validateUserId(userId, 'createTask');
    if (!todo || typeof todo !== 'object') {
      throw new Error('[SupabaseStorageAdapter] Invalid todo object for createTask');
    }
    try {
      // Always assign user_id from the authenticated userId argument.
      // Never trust todo.user_id or todo.userId supplied by the request body.
      const payload = {
        id: todo.id,
        user_id: validUserId,
        title: todo.title,
        completed: Boolean(todo.completed),
        due_date: todo.dueDate !== undefined ? todo.dueDate : (todo.due_date || null),
        created_at: todo.createdAt || todo.created_at || new Date().toISOString()
      };
      if (todo.time !== undefined) payload.time = todo.time;
      if (todo.description !== undefined) payload.description = todo.description;
      if (todo.priority !== undefined) payload.priority = todo.priority;
      if (todo.category !== undefined) payload.category = todo.category;
      if (todo.reminder !== undefined) payload.reminder = Boolean(todo.reminder);
      if (todo.updatedAt || todo.updated_at) payload.updated_at = todo.updatedAt || todo.updated_at;

      const { data, error } = await this.client
        .from(this.tableName)
        .insert(payload)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return this._mapFromDb(data || payload);
    } catch (err) {
      console.error(`[SupabaseStorageAdapter] Error creating task ${todo?.id}:`, err.message || err);
      throw new Error(`Supabase insert failed: ${err.message || err}`);
    }
  }

  async updateTask(id, fields, userId) {
    const validUserId = this._validateUserId(userId, 'updateTask');
    if (!id || typeof id !== 'string') {
      throw new Error('[SupabaseStorageAdapter] Task ID is required for updateTask');
    }
    try {
      const payload = {};
      if (fields.title !== undefined) payload.title = fields.title;
      if (fields.completed !== undefined) payload.completed = Boolean(fields.completed);
      if (fields.dueDate !== undefined || fields.due_date !== undefined) {
        payload.due_date = fields.dueDate !== undefined ? fields.dueDate : fields.due_date;
      }
      if (fields.time !== undefined) payload.time = fields.time;
      if (fields.description !== undefined) payload.description = fields.description;
      if (fields.priority !== undefined) payload.priority = fields.priority;
      if (fields.category !== undefined) payload.category = fields.category;
      if (fields.reminder !== undefined) payload.reminder = Boolean(fields.reminder);
      payload.updated_at = fields.updatedAt || fields.updated_at || new Date().toISOString();

      const { data, error } = await this.client
        .from(this.tableName)
        .update(payload)
        .eq('id', id)
        .eq('user_id', validUserId)
        .select();

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return null;
      }

      return this._mapFromDb(data[0]);
    } catch (err) {
      console.error(`[SupabaseStorageAdapter] Error updating task ${id}:`, err.message || err);
      throw new Error(`Supabase update failed: ${err.message || err}`);
    }
  }

  async deleteTask(id, userId) {
    const validUserId = this._validateUserId(userId, 'deleteTask');
    if (!id || typeof id !== 'string') {
      throw new Error('[SupabaseStorageAdapter] Task ID is required for deleteTask');
    }
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('id', id)
        .eq('user_id', validUserId)
        .select();

      if (error) {
        throw error;
      }

      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      console.error(`[SupabaseStorageAdapter] Error deleting task ${id}:`, err.message || err);
      throw new Error(`Supabase delete failed: ${err.message || err}`);
    }
  }

  async clearCompleted(userId) {
    const validUserId = this._validateUserId(userId, 'clearCompleted');
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('completed', true)
        .eq('user_id', validUserId)
        .select();

      if (error) {
        throw error;
      }

      return Array.isArray(data) ? data.length : 0;
    } catch (err) {
      console.error('[SupabaseStorageAdapter] Error clearing completed tasks:', err.message || err);
      throw new Error(`Supabase bulk delete failed: ${err.message || err}`);
    }
  }
}

// ==============================================================================
// 3. Google Cloud Firestore Adapter (Cloud Run Architecture)
// ==============================================================================
class FirestoreStorageAdapter {
  constructor(firestoreInstance, collectionName = 'todos') {
    this.firestore = firestoreInstance;
    this.collectionName = collectionName;
    this.collection = this.firestore.collection(collectionName);
  }

  async getAllTasks() {
    try {
      const snapshot = await this.collection.orderBy('createdAt', 'desc').get();
      return snapshot.docs.map(doc => doc.data());
    } catch (err) {
      console.error('Firestore error fetching tasks:', err);
      throw err;
    }
  }

  async createTask(todo) {
    try {
      const docRef = this.collection.doc(todo.id);
      await docRef.set(todo);
      return todo;
    } catch (err) {
      console.error(`Firestore error creating task ${todo.id}:`, err);
      throw err;
    }
  }

  async updateTask(id, fields) {
    try {
      const docRef = this.collection.doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return null;
      }
      await docRef.update(fields);
      const updatedDoc = await docRef.get();
      return updatedDoc.data();
    } catch (err) {
      console.error(`Firestore error updating task ${id}:`, err);
      throw err;
    }
  }

  async deleteTask(id) {
    try {
      const docRef = this.collection.doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return false;
      }
      await docRef.delete();
      return true;
    } catch (err) {
      console.error(`Firestore error deleting task ${id}:`, err);
      throw err;
    }
  }

  async clearCompleted() {
    try {
      const snapshot = await this.collection.where('completed', '==', true).get();
      if (snapshot.empty) {
        return 0;
      }
      const batch = this.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      return snapshot.size;
    } catch (err) {
      console.error('Firestore error clearing completed tasks:', err);
      throw err;
    }
  }
}

// ==============================================================================
// 4. Storage Factory: Fail-Safe Resolver
// ==============================================================================
let activeAdapter = null;
let activeStoreType = 'file';
let isExplicitlySet = false;

function getSupabaseAnonKey() {
  // Normal application storage must never use SUPABASE_SERVICE_ROLE_KEY
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || null;
}

async function initializeStorage() {
  if (activeAdapter) {
    return activeAdapter;
  }

  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = getSupabaseAnonKey();
  const forceSupabase = process.env.DATA_STORE === 'supabase';
  const forceFirestore = process.env.DATA_STORE === 'firestore';

  // 1. Supabase PostgreSQL Configuration (Primary Production Store for Vercel)
  if (forceSupabase || (isProduction && !forceFirestore) || (supabaseUrl && supabaseAnonKey)) {
    console.log('[Storage] Validating Supabase PostgreSQL configuration...');

    if (!supabaseUrl || !supabaseAnonKey) {
      if (forceSupabase || isProduction || isVercel) {
        console.error('[Storage FATAL] Missing Supabase configuration when Supabase storage is requested.');
        throw new Error(
          'Missing SUPABASE_URL and SUPABASE_ANON_KEY in environment variables. ' +
          (forceSupabase ? 'DATA_STORE is explicitly set to "supabase" but credentials are missing.' : 'In Vercel serverless production, ephemeral file storage is disabled.') +
          ' Please configure Supabase credentials.'
        );
      }
    } else {
      // Validate SUPABASE_URL format
      try {
        new URL(supabaseUrl);
      } catch (urlErr) {
        throw new Error(`Invalid SUPABASE_URL configured: ${supabaseUrl}`);
      }

      // Check startup connectivity without requiring unauthenticated queries that conflict with RLS
      try {
        const { createClient } = require('@supabase/supabase-js');
        const probeClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        });

        const { error } = await probeClient.from('todos').select('id').limit(0);
        if (error) {
          const isRlsRestriction = error.code === '42501' ||
            (error.message && (error.message.includes('permission denied') || error.message.includes('policy') || error.message.includes('row-level security')));
          if (!isRlsRestriction) {
            console.warn('[Storage] Supabase probe warning:', error.message || error);
          }
        }
      } catch (probeErr) {
        if (probeErr.code === 'ENOTFOUND' || (probeErr.message && probeErr.message.includes('fetch failed'))) {
          throw new Error(`Supabase connection probe failed: ${probeErr.message}`);
        }
      }

      console.log('[Storage] Supabase PostgreSQL configuration verified.');
      activeStoreType = 'supabase';

      // In production, NEVER create a shared activeAdapter.
      // Every authenticated production request must use a request-scoped client created by getScopedStorage(req).
      if (!isProduction) {
        const { createClient } = require('@supabase/supabase-js');
        const devClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        });
        activeAdapter = new SupabaseStorageAdapter(devClient);
        return activeAdapter;
      }

      return null;
    }
  }

  // 2. Google Cloud Firestore Configuration (Cloud Run / GCP mode)
  if (forceFirestore || (isProduction && process.env.GOOGLE_CLOUD_PROJECT && !isVercel)) {
    console.log('[Storage] Initializing production Google Cloud Firestore adapter...');
    try {
      const { Firestore } = require('@google-cloud/firestore');
      const firestore = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID,
        databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
      });

      await firestore.collection('todos').limit(1).get();
      console.log('[Storage] Google Cloud Firestore connected successfully.');

      activeAdapter = new FirestoreStorageAdapter(firestore);
      activeStoreType = 'firestore';
      return activeAdapter;
    } catch (err) {
      console.error('[Storage FATAL] Could not connect to Google Cloud Firestore in production:', err);
      throw new Error(`Production Firestore initialization failed: ${err.message}. Halting to prevent data loss.`);
    }
  }

  // 3. Local development default: file storage
  console.log('[Storage] Using local JSON file storage for development.');
  activeAdapter = new FileStorageAdapter(getDataFile());
  activeStoreType = 'file';
  return activeAdapter;
}

function getStorage() {
  if (!activeAdapter) {
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;

    if (isProduction) {
      throw new Error(
        'Direct un-scoped getStorage() is forbidden in production. ' +
        'Use getScopedStorage(req) with an authenticated request token to ensure RLS isolation.'
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = getSupabaseAnonKey();

    if (supabaseUrl && supabaseAnonKey) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        });
        activeAdapter = new SupabaseStorageAdapter(supabase);
        activeStoreType = 'supabase';
        return activeAdapter;
      } catch (err) {
        console.error('[Storage] Error initializing Supabase client in getStorage():', err.message);
      }
    }

    if (process.env.DATA_STORE === 'supabase') {
      throw new Error('DATA_STORE is set to "supabase" but SUPABASE_URL or SUPABASE_ANON_KEY is missing or invalid.');
    }

    activeAdapter = new FileStorageAdapter(getDataFile());
    activeStoreType = 'file';
  }
  return activeAdapter;
}

function setStorage(adapter, type = 'file') {
  activeAdapter = adapter;
  activeStoreType = type;
  isExplicitlySet = true;
}

function getStorageType() {
  return activeStoreType;
}

function resetStorage() {
  activeAdapter = null;
  activeStoreType = 'file';
  isExplicitlySet = false;
}

/**
 * Creates a tenant-isolated Supabase client for a specific request.
 * Uses public SUPABASE_ANON_KEY and forwards the user's verified JWT.
 * Normal application storage must never use SUPABASE_SERVICE_ROLE_KEY.
 */
function createScopedSupabaseClient(userJwt) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in server environment.');
  }

  const { createClient } = require('@supabase/supabase-js');
  const headers = {};
  if (userJwt) {
    headers.Authorization = `Bearer ${userJwt}`;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers }
  });
}

/**
 * Resolves a request-scoped storage adapter for the given HTTP request.
 * In production:
 *   - NEVER returns activeAdapter to prevent bypassing per-user RLS boundaries.
 *   - Creates a new request-scoped Supabase client using SUPABASE_ANON_KEY + req.userToken.
 *   - Fails closed if Supabase configuration is missing or request is unauthenticated.
 * In non-production:
 *   - Honors activeAdapter if injected by test harness (e.g. setStorage).
 *   - Falls back to local file storage if no userToken or activeAdapter.
 */
function getScopedStorage(req = null) {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;

  // 1. Production Mode: Strict request-scoped client isolation
  if (isProduction) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = getSupabaseAnonKey();

    // Missing public Supabase configuration fails closed
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing public Supabase configuration (SUPABASE_URL and SUPABASE_ANON_KEY) in production. ' +
        'Normal task operations fail closed to protect data isolation.'
      );
    }

    // Authenticated production request: create dedicated per-request scoped client
    if (req && req.userToken) {
      const scopedClient = createScopedSupabaseClient(req.userToken);
      return new SupabaseStorageAdapter(scopedClient);
    }

    // In production, unauthenticated storage access is strictly prohibited
    throw new Error('Unauthenticated storage access is prohibited in production.');
  }

  // 2. Non-production environments (test & development):
  // Test injection: honor activeAdapter if explicitly set by test runner (e.g. mock adapters in unit tests)
  if (isExplicitlySet && activeAdapter) {
    return activeAdapter;
  }

  // If userToken is present and Supabase is configured in dev, create scoped client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = getSupabaseAnonKey();
  if (supabaseUrl && supabaseAnonKey && req && req.userToken && !req.userToken.startsWith('mock-user:')) {
    const scopedClient = createScopedSupabaseClient(req.userToken);
    return new SupabaseStorageAdapter(scopedClient);
  }

  if (activeAdapter) {
    return activeAdapter;
  }

  // Default to development storage
  return getStorage();
}

module.exports = {
  initializeStorage,
  getStorage,
  getScopedStorage,
  createScopedSupabaseClient,
  setStorage,
  resetStorage,
  getStorageType,
  FileStorageAdapter,
  SupabaseStorageAdapter,
  FirestoreStorageAdapter
};
