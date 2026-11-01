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

  async getAllTasks() {
    try {
      const raw = await fsPromises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        return defaultTodos;
      }
      console.error('Error reading local todos file:', err);
      return [];
    }
  }

  async createTask(todo) {
    const todos = await this.getAllTasks();
    todos.unshift(todo);
    await this._writeTodos(todos);
    return todo;
  }

  async updateTask(id, fields) {
    const todos = await this.getAllTasks();
    const index = todos.findIndex(t => t.id === id);
    if (index === -1) return null;

    todos[index] = Object.assign({}, todos[index], fields);
    await this._writeTodos(todos);
    return todos[index];
  }

  async deleteTask(id) {
    const todos = await this.getAllTasks();
    const exists = todos.some(t => t.id === id);
    if (!exists) return false;

    const remaining = todos.filter(t => t.id !== id);
    await this._writeTodos(remaining);
    return true;
  }

  async clearCompleted() {
    const todos = await this.getAllTasks();
    const remaining = todos.filter(t => !t.completed);
    const deletedCount = todos.length - remaining.length;
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
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
      updatedAt: row.updated_at || row.updatedAt || null
    };
  }

  async getAllTasks() {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
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

  async createTask(todo) {
    try {
      const payload = {
        id: todo.id,
        title: todo.title,
        completed: Boolean(todo.completed),
        due_date: todo.dueDate || null,
        created_at: todo.createdAt || new Date().toISOString()
      };

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
      console.error(`[SupabaseStorageAdapter] Error creating task ${todo.id}:`, err.message || err);
      throw new Error(`Supabase insert failed: ${err.message || err}`);
    }
  }

  async updateTask(id, fields) {
    try {
      const payload = {};
      if (fields.title !== undefined) payload.title = fields.title;
      if (fields.completed !== undefined) payload.completed = fields.completed;
      if (fields.dueDate !== undefined) payload.due_date = fields.dueDate;
      payload.updated_at = fields.updatedAt || new Date().toISOString();

      const { data, error } = await this.client
        .from(this.tableName)
        .update(payload)
        .eq('id', id)
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

  async deleteTask(id) {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('id', id)
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

  async clearCompleted() {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('completed', true)
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

async function initializeStorage() {
  if (activeAdapter) {
    return activeAdapter;
  }

  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const forceSupabase = process.env.DATA_STORE === 'supabase';
  const forceFirestore = process.env.DATA_STORE === 'firestore';

  // 1. Supabase PostgreSQL Configuration (Primary Production Store for Vercel)
  if (forceSupabase || (isProduction && !forceFirestore) || (supabaseUrl && supabaseKey)) {
    console.log('[Storage] Initializing production Supabase PostgreSQL adapter...');

    if (!supabaseUrl || !supabaseKey) {
      if (isProduction || isVercel) {
        console.error('[Storage FATAL] Missing Supabase configuration in production/Vercel.');
        throw new Error(
          'Missing SUPABASE_URL and SUPABASE_ANON_KEY in environment variables. ' +
          'In Vercel serverless production, ephemeral file storage is disabled. ' +
          'Please configure Supabase credentials in your Vercel Project Settings.'
        );
      }
    } else {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false }
        });

        // Test connectivity
        const { error } = await supabase.from('todos').select('id').limit(1);
        if (error) {
          throw error;
        }

        console.log('[Storage] Supabase PostgreSQL connected successfully.');
        activeAdapter = new SupabaseStorageAdapter(supabase);
        activeStoreType = 'supabase';
        return activeAdapter;
      } catch (err) {
        console.error('[Storage FATAL] Could not connect to Supabase PostgreSQL:', err.message || err);
        throw new Error(`Supabase initialization failed: ${err.message || err}. Halting to prevent data loss.`);
      }
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false }
        });
        activeAdapter = new SupabaseStorageAdapter(supabase);
        activeStoreType = 'supabase';
        return activeAdapter;
      } catch (err) {
        console.error('[Storage] Error initializing Supabase client in getStorage():', err.message);
      }
    }

    if (isVercel || process.env.NODE_ENV === 'production') {
      throw new Error(
        'Storage adapter not initialized. Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY) are required in production.'
      );
    }

    activeAdapter = new FileStorageAdapter(getDataFile());
    activeStoreType = 'file';
  }
  return activeAdapter;
}

function setStorage(adapter, type = 'file') {
  activeAdapter = adapter;
  activeStoreType = type;
}

function getStorageType() {
  return activeStoreType;
}

function resetStorage() {
  activeAdapter = null;
  activeStoreType = 'file';
}

module.exports = {
  initializeStorage,
  getStorage,
  setStorage,
  resetStorage,
  getStorageType,
  FileStorageAdapter,
  SupabaseStorageAdapter,
  FirestoreStorageAdapter
};
