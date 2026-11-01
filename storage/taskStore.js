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
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(defaultTodos, null, 2), 'utf8');
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
// 2. Production Google Cloud Firestore Adapter
// ==============================================================================
class FirestoreStorageAdapter {
  constructor(firestoreInstance, collectionName = 'todos') {
    this.firestore = firestoreInstance;
    this.collectionName = collectionName;
    this.collection = this.firestore.collection(collectionName);
  }

  async getAllTasks() {
    try {
      // Order by creation time descending (newest tasks first)
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
// 3. Storage Factory: Fail-Safe Resolver
// ==============================================================================
let activeAdapter = null;
let activeStoreType = 'file';

async function initializeStorage() {
  const isProduction = process.env.NODE_ENV === 'production';
  const forceFirestore = process.env.DATA_STORE === 'firestore';

  if (isProduction || forceFirestore) {
    console.log('[Storage] Initializing production Google Cloud Firestore adapter...');
    try {
      const { Firestore } = require('@google-cloud/firestore');
      const firestore = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID,
        databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
      });

      // Verify Firestore connectivity on boot
      await firestore.collection('todos').limit(1).get();
      console.log('[Storage] Google Cloud Firestore connected successfully.');

      activeAdapter = new FirestoreStorageAdapter(firestore);
      activeStoreType = 'firestore';
      return activeAdapter;
    } catch (err) {
      console.error('[Storage FATAL] Could not connect to Google Cloud Firestore in production:', err);
      // Strict rule: In production, NEVER silently fall back to ephemeral file storage
      throw new Error(`Production Firestore initialization failed: ${err.message}. Halting to prevent data loss.`);
    }
  }

  // Local development default: file storage
  console.log('[Storage] Using local JSON file storage for development.');
  activeAdapter = new FileStorageAdapter(getDataFile());
  activeStoreType = 'file';
  return activeAdapter;
}

function getStorage() {
  if (!activeAdapter) {
    // Synchronous default initialization for development / testing imports
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

module.exports = {
  initializeStorage,
  getStorage,
  setStorage,
  getStorageType,
  FileStorageAdapter,
  FirestoreStorageAdapter
};

