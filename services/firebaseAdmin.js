/**
 * Taskly Firebase Admin SDK Initialization Module
 * File: services/firebaseAdmin.js
 * 
 * Safely initializes Firebase Admin SDK for Firebase Cloud Messaging (FCM).
 * Resolves credentials from Vercel / production environment variables:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY
 * Or local fallback:
 * - FIREBASE_SERVICE_ACCOUNT_PATH
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let getMessaging = null;
try {
  ({ getMessaging } = require('firebase-admin/messaging'));
} catch (_) {}

// Ensure local .env is loaded if running independently
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath) && !process.env.FIREBASE_PROJECT_ID && !process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
    } else {
      require('dotenv').config({ path: envPath });
    }
  } catch (_) {}
}

let initializedApp = null;
let initializedMessaging = null;

function resolveCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    return {
      projectId,
      clientEmail,
      privateKey
    };
  }

  // Local fallback via file path (keeps secrets out of git repo)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key
        };
      }
    } catch (err) {
      console.warn('[FirebaseAdmin] Failed to parse service account file:', err.message);
    }
  }

  return null;
}

function getFirebaseAdmin() {
  if (initializedApp) {
    return initializedApp;
  }

  const apps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.apps || []);
  if (apps.length > 0) {
    initializedApp = apps[0];
    return initializedApp;
  }

  const credentials = resolveCredentials();
  if (!credentials) {
    return null;
  }

  try {
    const certFn = admin.cert || (admin.credential && admin.credential.cert);
    if (!certFn) {
      throw new Error('Firebase cert credential factory not found on admin module');
    }

    initializedApp = admin.initializeApp({
      credential: certFn({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey
      })
    });
    return initializedApp;
  } catch (err) {
    console.error('[FirebaseAdmin] Failed to initialize Firebase Admin SDK:', err.message);
    return null;
  }
}

function getFirebaseMessaging() {
  if (initializedMessaging) {
    return initializedMessaging;
  }

  const app = getFirebaseAdmin();
  if (!app) {
    return null;
  }

  try {
    if (typeof getMessaging === 'function') {
      initializedMessaging = getMessaging(app);
    } else if (typeof app.messaging === 'function') {
      initializedMessaging = app.messaging();
    } else if (typeof admin.messaging === 'function') {
      initializedMessaging = admin.messaging();
    }
    return initializedMessaging;
  } catch (err) {
    console.error('[FirebaseAdmin] Failed to obtain Firebase Messaging instance:', err.message);
    return null;
  }
}

function isFirebaseConfigured() {
  return resolveCredentials() !== null;
}

module.exports = {
  getFirebaseAdmin,
  getFirebaseMessaging,
  isFirebaseConfigured,
  resolveCredentials
};
