// ==========================================================================
// Taskly Engine
// Multi-screen routing, interactive onboarding, calendar, analytics, and CRUD
// ==========================================================================

// API Base URL Configuration (Automatic Hybrid Web & Native Mobile Routing)
function getApiBaseUrl() {
  if (typeof window !== 'undefined' && window.TASKLY_API_URL) {
    return window.TASKLY_API_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const isCapacitor = Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      window.Capacitor?.getPlatform?.() === 'android' ||
      window.Capacitor?.getPlatform?.() === 'ios' ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:' ||
      (window.location.hostname === 'localhost' && window.location.port === '' && !window.location.origin.includes(':3000'))
    );
    if (isCapacitor) {
      return 'https://taskly-todo-app-git-feature-mu-aaec2c-vimaljayganthans-projects.vercel.app';
    }
  }
  return '';
}

const API_BASE_URL = getApiBaseUrl();

function getAuthHeaders() {
  const headers = {};
  if (typeof state !== 'undefined' && state.userToken) {
    headers['Authorization'] = `Bearer ${state.userToken}`;
  }
  return headers;
}

// Application State
const state = {
  // User Profile
  user: {
    id: null,
    email: '',
    name: 'User',
    age: 18,
    onboarded: false
  },
  onboardingCompleted: false,
  userToken: null,
  authMode: 'login', // 'login' | 'signup'
  passwordVisibility: {
    login: false,
    signup: false
  },
  theme: 'light',
  quickNotes: [],

  // Active Flow & Navigation
  flow: 'onboarding', // 'main' | 'onboarding'
  currentOnboardingStep: 'carousel',
  carouselIndex: 0,
  activeTab: 'home', // 'home' | 'calendar' | 'add' | 'progress' | 'profile'

  // Calendar State
  calCurrentDate: new Date(),
  selectedDateStr: toYmdString(new Date()),
  calendarViewMode: 'month', // 'month' (default dynamic heatmap grid) | 'strip'
  previousTab: null,

  // Analytics State
  analyticsTimeframe: 'week', // 'week' | 'month' | 'all'

  // Task Store & Filters
  todos: [],
  todosLoaded: false,
  dashboardFilter: 'all', // 'all' | 'today' | 'pending' | 'completed'

  // Server Configuration Cache
  config: null
};

// Supabase Auth Integration
let supabaseClient = null;

function isAuthenticated() {
  if (!state.userToken || typeof state.userToken !== 'string') return false;
  if (state.userToken.startsWith('mock-user:')) return false;
  if (!state.user || !state.user.id) return false;
  if (state.user.isEmailVerified === false) return false;
  return true;
}

// Durable Onboarding Completion Helpers (Device & Account Multi-Layer Persistence)
function isOnboardingCompleted() {
  if (state.onboardingCompleted === true || state.user?.onboarded === true) {
    return true;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('taskly_onboarding_completed') === 'true') {
        return true;
      }
      if (state.user?.id && localStorage.getItem(`taskly_onboarding_${state.user.id}`) === 'true') {
        return true;
      }
      const rawUser = localStorage.getItem('taskly_user');
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        if (parsed && (parsed.onboarded === true || parsed.onboarding_completed === true)) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function setOnboardingCompleted(completed = true, syncToCloud = true) {
  state.onboardingCompleted = Boolean(completed);
  if (state.user) {
    state.user.onboarded = Boolean(completed);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (completed) {
        localStorage.setItem('taskly_onboarding_completed', 'true');
        localStorage.setItem('taskly_onboarding_completed_at', new Date().toISOString());
        if (state.user?.id) {
          localStorage.setItem(`taskly_onboarding_${state.user.id}`, 'true');
        }
      } else {
        localStorage.removeItem('taskly_onboarding_completed');
        localStorage.removeItem('taskly_onboarding_completed_at');
        if (state.user?.id) {
          localStorage.removeItem(`taskly_onboarding_${state.user.id}`);
        }
      }
    }
  } catch (_) {}

  saveUserPreferences();

  if (completed && syncToCloud && isAuthenticated()) {
    syncOnboardingToSupabase();
  }
}

function syncOnboardingToSupabase() {
  try {
    if (supabaseClient && typeof supabaseClient.auth?.updateUser === 'function' && state.userToken) {
      (async () => {
        try {
          await supabaseClient.auth.updateUser({
            data: { onboarding_completed: true, onboarded: true }
          });
        } catch (err) {
          console.warn('[Supabase Onboarding Sync Notice]:', err?.message);
        }
      })();
    }
  } catch (_) {}
}

function handleSkipOnboarding() {
  setOnboardingCompleted(true);
  if (isAuthenticated() || (isLocalPreview() && state.isPreviewSession)) {
    showMainFlow('home');
  } else {
    showOnboardingStep('profile-setup');
  }
}

function handleFinishOnboarding() {
  setOnboardingCompleted(true);
  if (isAuthenticated() || (isLocalPreview() && state.isPreviewSession)) {
    showMainFlow('home');
  } else {
    showOnboardingStep('profile-setup');
  }
}

function isLocalPreview() {
  if (typeof window === 'undefined') return false;
  // Node.js test environment runs with module.exports - fail closed unless explicitly forced in unit test
  if (typeof module !== 'undefined' && module.exports && !global.__FORCE_PREVIEW_TEST__) return false;

  // Never enable in native Capacitor/mobile environments
  const isNative = Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    window.Capacitor?.getPlatform?.() === 'android' ||
    window.Capacitor?.getPlatform?.() === 'ios' ||
    window.location?.protocol === 'capacitor:' ||
    window.location?.protocol === 'ionic:'
  );
  if (isNative) return false;

  const isLocalHost = Boolean(
    window.location &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]')
  );
  if (!isLocalHost) return false;

  // Fail closed: backend config must explicitly authorize preview mode under verified development conditions
  if (!state.config || state.config.previewModeAllowed !== true) {
    return false;
  }

  return true;
}

function updatePreviewUI() {
  if (typeof document === 'undefined') return;
  const previewWrap = document.getElementById('preview-helper-wrap');
  const previewBanner = document.getElementById('preview-mode-banner');

  if (isLocalPreview()) {
    if (previewWrap) previewWrap.style.display = 'block';
  } else {
    if (previewWrap) previewWrap.style.display = 'none';
  }

  if (isLocalPreview() && state.isPreviewSession) {
    if (previewBanner) previewBanner.style.display = 'flex';
  } else {
    if (previewBanner) previewBanner.style.display = 'none';
  }
}

function initPreviewData() {
  state.isPreviewSession = true;
  state.todosLoaded = true;
  state.userToken = null; // Strictly null - preview mode NEVER issues or holds an auth token
  state.user = {
    id: 'local-preview-user',
    name: 'Preview User',
    email: 'preview@local.test (LOCAL UI PREVIEW)',
    age: 21,
    onboarded: true,
    isPreview: true
  };
  updatePreviewUI();
  if (!state.todos || state.todos.length === 0) {
    const today = toYmdString(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = toYmdString(yesterdayDate);
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = toYmdString(tomorrowDate);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);
    const dayPast = toYmdString(pastDate);

    state.todos = [
      {
        id: 'preview-1',
        title: 'Complete pastel design system audit',
        description: 'Review cards, buttons, badges, and modals across desktop and mobile views.',
        dueDate: today,
        time: '10:00 AM',
        priority: 'High',
        category: 'Work',
        completed: false,
        reminder: true
      },
      {
        id: 'preview-2',
        title: 'Sync Capacitor Android release key',
        description: 'Verify keystore configuration and update gradle properties.',
        dueDate: yesterday,
        time: '02:00 PM',
        priority: 'High',
        category: 'Work',
        completed: false,
        reminder: false
      },
      {
        id: 'preview-3',
        title: 'Review productivity analytics & weekly progress',
        description: 'Inspect velocity bar chart and completion ring metrics.',
        dueDate: today,
        time: '04:30 PM',
        priority: 'Medium',
        category: 'Study',
        completed: false,
        reminder: true
      },
      {
        id: 'preview-4',
        title: 'Email confirmation URL redirect fix',
        description: 'Verify canonical URL resolution and environment-aware redirects.',
        dueDate: dayPast,
        time: '',
        priority: 'Low',
        category: 'Work',
        completed: true,
        reminder: false
      },
      {
        id: 'preview-5',
        title: 'Plan weekly grocery list and meal prep',
        description: 'Pick fresh fruits, pastel pastries, and matcha tea.',
        dueDate: tomorrow,
        time: '',
        priority: 'Medium',
        category: 'Personal',
        completed: false,
        reminder: false
      }
    ];
  }
}

function getAuthRedirectUrl() {
  // Detect if running inside Capacitor native mobile container
  const isCapacitor = Boolean(
    (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) ||
    (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android') ||
    (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'ios') ||
    (typeof window !== 'undefined' && window.location?.protocol === 'capacitor:') ||
    (typeof window !== 'undefined' && window.location?.protocol === 'ionic:') ||
    (typeof window !== 'undefined' && window.location?.hostname === 'localhost' && window.location?.port === '' && !window.location?.origin?.includes(':3000'))
  );

  // 1. In Capacitor native app: Use the dedicated HTTPS confirmation success route.
  // Directs Supabase email confirmation to open the HTTPS success page in the browser instead of app deep-link.
  if (isCapacitor) {
    const mobileBaseUrl = (state.config && typeof state.config.appUrl === 'string' && state.config.appUrl.trim())
      ? state.config.appUrl.trim().replace(/\/+$/, '')
      : getApiBaseUrl().replace(/\/+$/, '');
    return `${mobileBaseUrl}/auth/confirmed`;
  }

  // 2. Standard Web Browser Environment
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');

    // Local development web: use localhost /auth/confirmed route
    if (isLocal) {
      return `${origin.replace(/\/+$/, '')}/auth/confirmed`;
    }

    // Deployed web: prefer canonical appUrl from server config if present
    if (state.config) {
      if (typeof state.config.appUrl === 'string' && state.config.appUrl.trim()) {
        return `${state.config.appUrl.trim().replace(/\/+$/, '')}/auth/confirmed`;
      }
      // Missing production configuration on server: fail closed
      return null;
    }

    if (origin && !origin.startsWith('null') && !origin.startsWith('file:') && origin.startsWith('https://')) {
      return `${origin.replace(/\/+$/, '')}/auth/confirmed`;
    }
  }

  // 3. Fallback to state.config.appUrl if present
  if (state.config && typeof state.config.appUrl === 'string' && state.config.appUrl.trim()) {
    return `${state.config.appUrl.trim().replace(/\/+$/, '')}/auth/confirmed`;
  }

  return null;
}

function handleAuthExpiry() {
  console.warn('[Auth]: Session expired or unauthorized. Redirecting to sign in.');
  syncAuthSignOut();
  try {
    history.replaceState(null, '', '#profile-setup');
  } catch (_) {
    window.location.hash = 'profile-setup';
  }
  showOnboardingStep('profile-setup', false);
  const authErrorMsg = document.getElementById('auth-error-msg');
  if (authErrorMsg) {
    authErrorMsg.style.display = 'flex';
    authErrorMsg.style.borderColor = '#fecaca';
    authErrorMsg.style.background = '#fef2f2';
    authErrorMsg.style.color = '#dc2626';
    authErrorMsg.textContent = 'Your session has expired. Please sign in again.';
  }
}

function handleUnverifiedEmail(message) {
  console.warn('[Auth]: Email verification required:', message);
  syncAuthSignOut();
  try {
    history.replaceState(null, '', '#profile-setup');
  } catch (_) {
    window.location.hash = 'profile-setup';
  }
  showOnboardingStep('profile-setup', false);
  const authErrorMsg = document.getElementById('auth-error-msg');
  if (authErrorMsg) {
    authErrorMsg.style.display = 'flex';
    authErrorMsg.style.borderColor = '#fed7aa';
    authErrorMsg.style.background = '#fff7ed';
    authErrorMsg.style.color = '#c2410c';
    authErrorMsg.textContent = message || 'Please verify your email address to access tasks. Check your inbox.';
  }
}

// Set to prevent duplicate PKCE / deep link callback processing
const processedAuthCodes = new Set();

async function handleAuthDeepLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return;

  let code = null;
  let accessToken = null;
  let refreshToken = null;
  let errorMsg = null;
  let errorCode = null;

  try {
    const parsed = new URL(rawUrl);
    code = parsed.searchParams.get('code');
    errorCode = parsed.searchParams.get('error_code') || parsed.searchParams.get('error');
    errorMsg = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');

    if (parsed.hash && parsed.hash.length > 1) {
      const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
      if (!code) code = hashParams.get('code');
      if (!accessToken) accessToken = hashParams.get('access_token');
      if (!refreshToken) refreshToken = hashParams.get('refresh_token');
      if (!errorCode) errorCode = hashParams.get('error_code') || hashParams.get('error');
      if (!errorMsg) errorMsg = hashParams.get('error_description') || hashParams.get('error');
    }
  } catch (_) {
    // Fallback regex parsing for custom schemes
    const codeMatch = rawUrl.match(/[?&#]code=([^&#]+)/);
    if (codeMatch) code = decodeURIComponent(codeMatch[1]);
    const tokenMatch = rawUrl.match(/[?&#]access_token=([^&#]+)/);
    if (tokenMatch) accessToken = decodeURIComponent(tokenMatch[1]);
    const refreshMatch = rawUrl.match(/[?&#]refresh_token=([^&#]+)/);
    if (refreshMatch) refreshToken = decodeURIComponent(refreshMatch[1]);
    const errMatch = rawUrl.match(/[?&#](?:error_description|error)=([^&#]+)/);
    if (errMatch) errorMsg = decodeURIComponent(errMatch[1].replace(/\+/g, ' '));
  }

  // Handle expired and invalid confirmation links gracefully
  if (errorCode || errorMsg) {
    console.warn('[Auth Deep Link Error]:', errorCode, errorMsg);
    if (typeof document !== 'undefined') {
      const authErrorMsg = document.getElementById('auth-error-msg');
      if (authErrorMsg) {
        authErrorMsg.style.display = 'flex';
        authErrorMsg.style.borderColor = '#fecaca';
        authErrorMsg.style.background = '#fef2f2';
        authErrorMsg.style.color = '#dc2626';
        authErrorMsg.textContent = errorMsg || 'Confirmation link is invalid or has expired. Please sign in or request a new confirmation email.';
      }
      showOnboardingStep('profile-setup', false);
    }
    return;
  }

  // Avoid duplicate callback processing
  if (code && processedAuthCodes.has(code)) {
    console.log('[Auth Deep Link]: Skipping duplicate authorization code processing');
    return;
  }
  if (accessToken && processedAuthCodes.has(accessToken)) {
    console.log('[Auth Deep Link]: Skipping duplicate token processing');
    return;
  }

  // Ensure supabaseClient is ready
  if (!supabaseClient) {
    let attempts = 0;
    while (!supabaseClient && attempts < 10) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    if (!supabaseClient) {
      console.warn('[Auth Deep Link]: Supabase client unavailable for code exchange');
      return;
    }
  }

  // 1. PKCE Code Exchange
  if (code) {
    processedAuthCodes.add(code);
    try {
      if (typeof supabaseClient.auth?.exchangeCodeForSession === 'function') {
        const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);
        if (data && data.session && !error) {
          syncAuthSession(data.session);
          if (isOnboardingCompleted()) {
            showMainFlow('home');
          } else {
            showOnboardingStep('welcome');
          }
          return;
        } else if (error) {
          console.warn('[Supabase PKCE Auth Exchange Error]:', error.message);
          if (typeof document !== 'undefined') {
            const authErrorMsg = document.getElementById('auth-error-msg');
            if (authErrorMsg) {
              authErrorMsg.style.display = 'flex';
              authErrorMsg.style.borderColor = '#fecaca';
              authErrorMsg.style.background = '#fef2f2';
              authErrorMsg.style.color = '#dc2626';
              authErrorMsg.textContent = error.message || 'Confirmation link is invalid or expired. Please sign in.';
            }
            showOnboardingStep('profile-setup', false);
          }
        }
      }
    } catch (err) {
      console.warn('[Supabase PKCE Exchange Exception]:', err.message);
    }
  }

  // 2. Implicit Flow Token Pair
  if (accessToken) {
    processedAuthCodes.add(accessToken);
    try {
      if (typeof supabaseClient.auth?.setSession === 'function') {
        const { data, error } = await supabaseClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || ''
        });
        if (data && data.session && !error) {
          syncAuthSession(data.session);
          if (isOnboardingCompleted()) {
            showMainFlow('home');
          } else {
            showOnboardingStep('welcome');
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[Supabase SetSession Exception]:', err.message);
    }
  }
}

async function initSupabaseAuth() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/config`);
    if (!res.ok) throw new Error('Failed to load server config');
    const config = await res.json();
    state.config = config;
    updatePreviewUI();

    if (window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      // 1. Process query/hash for Web Browser environment
      if (typeof window !== 'undefined' && window.location) {
        if (window.location.search || window.location.hash) {
          const fullUrl = window.location.href || (
            (window.location.origin || 'http://localhost:3000') +
            (window.location.pathname || '/') +
            (window.location.search || '') +
            (window.location.hash || '')
          );
          await handleAuthDeepLink(fullUrl);
        }
      }

      // 2. Register native Capacitor App deep-link listeners (Android APK)
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App) {
        const CapApp = window.Capacitor.Plugins.App;

        // Warm resume: User clicked confirmation link while app was running in background
        CapApp.addListener('appUrlOpen', (event) => {
          if (event && event.url) {
            console.log('[Capacitor App]: Received appUrlOpen deep link:', event.url);
            handleAuthDeepLink(event.url);
          }
        });

        // Cold start: User clicked confirmation link while app was closed
        try {
          CapApp.getLaunchUrl().then(launchData => {
            if (launchData && launchData.url) {
              console.log('[Capacitor App]: Received cold-start launch URL:', launchData.url);
              handleAuthDeepLink(launchData.url);
            }
          }).catch(() => {});
        } catch (_) {}
      }

      const { data, error } = await supabaseClient.auth.getSession();
      if (data && data.session && !error) {
        const isVerified = Boolean(
          data.session.user?.email_confirmed_at ||
          data.session.user?.confirmed_at ||
          (data.session.user?.app_metadata?.provider && data.session.user.app_metadata.provider !== 'email')
        );
        if (isVerified) {
          syncAuthSession(data.session);
        } else {
          console.warn('[Supabase Auth Init]: Session user email is not confirmed. Clearing unverified session.');
          try { await supabaseClient.auth.signOut(); } catch (_) {}
          syncAuthSignOut();
        }
      } else if (!isAuthenticated()) {
        syncAuthSignOut();
      }

      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
          const isVerified = Boolean(
            session.user?.email_confirmed_at ||
            session.user?.confirmed_at ||
            (session.user?.app_metadata?.provider && session.user.app_metadata.provider !== 'email')
          );
          if (isVerified) {
            syncAuthSession(session);
          } else {
            console.warn('[Supabase Auth State]: Session user email is not confirmed.');
          }
        } else {
          syncAuthSignOut();
        }
      });
    } else {
      supabaseClient = null;
      if (!isAuthenticated()) {
        syncAuthSignOut();
      }
    }
  } catch (err) {
    console.warn('[Supabase Auth Init Warning]:', err.message);
    supabaseClient = null;
    // CRITICAL FIX: Preserve cached session during offline launch or temporary network drop
    if (!isAuthenticated()) {
      syncAuthSignOut();
    }
  }
}

function syncAuthSession(session) {
  state.isPreviewSession = false;
  state.userToken = session.access_token;
  try {
    localStorage.setItem('taskly_user_token', session.access_token);
  } catch (_) {}

  const meta = session.user?.user_metadata || {};
  state.user.id = session.user?.id;
  state.user.email = session.user?.email || '';
  state.user.isEmailVerified = Boolean(
    session.user?.email_confirmed_at ||
    session.user?.confirmed_at ||
    (session.user?.app_metadata && session.user?.app_metadata?.provider && session.user?.app_metadata?.provider !== 'email')
  );
  state.user.isPreview = false;
  if (meta.name) {
    state.user.name = meta.name;
  } else if (!state.user.name && session.user?.email) {
    state.user.name = session.user.email.split('@')[0];
  }
  if (meta.age) {
    state.user.age = meta.age;
  }

  // Restore or sync durable onboarding completion
  if (meta.onboarding_completed === true || meta.onboarded === true) {
    setOnboardingCompleted(true, false);
  } else if (isOnboardingCompleted()) {
    setOnboardingCompleted(true, true);
  }

  saveUserPreferences();
  updatePreviewUI();
  renderProfile();
  fetchTodos();
  if (typeof SmartListsManager !== 'undefined') {
    SmartListsManager.syncAll().catch(err => console.warn('[SmartLists] Session sync error:', err));
  }
}

function syncAuthSignOut() {
  state.userToken = null;
  state.isPreviewSession = false;
  state.todos = [];
  state.user.id = null;
  state.user.email = '';
  state.user.onboarded = false;
  // NOTE: Device-level onboarding completion status persists across logout/sign-out
  state.user.isPreview = false;
  state.user.isEmailVerified = false;
  try {
    localStorage.removeItem('taskly_user_token');
    localStorage.removeItem('taskly_active_flow');
    localStorage.removeItem('taskly_active_tab');
  } catch (_) {}
  if (typeof syncCustomCategoriesToDOM === 'function') {
    syncCustomCategoriesToDOM('Personal');
  }
  if (typeof SmartListsManager !== 'undefined') {
    SmartListsManager.clearLocalState();
  }
  updatePreviewUI();
  renderAll();
}

// Date Format Helpers
function toYmdString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateFriendly(dateStr) {
  if (!dateStr) return 'No due date';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const today = new Date();
    if (toYmdString(d) === toYmdString(today)) return 'Today';
    
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    if (toYmdString(d) === toYmdString(tomorrow)) return 'Tomorrow';

    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return dateStr;
}

// ==========================================================================
// Initialization
// ==========================================================================
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    loadStoredPreferences();
    applyTheme(state.theme);
    setupEventListeners();
    setupAndroidKeyboardAndViewportHandlers();
    initAddTaskDateTime();

    // Fast synchronous initial route layout to prevent flash of onboarding
    initialRouteFastSync();

    await TasklyNotifications.init();
    await TasklyUpdateManager.init();
    renderQuickNotes();
    await initSupabaseAuth();
    if (typeof SmartListsManager !== 'undefined') {
      await SmartListsManager.init();
    }
    updatePreviewUI();
    if (isLocalPreview() && state.isPreviewSession) {
      initPreviewData();
    } else if (isAuthenticated()) {
      fetchTodos();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateCalendarTimelineRope);
    }

    // Restore the active screen/route on reload or initial visit
    restoreActiveRoute();
  });
}

// Pre-render fast router to eliminate onboarding carousel flash on cold start
function initialRouteFastSync() {
  if (typeof document === 'undefined') return;
  const rawHash = (typeof window !== 'undefined' ? window.location.hash : '');
  const hash = rawHash.replace(/^#\/?/, '').trim().toLowerCase();

  if (isOnboardingCompleted()) {
    if (document.body) {
      document.body.classList.remove('onboarding-active');
    }

    if (isAuthenticated() || (isLocalPreview() && state.isPreviewSession)) {
      const savedTab = (typeof localStorage !== 'undefined') ? localStorage.getItem('taskly_active_tab') : null;
      const mainTabs = ['home', 'calendar', 'progress', 'profile', 'add', 'smart-lists'];
      const targetTab = mainTabs.includes(hash) ? hash : (savedTab && mainTabs.includes(savedTab) ? savedTab : 'home');

      state.flow = 'main';
      state.activeTab = targetTab;
      document.documentElement.setAttribute('data-active-tab', targetTab);
      if (document.body) {
        document.body.setAttribute('data-active-tab', targetTab);
      }
      const onboardingFlow = document.getElementById('onboarding-flow');
      const mainFlow = document.getElementById('main-flow');
      if (onboardingFlow) onboardingFlow.classList.remove('active');
      if (mainFlow) mainFlow.classList.add('active');

      mainTabs.forEach(t => {
        const sec = document.getElementById(`tab-${t}`);
        if (sec) sec.classList.toggle('active', t === targetTab);
      });
    } else {
      const onboardingFlow = document.getElementById('onboarding-flow');
      const mainFlow = document.getElementById('main-flow');
      if (onboardingFlow) onboardingFlow.classList.remove('active');
      if (mainFlow) mainFlow.classList.remove('active');
      const steps = ['screen-launch', 'screen-carousel', 'screen-profile-setup', 'screen-welcome'];
      steps.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === 'screen-profile-setup');
      });
    }
  }
}

// Android Soft-Keyboard & Responsive Viewport Handlers
function setupAndroidKeyboardAndViewportHandlers() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // 1. Capacitor Native Keyboard Plugin Listeners
  if (window.Capacitor?.Plugins?.Keyboard) {
    try {
      window.Capacitor.Plugins.Keyboard.addListener('keyboardWillShow', () => {
        document.body.classList.add('keyboard-open');
      });
      window.Capacitor.Plugins.Keyboard.addListener('keyboardDidShow', () => {
        document.body.classList.add('keyboard-open');
      });
      window.Capacitor.Plugins.Keyboard.addListener('keyboardWillHide', () => {
        document.body.classList.remove('keyboard-open');
      });
      window.Capacitor.Plugins.Keyboard.addListener('keyboardDidHide', () => {
        document.body.classList.remove('keyboard-open');
      });
    } catch (_) {}
  }

  // 2. Visual Viewport API fallback for Android WebViews & Browsers
  if (window.visualViewport) {
    let baseHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const currentHeight = window.visualViewport.height;
      if (baseHeight - currentHeight > 140) {
        document.body.classList.add('keyboard-open');
      } else if (currentHeight >= baseHeight - 40) {
        document.body.classList.remove('keyboard-open');
        baseHeight = Math.max(baseHeight, currentHeight);
      }
    });
  }

  // 3. Smooth Auto-Scroll for Focused Input Fields
  document.addEventListener('focusin', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
      setTimeout(() => {
        try {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {}
      }, 200);
    }
  });
}

// Restore active route based on URL hash, query params, or default to landing page
function restoreActiveRoute() {
  const rawHash = (typeof window !== 'undefined' ? window.location.hash : '');
  const hash = rawHash.replace(/^#\/?/, '').trim().toLowerCase();
  const params = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams());
  const paramTab = params.get('tab');
  const paramStep = params.get('step');

  // Check for email confirmation error in URL hash or search params
  const isAuthError = rawHash.includes('error=') || rawHash.includes('error_description=') || params.has('error');
  if (isAuthError) {
    console.warn('[Auth]: Email confirmation error detected in URL callback.');
    let errorMsg = 'Email confirmation link is invalid or has expired. Please sign in or request a new link.';
    try {
      const hashParams = new URLSearchParams(rawHash.replace(/^#/, ''));
      const desc = hashParams.get('error_description') || params.get('error_description');
      if (desc) errorMsg = desc.replace(/\+/g, ' ');
    } catch (_) {}

    try {
      if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
    } catch (_) {
      if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
    }

    showOnboardingStep('profile-setup', false);
    const authErrorMsg = document.getElementById('auth-error-msg');
    if (authErrorMsg) {
      authErrorMsg.style.display = 'flex';
      authErrorMsg.style.borderColor = '#fecaca';
      authErrorMsg.style.background = '#fef2f2';
      authErrorMsg.style.color = '#dc2626';
      authErrorMsg.textContent = errorMsg;
    }
    return;
  }

  // Check for successful email confirmation / auth callback (both implicit hash tokens & PKCE query code)
  const isAuthCallback = rawHash.includes('access_token=') || rawHash.includes('type=signup') || rawHash.includes('type=email_change') || params.has('code');
  if (isAuthCallback) {
    if (isAuthenticated()) {
      console.log('[Auth]: Email confirmation successful. Navigating to welcome screen.');
      // Remove authentication tokens from the URL without losing the session
      try {
        if (typeof history !== 'undefined') {
          const cleanPath = (typeof window !== 'undefined' && window.location.pathname ? window.location.pathname : '') + '#welcome';
          history.replaceState(null, '', cleanPath);
        }
      } catch (_) {}

      showOnboardingStep('welcome', false);
      return;
    } else {
      console.warn('[Auth]: Auth callback received but session could not be established.');
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
      }
      showOnboardingStep('profile-setup', false);
      const authErrorMsg = document.getElementById('auth-error-msg');
      if (authErrorMsg) {
        authErrorMsg.style.display = 'flex';
        authErrorMsg.style.borderColor = '#fecaca';
        authErrorMsg.style.background = '#fef2f2';
        authErrorMsg.style.color = '#dc2626';
        authErrorMsg.textContent = 'Confirmation link is invalid or has already been used. Please sign in or request a new link.';
      }
      return;
    }
  }

  const mainTabs = ['home', 'calendar', 'progress', 'profile', 'add', 'smart-lists'];
  const onboardingSteps = ['launch', 'carousel', 'profile-setup', 'welcome'];

  // 1. Check if user requests a protected main dashboard tab (via hash or ?tab=)
  const requestedTab = mainTabs.includes(hash) ? hash : (paramTab && mainTabs.includes(paramTab) ? paramTab : null);

  if (requestedTab) {
    if (isAuthenticated() || (isLocalPreview() && state.isPreviewSession)) {
      if (isLocalPreview() && state.isPreviewSession) {
        initPreviewData();
      }
      showMainFlow(requestedTab, false);
    } else {
      console.warn(`[Auth Guard]: Blocked unauthenticated route access to #${requestedTab}. Redirecting to sign in.`);
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
      }
      showOnboardingStep('profile-setup', false);
    }
    return;
  }

  // 2. Check onboarding steps
  if (onboardingSteps.includes(hash)) {
    if (hash === 'launch') {
      if (typeof module !== 'undefined' && module.exports) {
        showOnboardingStep('launch', false);
        return;
      }
      if (isOnboardingCompleted()) {
        if (isAuthenticated()) {
          showMainFlow('home', false);
        } else {
          showOnboardingStep('profile-setup', false);
        }
        return;
      }
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#carousel');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'carousel';
      }
      showOnboardingStep('carousel', false);
      return;
    }
    if (hash === 'carousel') {
      // If already onboarded, bypass carousel on cold-start or root navigation
      if (isOnboardingCompleted() && !params.has('tour') && !(typeof module !== 'undefined' && module.exports && !global.__TEST_ONBOARDING_COMPLETED__)) {
        if (isAuthenticated()) {
          showMainFlow('home', false);
        } else {
          showOnboardingStep('profile-setup', false);
        }
        return;
      }
      showOnboardingStep('carousel', false);
      return;
    }
    if (hash === 'welcome' && !isAuthenticated() && !(isLocalPreview() && state.isPreviewSession)) {
      // Cannot visit welcome screen if not authenticated
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
      }
      showOnboardingStep('profile-setup', false);
      return;
    }
    if (hash === 'profile-setup' && (isAuthenticated() || (isLocalPreview() && state.isPreviewSession))) {
      // Already authenticated: bypass sign in and redirect to home or welcome
      if (isOnboardingCompleted()) {
        showMainFlow('home', false);
      } else {
        showOnboardingStep('welcome', false);
      }
      return;
    }
    showOnboardingStep(hash, false);
    return;
  }

  if (paramStep && onboardingSteps.includes(paramStep)) {
    if (paramStep === 'welcome' && !isAuthenticated() && !(isLocalPreview() && state.isPreviewSession)) {
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
      }
      showOnboardingStep('profile-setup', false);
      return;
    }
    if (paramStep === 'profile-setup' && (isAuthenticated() || (isLocalPreview() && state.isPreviewSession))) {
      if (isOnboardingCompleted()) {
        showMainFlow('home', false);
      } else {
        showOnboardingStep('welcome', false);
      }
      return;
    }
    showOnboardingStep(paramStep, false);
    return;
  }

  // 3. Saved localStorage session if explicitly onboarded and has an active tab AND authenticated
  try {
    const savedFlow = localStorage.getItem('taskly_active_flow');
    const savedTab = localStorage.getItem('taskly_active_tab');
    if (isAuthenticated() && isOnboardingCompleted() && savedFlow === 'main' && savedTab && mainTabs.includes(savedTab)) {
      showMainFlow(savedTab, false);
      return;
    }
  } catch (_) {}

  // 4. Default entry point for root (/):
  // If already authenticated and onboarded, take directly to home dashboard
  if (isAuthenticated() && isOnboardingCompleted()) {
    showMainFlow('home', false);
    return;
  }

  // If authenticated but not yet onboarded (e.g. email confirmation callback), show welcome screen
  if (isAuthenticated()) {
    showOnboardingStep('welcome', false);
    return;
  }

  // If unauthenticated but onboarding completed previously on this device, go straight to sign in
  if (isOnboardingCompleted()) {
    showOnboardingStep('profile-setup', false);
    return;
  }

  // Otherwise start with Onboarding Carousel (genuinely new user)
  showOnboardingStep('carousel', false);
}

// Load preferences from localStorage
function loadStoredPreferences() {
  try {
    const storedUser = localStorage.getItem('taskly_user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      state.user = Object.assign({}, state.user, parsed);
    }
    const storedToken = localStorage.getItem('taskly_user_token');
    if (storedToken && typeof storedToken === 'string' && !storedToken.startsWith('mock-user:')) {
      state.userToken = storedToken;
    } else if (storedToken) {
      // Purge any forbidden mock token immediately
      state.userToken = null;
      try { localStorage.removeItem('taskly_user_token'); } catch (_) {}
    }
    // Prevent stale email exposure if token is missing
    if (!state.userToken) {
      state.user.email = '';
    }

    // Synchronize durable onboarding state
    if (isOnboardingCompleted()) {
      state.onboardingCompleted = true;
      if (state.user) {
        state.user.onboarded = true;
      }
    }
    const storedTheme = localStorage.getItem('taskly_theme');
    if (storedTheme === 'day') {
      state.theme = 'day';
    } else if (storedTheme === 'light') {
      state.theme = 'light';
    } else if (storedTheme === 'dark') {
      state.theme = 'dark';
    } else if (storedTheme === 'pastel') {
      state.theme = 'pastel';
    } else if (storedTheme === 'pet') {
      state.theme = 'pet';
    } else {
      state.theme = 'light';
    }

    try {
      const userQcKey = state.user && state.user.id ? `taskly_quick_notes_${state.user.id}` : null;
      let storedQc = userQcKey ? localStorage.getItem(userQcKey) : null;
      if (!storedQc) {
        storedQc = localStorage.getItem('taskly_quick_notes');
      }
      if (storedQc) {
        state.quickNotes = JSON.parse(storedQc);
      } else {
        state.quickNotes = [
          { id: 1, text: "Buy cat & dog treats", isPinned: true },
          { id: 2, text: "Review mobile release v1.4", isPinned: false }
        ];
      }
    } catch (_) {
      state.quickNotes = [
        { id: 1, text: "Buy cat & dog treats", isPinned: true },
        { id: 2, text: "Review mobile release v1.4", isPinned: false }
      ];
    }
  } catch (e) {
    console.warn('Could not read localStorage:', e);
  }
}

function saveUserPreferences() {
  try {
    localStorage.setItem('taskly_user', JSON.stringify(state.user));
  } catch (e) {
    console.warn('Could not write localStorage:', e);
  }
}

function applyTheme(theme = 'light') {
  let normalized = 'light';
  if (theme === 'dark') normalized = 'dark';
  else if (theme === 'pet') normalized = 'pet';
  else if (theme === 'pastel') normalized = 'pastel';
  else if (theme === 'day') normalized = 'day';
  else if (theme === 'light') normalized = 'light';
  else normalized = 'light';
  state.theme = normalized;

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', normalized);
    if (document.body) {
      document.body.setAttribute('data-theme', normalized);
    }

    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
      if (normalized === 'light' || normalized === 'day') {
        const activeTab = state.activeTab || 'home';
        const colorMap = {
          home: '#38BDF8',
          calendar: '#FFE1E7',
          progress: '#FFF1B8',
          profile: '#38BDF8',
          add: '#38BDF8'
        };
        metaTheme.setAttribute('content', colorMap[activeTab] || '#38BDF8');
      } else if (normalized === 'dark') {
        metaTheme.setAttribute('content', '#121820');
      } else if (normalized === 'pastel') {
        metaTheme.setAttribute('content', '#F5F3FF');
      } else {
        metaTheme.setAttribute('content', '#FDF1EA');
      }
    }

    // Update profile theme label
    const themeValEl = document.getElementById('theme-display-val');
    if (themeValEl) {
      if (normalized === 'light' || normalized === 'day') {
        themeValEl.textContent = 'Light Mode ›';
      } else if (normalized === 'dark') {
        themeValEl.textContent = 'Dark Mode ›';
      } else if (normalized === 'pet') {
        themeValEl.textContent = 'Pet Mode ›';
      } else if (normalized === 'pastel') {
        themeValEl.textContent = 'Pastel Light Mode ›';
      }
    }

    // Update modal active selection
    const optLight = document.getElementById('theme-choice-light');
    const optDay = document.getElementById('theme-choice-day');
    const optDark = document.getElementById('theme-choice-dark');
    const optPet = document.getElementById('theme-choice-pet');
    const optPastel = document.getElementById('theme-choice-pastel');

    const isLight = normalized === 'light' || normalized === 'day';
    if (optLight) optLight.classList.toggle('active', isLight);
    if (optDay && optDay !== optLight) optDay.classList.toggle('active', isLight);
    if (optDark) optDark.classList.toggle('active', normalized === 'dark');
    if (optPet) optPet.classList.toggle('active', normalized === 'pet');
    if (optPastel) optPastel.classList.toggle('active', normalized === 'pastel');
  }

  try {
    localStorage.setItem('taskly_theme', normalized);
  } catch (_) {}
}

// ==========================================================================
// Time & Deadline Helpers for Notifications
// ==========================================================================
// Converts any time string ("18:30", "6:30 PM", "06:30 PM", "9:05 AM") into "HH:mm" 24-hour format
function formatTimeTo24Hour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return '';
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const mer = match[3] ? match[3].toUpperCase() : null;
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  return `${String(Math.min(23, Math.max(0, h))).padStart(2, '0')}:${String(Math.min(59, Math.max(0, m))).padStart(2, '0')}`;
}

// Converts "HH:mm" (or 12h string) into friendly "hh:mm A" (e.g. "06:30 PM")
function formatTime24To12(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = String(match[2]).padStart(2, '0');
  const mer = match[3] ? match[3].toUpperCase() : (h >= 12 ? 'PM' : 'AM');

  if (!match[3]) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  return `${String(h).padStart(2, '0')}:${m} ${mer}`;
}

// Rounds a Date object up to the next 5-minute interval and returns "HH:mm"
function getRoundedLocalTime(date = new Date(), intervalMinutes = 5) {
  const d = new Date(date);
  const ms = 1000 * 60 * intervalMinutes;
  const rounded = new Date(Math.ceil(d.getTime() / ms) * ms);
  const hh = String(rounded.getHours()).padStart(2, '0');
  const mm = String(rounded.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function initAddTaskDateTime() {
  if (typeof document === 'undefined') return;
  const dateInput = document.getElementById('add-due-date');
  const timeInput = document.getElementById('add-time');
  const timeDisplay = document.getElementById('add-time-display');

  if (dateInput && !dateInput.value) {
    dateInput.value = state.selectedDateStr || toYmdString(new Date());
  }

  const roundedTime24 = getRoundedLocalTime();
  if (timeInput) {
    if (!timeInput.value) {
      timeInput.value = roundedTime24;
    }
    if (timeDisplay) {
      timeDisplay.textContent = formatTime24To12(timeInput.value || roundedTime24);
    }
  }
}

function parseTaskDeadline(dueDate, timeStr) {
  if (!dueDate || typeof dueDate !== 'string') return null;
  const parts = dueDate.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const [year, month, day] = parts;

  let hours = 18; // Default fallback if no time specified
  let minutes = 0;

  if (timeStr && typeof timeStr === 'string') {
    const trimmed = timeStr.trim();
    // Match 12-hour or 24-hour format: e.g. "6:00 PM", "06:30 PM", "18:30"
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const mer = match[3] ? match[3].toUpperCase() : null;
      if (mer === 'PM' && h < 12) h += 12;
      if (mer === 'AM' && h === 12) h = 0;
      hours = Math.min(23, Math.max(0, h));
      minutes = Math.min(59, Math.max(0, m));
    }
  }

  const deadline = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return isNaN(deadline.getTime()) ? null : deadline;
}

function formatTimeAgo(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTimeFriendly(dateObj) {
  if (!dateObj || isNaN(new Date(dateObj).getTime())) return '';
  const d = new Date(dateObj);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (toYmdString(d) === toYmdString(today)) return `Today, ${timePart}`;
  if (toYmdString(d) === toYmdString(tomorrow)) return `Tomorrow, ${timePart}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${timePart}`;
}

// ==========================================================================
// Taskly Notification System (Native Capacitor & In-App Notification Centre)
// ==========================================================================
const TasklyNotifications = {
  CHANNEL_ID: 'taskly-reminders-v3',
  LEGACY_CHANNELS: ['taskly-reminders', 'taskly-reminders-v2'],
  NOTIFICATION_SOUND: 'taskly_meow.wav',
  STORAGE_KEY_PREFIX: 'taskly_notifications_',
  SCHEDULE_REGISTRY_KEY: 'taskly_scheduled_reminders',
  MIGRATION_FLAG_KEY: 'taskly_channel_migrated_v3',

  // Notification Settings Storage Keys
  STORAGE_KEY_MASTER: 'taskly_notifications_enabled',
  STORAGE_KEY_SOUND_ENABLED: 'taskly_notifications_sound_enabled',
  STORAGE_KEY_SELECTED_SOUND: 'taskly_notification_selected_sound',

  // 10 custom notification sound choices bundled locally in both android raw & web assets
  SOUND_OPTIONS: [
    {
      id: 'cat_meow',
      name: 'Cat Meow',
      description: "Taskly's signature cat meow (Default)",
      file: 'taskly_meow.wav',
      channelId: 'taskly-reminders-v3',
      channelName: 'Taskly Reminders (Cat Meow)'
    },
    {
      id: 'gentle_chime',
      name: 'Gentle Chime',
      description: 'Soft harmonic ascending chime',
      file: 'taskly_chime.wav',
      channelId: 'taskly-sound-gentle-chime',
      channelName: 'Taskly Reminders (Gentle Chime)'
    },
    {
      id: 'soft_bell',
      name: 'Soft Bell',
      description: 'Warm acoustic bell tone',
      file: 'taskly_soft_bell.wav',
      channelId: 'taskly-sound-soft-bell',
      channelName: 'Taskly Reminders (Soft Bell)'
    },
    {
      id: 'classic',
      name: 'Classic Notification',
      description: 'Friendly two-tone alert',
      file: 'taskly_classic.wav',
      channelId: 'taskly-sound-classic',
      channelName: 'Taskly Reminders (Classic)'
    },
    {
      id: 'digital_pop',
      name: 'Digital Pop',
      description: 'Snappy modern bubble pop',
      file: 'taskly_pop.wav',
      channelId: 'taskly-sound-pop',
      channelName: 'Taskly Reminders (Digital Pop)'
    },
    {
      id: 'bubble',
      name: 'Bubble',
      description: 'Smooth upward bubbly tone',
      file: 'taskly_bubble.wav',
      channelId: 'taskly-sound-bubble',
      channelName: 'Taskly Reminders (Bubble)'
    },
    {
      id: 'glass_tap',
      name: 'Glass Tap',
      description: 'Crystalline resonant chime',
      file: 'taskly_glass.wav',
      channelId: 'taskly-sound-glass',
      channelName: 'Taskly Reminders (Glass Tap)'
    },
    {
      id: 'soft_marimba',
      name: 'Soft Marimba',
      description: 'Warm acoustic wooden mallet',
      file: 'taskly_marimba.wav',
      channelId: 'taskly-sound-marimba',
      channelName: 'Taskly Reminders (Soft Marimba)'
    },
    {
      id: 'calm_melody',
      name: 'Calm Melody',
      description: 'Gentle 3-note arpeggio',
      file: 'taskly_melody.wav',
      channelId: 'taskly-sound-melody',
      channelName: 'Taskly Reminders (Calm Melody)'
    },
    {
      id: 'water_drop',
      name: 'Water Drop',
      description: 'Organic liquid droplet sound',
      file: 'taskly_water_drop.wav',
      channelId: 'taskly-sound-water-drop',
      channelName: 'Taskly Reminders (Water Drop)'
    }
  ],

  SILENT_CHANNEL_ID: 'taskly-sound-silent',

  // Audio preview state
  currentPreviewAudio: null,
  currentPreviewSoundId: null,

  isNative() {
    return Boolean(
      typeof window !== 'undefined' &&
      (window.Capacitor?.isNativePlatform?.() ||
       window.Capacitor?.getPlatform?.() === 'android' ||
       window.Capacitor?.getPlatform?.() === 'ios') &&
      window.Capacitor?.Plugins?.LocalNotifications
    );
  },

  getPlugin() {
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications) {
      return window.Capacitor.Plugins.LocalNotifications;
    }
    return null;
  },

  areNotificationsEnabled() {
    try {
      if (typeof localStorage === 'undefined') return true;
      const val = localStorage.getItem(this.STORAGE_KEY_MASTER);
      return val === null ? true : val !== 'false';
    } catch (_) {
      return true;
    }
  },

  isSoundEnabled() {
    try {
      if (typeof localStorage === 'undefined') return true;
      const val = localStorage.getItem(this.STORAGE_KEY_SOUND_ENABLED);
      return val === null ? true : val !== 'false';
    } catch (_) {
      return true;
    }
  },

  getSelectedSoundId() {
    try {
      if (typeof localStorage === 'undefined') return 'cat_meow';
      const val = localStorage.getItem(this.STORAGE_KEY_SELECTED_SOUND);
      return val || 'cat_meow';
    } catch (_) {
      return 'cat_meow';
    }
  },

  getSettings() {
    return {
      masterEnabled: this.areNotificationsEnabled(),
      soundEnabled: this.isSoundEnabled(),
      selectedSound: this.getSelectedSoundId()
    };
  },

  getActiveChannelConfig() {
    if (!this.areNotificationsEnabled()) {
      return { enabled: false, channelId: null, sound: null };
    }
    if (!this.isSoundEnabled()) {
      return {
        enabled: true,
        channelId: this.SILENT_CHANNEL_ID,
        sound: undefined
      };
    }
    const soundId = this.getSelectedSoundId();
    const soundOpt = this.SOUND_OPTIONS.find(s => s.id === soundId) || this.SOUND_OPTIONS[0];
    return {
      enabled: true,
      channelId: soundOpt.channelId,
      sound: soundOpt.file
    };
  },

  async setMasterEnabled(enabled) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY_MASTER, enabled ? 'true' : 'false');
      }
    } catch (_) {}
    this.updateProfileBadge();
    if (!enabled) {
      const plugin = this.getPlugin();
      const reg = this.getScheduledRegistry();
      if (plugin && reg.length > 0) {
        try {
          await plugin.cancel({ notifications: reg.map(r => ({ id: r.id })) });
        } catch (_) {}
      }
      this.saveScheduledRegistry([]);
    } else {
      await this.rescheduleAllEligibleReminders();
    }
  },

  async setSoundEnabled(enabled) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY_SOUND_ENABLED, enabled ? 'true' : 'false');
      }
    } catch (_) {}
    if (this.areNotificationsEnabled()) {
      await this.rescheduleAllEligibleReminders();
    }
  },

  async setSelectedSound(soundId) {
    const soundOpt = this.SOUND_OPTIONS.find(s => s.id === soundId);
    if (!soundOpt) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY_SELECTED_SOUND, soundId);
      }
    } catch (_) {}
    this.updateSoundSelectionUI(soundId);
    if (this.areNotificationsEnabled() && this.isSoundEnabled()) {
      await this.rescheduleAllEligibleReminders();
    }
  },

  async rescheduleAllEligibleReminders() {
    const plugin = this.getPlugin();
    const reg = this.getScheduledRegistry();
    if (plugin && reg.length > 0) {
      try {
        await plugin.cancel({ notifications: reg.map(r => ({ id: r.id })) });
      } catch (_) {}
    }
    this.saveScheduledRegistry([]);

    if (!this.areNotificationsEnabled()) return;

    // Reschedule active incomplete tasks with reminders
    const tasks = state.todos || [];
    for (const task of tasks) {
      if (!task.completed && task.dueDate && task.reminder === true) {
        await this.scheduleTaskDeadlines(task);
      }
    }

    // Reschedule active quick notes with reminders
    const notes = state.quickNotes || [];
    const now = Date.now();
    for (const note of notes) {
      if (note.reminderDate && new Date(note.reminderDate).getTime() > (now + 1000)) {
        await this.scheduleQuickNoteReminder(note, note.reminderDate);
      }
    }
  },

  updateProfileBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('profile-notifications-badge');
    if (badge) {
      badge.textContent = this.areNotificationsEnabled() ? 'On' : 'Off';
    }
  },

  previewSound(soundId) {
    const soundEntry = this.SOUND_OPTIONS.find(s => s.id === soundId);
    if (!soundEntry) return;

    // If currently previewing this sound, toggle off
    if (this.currentPreviewSoundId === soundId && this.currentPreviewAudio) {
      this.stopSoundPreview();
      return;
    }

    this.stopSoundPreview();

    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const audio = new Audio(`/assets/sounds/${soundEntry.file}`);
        audio.volume = 0.85;
        this.currentPreviewAudio = audio;
        this.currentPreviewSoundId = soundId;
        this.updatePreviewButtonsUI();

        audio.addEventListener('ended', () => {
          this.currentPreviewAudio = null;
          this.currentPreviewSoundId = null;
          this.updatePreviewButtonsUI();
        });

        audio.addEventListener('error', () => {
          this.currentPreviewAudio = null;
          this.currentPreviewSoundId = null;
          this.updatePreviewButtonsUI();
        });

        audio.play().catch(err => {
          console.warn('[NotificationSettings] Preview playback notice:', err);
          this.currentPreviewAudio = null;
          this.currentPreviewSoundId = null;
          this.updatePreviewButtonsUI();
        });
      }
    } catch (e) {
      console.warn('[NotificationSettings] Audio instantiation notice:', e);
    }
  },

  stopSoundPreview() {
    if (this.currentPreviewAudio) {
      try {
        this.currentPreviewAudio.pause();
        this.currentPreviewAudio.currentTime = 0;
      } catch (_) {}
      this.currentPreviewAudio = null;
    }
    this.currentPreviewSoundId = null;
    this.updatePreviewButtonsUI();
  },

  updatePreviewButtonsUI() {
    if (typeof document === 'undefined') return;
    const buttons = document.querySelectorAll('.btn-sound-preview');
    buttons.forEach(btn => {
      const soundId = btn.getAttribute('data-sound-id');
      const isPlaying = (this.currentPreviewSoundId === soundId);
      const iconPlay = btn.querySelector('.icon-play');
      const iconStop = btn.querySelector('.icon-stop');
      if (isPlaying) {
        btn.classList.add('playing');
        btn.setAttribute('aria-label', `Stop previewing ${soundId}`);
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconStop) iconStop.style.display = 'block';
      } else {
        btn.classList.remove('playing');
        btn.setAttribute('aria-label', `Preview ${soundId}`);
        if (iconPlay) iconPlay.style.display = 'block';
        if (iconStop) iconStop.style.display = 'none';
      }
    });
  },

  updateSoundSelectionUI(soundId) {
    if (typeof document === 'undefined') return;
    const cards = document.querySelectorAll('.sound-option-card');
    cards.forEach(card => {
      const id = card.getAttribute('data-sound-id');
      const isSelected = (id === soundId);
      card.classList.toggle('active', isSelected);
      card.setAttribute('aria-checked', String(isSelected));
    });
  },

  async checkAndDisplayPermissionStatus() {
    const warning = document.getElementById('notif-permission-warning');
    if (!warning) return;
    const plugin = this.getPlugin();
    if (plugin && typeof plugin.checkPermissions === 'function') {
      try {
        const perm = await plugin.checkPermissions();
        if (perm && (perm.display === 'denied' || perm.receive === 'denied')) {
          warning.style.display = 'flex';
          return;
        }
      } catch (_) {}
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'denied') {
        warning.style.display = 'flex';
        return;
      }
    }
    warning.style.display = 'none';
  },

  async openSettingsModal() {
    if (typeof document === 'undefined') return;
    this.stopSoundPreview();

    const masterToggle = document.getElementById('toggle-master-notifications');
    const soundToggle = document.getElementById('toggle-notification-sound');
    if (masterToggle) masterToggle.checked = this.areNotificationsEnabled();
    if (soundToggle) soundToggle.checked = this.isSoundEnabled();

    this.updateSoundSelectionUI(this.getSelectedSoundId());
    await this.checkAndDisplayPermissionStatus();

    const modal = document.getElementById('modal-notification-settings');
    if (modal) modal.classList.add('active');
  },

  closeSettingsModal() {
    this.stopSoundPreview();
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-notification-settings');
    if (modal) modal.classList.remove('active');
  },

  initNotificationSettingsUI() {
    if (typeof document === 'undefined') return;

    this.updateProfileBadge();

    const isWired = (el) => {
      if (!el) return true;
      if (el.dataset && el.dataset.wired) return true;
      if (typeof el.getAttribute === 'function') return el.getAttribute('data-wired') === 'true';
      return Boolean(el._wired);
    };

    const markWired = (el) => {
      if (!el) return;
      if (el.dataset) el.dataset.wired = 'true';
      if (typeof el.setAttribute === 'function') el.setAttribute('data-wired', 'true');
      el._wired = true;
    };

    const masterToggle = document.getElementById('toggle-master-notifications');
    const soundToggle = document.getElementById('toggle-notification-sound');

    if (masterToggle && !isWired(masterToggle)) {
      markWired(masterToggle);
      masterToggle.checked = this.areNotificationsEnabled();
      if (typeof masterToggle.addEventListener === 'function') {
        masterToggle.addEventListener('change', async (e) => {
          await this.setMasterEnabled(e.target.checked);
          if (typeof SmartListsManager !== 'undefined') {
            await SmartListsManager.scheduleDailySummaryReminder();
          }
        });
      }
    }

    if (soundToggle && !isWired(soundToggle)) {
      markWired(soundToggle);
      soundToggle.checked = this.isSoundEnabled();
      if (typeof soundToggle.addEventListener === 'function') {
        soundToggle.addEventListener('change', async (e) => {
          await this.setSoundEnabled(e.target.checked);
          if (typeof SmartListsManager !== 'undefined') {
            await SmartListsManager.scheduleDailySummaryReminder();
          }
        });
      }
    }

    const cards = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.sound-option-card') : [];
    if (cards && typeof cards.forEach === 'function') {
      cards.forEach(card => {
        if (!isWired(card)) {
          markWired(card);
          const soundId = typeof card.getAttribute === 'function' ? card.getAttribute('data-sound-id') : null;
          if (typeof card.addEventListener === 'function') {
            card.addEventListener('click', async (e) => {
              if (e.target && typeof e.target.closest === 'function' && e.target.closest('.btn-sound-preview')) return;
              if (soundId) await this.setSelectedSound(soundId);
            });
            card.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (soundId) await this.setSelectedSound(soundId);
              }
            });
          }
        }
      });
    }

    const previewBtns = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.btn-sound-preview') : [];
    if (previewBtns && typeof previewBtns.forEach === 'function') {
      previewBtns.forEach(btn => {
        if (!isWired(btn)) {
          markWired(btn);
          const soundId = typeof btn.getAttribute === 'function' ? btn.getAttribute('data-sound-id') : null;
          if (typeof btn.addEventListener === 'function') {
            btn.addEventListener('click', (e) => {
              if (typeof e.stopPropagation === 'function') e.stopPropagation();
              if (soundId) this.previewSound(soundId);
            });
          }
        }
      });
    }

    this.updateSoundSelectionUI(this.getSelectedSoundId());

    const btnClose = document.getElementById('btn-close-notification-settings');
    const btnDone = document.getElementById('btn-notification-settings-done');
    const modalSettings = document.getElementById('modal-notification-settings');

    if (btnClose && !isWired(btnClose)) {
      markWired(btnClose);
      if (typeof btnClose.addEventListener === 'function') {
        btnClose.addEventListener('click', () => this.closeSettingsModal());
      }
    }
    if (btnDone && !isWired(btnDone)) {
      markWired(btnDone);
      if (typeof btnDone.addEventListener === 'function') {
        btnDone.addEventListener('click', () => this.closeSettingsModal());
      }
    }
    if (modalSettings && !isWired(modalSettings)) {
      markWired(modalSettings);
      if (typeof modalSettings.addEventListener === 'function') {
        modalSettings.addEventListener('click', (e) => {
          if (e.target === modalSettings) this.closeSettingsModal();
        });
      }
    }

    const menuNotifications = document.getElementById('menu-notifications');
    const btnOpenNotifications = document.getElementById('btn-open-notification-settings');
    if (menuNotifications && !isWired(menuNotifications)) {
      markWired(menuNotifications);
      if (typeof menuNotifications.addEventListener === 'function') {
        menuNotifications.addEventListener('click', () => this.openSettingsModal());
      }
    }
    if (btnOpenNotifications && !isWired(btnOpenNotifications)) {
      markWired(btnOpenNotifications);
      if (typeof btnOpenNotifications.addEventListener === 'function') {
        btnOpenNotifications.addEventListener('click', () => this.openSettingsModal());
      }
    }
  },

  async createAllChannels(plugin) {
    if (!plugin || typeof plugin.createChannel !== 'function') return;

    // Create high-importance channel for cat meow (default)
    await plugin.createChannel({
      id: this.CHANNEL_ID,
      name: 'Taskly Reminders & Tasks',
      description: 'Task deadlines, updates, and Quick Note reminders with cute cat meow sound',
      importance: 5,
      visibility: 1,
      sound: this.NOTIFICATION_SOUND,
      vibration: true,
      lights: true,
      lightColor: '#F88438'
    }).catch(err => console.warn('[Notifications] createChannel warning:', err));

    // Create dedicated channels for each other custom sound
    for (const opt of this.SOUND_OPTIONS) {
      if (opt.channelId !== this.CHANNEL_ID) {
        await plugin.createChannel({
          id: opt.channelId,
          name: opt.channelName,
          description: `Taskly notifications with ${opt.name} sound`,
          importance: 5,
          visibility: 1,
          sound: opt.file,
          vibration: true,
          lights: true,
          lightColor: '#F88438'
        }).catch(err => console.warn(`[Notifications] createChannel for ${opt.id} warning:`, err));
      }
    }

    // Create dedicated silent channel (importance: 3, vibration: true, no sound)
    await plugin.createChannel({
      id: this.SILENT_CHANNEL_ID,
      name: 'Taskly Silent Reminders',
      description: 'Taskly notifications delivered silently with vibration',
      importance: 3,
      visibility: 1,
      sound: undefined,
      vibration: true,
      lights: true,
      lightColor: '#F88438'
    }).catch(err => console.warn('[Notifications] createChannel for silent warning:', err));
  },

  playMeow(force = false) {
    // In Android native app, sound is played by Android OS notification channel.
    // In-app HTML5 audio should NEVER play on native Android, preventing duplicate sounds and startup noise.
    if (this.isNative() && !force) return;
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const audio = new Audio('/assets/sounds/taskly_meow.wav');
        audio.volume = 0.8;
        audio.play().catch(() => {});
      }
    } catch (_) {}
  },

  // Backwards compatibility alias
  playChime(force = false) {
    this.playMeow(force);
  },

  async init() {
    this.loadHistory();
    this.updateBadges();
    this.updateProfileBadge();
    this.initNotificationSettingsUI();

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        // Safe Channel Migration: Remove old legacy channels
        try {
          if (typeof plugin.deleteChannel === 'function') {
            for (const legacyId of this.LEGACY_CHANNELS) {
              await plugin.deleteChannel({ id: legacyId }).catch(() => {});
            }
          }
        } catch (mErr) {
          console.warn('[Notifications] Channel migration notice:', mErr);
        }

        // Clear any stale delivered notifications from previous app builds/channels
        try {
          if (typeof plugin.removeAllDeliveredNotifications === 'function') {
            await plugin.removeAllDeliveredNotifications().catch(() => {});
          }
        } catch (_) {}

        // Create all 10 sound channels and the silent channel
        await this.createAllChannels(plugin);

        // Register Action Types for notifications
        if (typeof plugin.registerActionTypes === 'function') {
          await plugin.registerActionTypes({
            types: [
              {
                id: 'TASK_DEADLINE_ACTIONS',
                actions: [
                  { id: 'COMPLETE_TASK', title: 'Complete' },
                  { id: 'SNOOZE_TASK', title: 'Snooze' },
                  { id: 'VIEW_TASK', title: 'View Task' }
                ]
              },
              {
                id: 'QUICK_NOTE_ACTIONS',
                actions: [
                  { id: 'OPEN_NOTE', title: 'Open Note' },
                  { id: 'SNOOZE_NOTE', title: 'Snooze' }
                ]
              }
            ]
          }).catch(err => console.warn('[Notifications] registerActionTypes warning:', err));
        }

        // Android 13+ (POST_NOTIFICATIONS) permission handling
        const check = await plugin.checkPermissions().catch(() => ({ display: 'prompt' }));
        if (check && check.display !== 'granted') {
          await plugin.requestPermissions().catch(err => console.warn('[Notifications] requestPermissions error:', err));
        }

        plugin.addListener('localNotificationActionPerformed', (notificationAction) => {
          this.handleNotificationTap(notificationAction);
        });

        plugin.addListener('localNotificationReceived', (notification) => {
          this.handleNotificationReceived(notification);
        });

        const AppPlugin = (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App);
        if (AppPlugin && typeof AppPlugin.addListener === 'function') {
          AppPlugin.addListener('appStateChange', (appState) => {
            if (appState?.isActive) {
              this.reconcileScheduledReminders();
              this.loadHistory();
              this.updateBadges();
              this.updateProfileBadge();
            }
          });
        }
      } catch (err) {
        console.warn('[Notifications] Plugin initialization warning:', err);
      }
    }

    await this.reconcileScheduledReminders();
  },

  async requestPermission() {
    const plugin = this.getPlugin();
    if (plugin) {
      try {
        const res = await plugin.requestPermissions();
        return res.display === 'granted';
      } catch (e) {
        return false;
      }
    }
    const NotifAPI = (typeof window !== 'undefined' && window.Notification) || (typeof Notification !== 'undefined' ? Notification : null);
    if (NotifAPI) {
      try {
        const res = await NotifAPI.requestPermission();
        return res === 'granted';
      } catch (e) {
        return false;
      }
    }
    return false;
  },

  getStableId(sourceId, type = 0) {
    const str = `${sourceId}_${type}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & 0x7fffffff;
    }
    return hash === 0 ? 1 : hash;
  },

  getStorageKey() {
    const userId = (state.user && state.user.id) ? state.user.id : 'guest';
    return `${this.STORAGE_KEY_PREFIX}${userId}`;
  },

  loadHistory() {
    try {
      if (typeof localStorage === 'undefined') {
        state.notifications = [];
        return;
      }
      const raw = localStorage.getItem(this.getStorageKey());
      state.notifications = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.notifications)) state.notifications = [];
    } catch (_) {
      state.notifications = [];
    }
    this.updateBadges();
  },

  saveHistory() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.getStorageKey(), JSON.stringify((state.notifications || []).slice(0, 50)));
      }
    } catch (_) {}
    this.updateBadges();
  },

  resolveCatIcon(type, icon = null, largeIcon = null) {
    let resolvedLarge = 'notif_cat_created';
    if (type === 'task_created' || type === 'task_completed') resolvedLarge = 'notif_cat_created';
    else if (type === 'task_updated') resolvedLarge = 'notif_cat_updated';
    else if (type === 'task_deleted') resolvedLarge = 'notif_cat_deleted';
    else if (type === 'deadline_approaching' || type === 'reminder_upcoming') resolvedLarge = 'notif_cat_upcoming';
    else if (type === 'deadline_reached' || type === 'deadline_snoozed') resolvedLarge = 'notif_cat_reached';
    else if (type === 'task_overdue') resolvedLarge = 'notif_cat_overdue';
    else if (type === 'quick_note_reminder' || type === 'quick_note_snoozed' || type?.includes('quick_note')) resolvedLarge = 'notif_cat_quicknote';
    else if (type === 'system' || type === 'brand' || type === 'general') resolvedLarge = 'logo';

    const chosenLarge = largeIcon || resolvedLarge;
    const resolvedWeb = (chosenLarge === 'logo') ? '/logo.png' : `/assets/pets/${chosenLarge}.png`;
    return {
      largeIcon: chosenLarge,
      webIcon: (icon && icon.startsWith('/')) ? icon : resolvedWeb
    };
  },

  addInAppNotification({ title, description, headline = null, type = 'system', icon = null, largeIcon = null, sourceId = null, sourceType = null, actionUrl = null, playSound = false }) {
    const icons = this.resolveCatIcon(type, icon, largeIcon);
    const entry = {
      id: 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      title,
      headline: headline || title,
      description,
      timestamp: new Date().toISOString(),
      read: false,
      type,
      icon: icons.webIcon,
      largeIcon: icons.largeIcon,
      sourceId,
      sourceType,
      actionUrl
    };

    if (!Array.isArray(state.notifications)) state.notifications = [];
    state.notifications.unshift(entry);
    if (state.notifications.length > 50) state.notifications = state.notifications.slice(0, 50);

    this.saveHistory();
    this.renderNotificationList();

    // Play meow strictly only when explicitly requested on non-native web; never during startup or on native Android
    if (playSound && !this.isNative()) {
      this.playMeow(true);
    }

    if (!this.isNative() && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: description,
          icon: icons.webIcon || '/logo.png'
        });
      } catch (_) {}
    }

    return entry;
  },

  timingMetrics: {
    lastOperationSucceededAt: 0,
    lastNotificationRequestedAt: 0,
    lastNotificationDispatchedAt: 0,
    applicationLatencyMs: 0
  },

  async notifyImmediate({ title, description, headline = null, type = 'system', icon = null, largeIcon = null, sourceId = null, sourceType = null, actionUrl = null, opSuccessTimestamp = null }) {
    const requestStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.timingMetrics.lastNotificationRequestedAt = requestStart;
    if (opSuccessTimestamp) {
      this.timingMetrics.lastOperationSucceededAt = opSuccessTimestamp;
    }

    const safeTitle = title || 'Taskly';
    const safeHeadline = headline || safeTitle;
    const safeDescription = description || '';
    const icons = this.resolveCatIcon(type, icon, largeIcon);
    this.addInAppNotification({
      title: safeTitle,
      description: safeDescription,
      headline: safeHeadline,
      type,
      icon: icons.webIcon,
      largeIcon: icons.largeIcon,
      sourceId,
      sourceType,
      actionUrl,
      playSound: false
    });

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        const activeConfig = this.getActiveChannelConfig();
        if (!activeConfig.enabled) {
          return;
        }

        const id = this.getStableId(`immediate_${Date.now()}`, Math.floor(Math.random() * 1000));
        let summaryText = 'Taskly';
        if (type === 'task_created') summaryText = 'Task Created';
        else if (type === 'task_updated') summaryText = 'Task Updated';
        else if (type === 'task_deleted') summaryText = 'Task Removed';
        else if (type === 'task_completed') summaryText = 'Task Completed';

        const largeBody = safeHeadline ? `${safeHeadline}\n${safeDescription}` : safeDescription;

        // Immediate dispatch: omit schedule property so Android NotificationManager delivers instantly
        // without routing through AlarmManager or waiting for a ~5s battery/batching cycle.
        await plugin.schedule({
          notifications: [
            {
              id,
              title: safeTitle,
              body: safeHeadline || safeDescription,
              largeBody,
              summaryText,
              channelId: activeConfig.channelId,
              sound: activeConfig.sound,
              smallIcon: 'ic_stat_paw',
              largeIcon: icons.largeIcon,
              iconColor: '#F88438',
              group: 'taskly_reminders',
              extra: { sourceId, sourceType, actionUrl, type }
            }
          ]
        });

        const dispatchEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.timingMetrics.lastNotificationDispatchedAt = dispatchEnd;
        const baseTime = this.timingMetrics.lastOperationSucceededAt || requestStart;
        this.timingMetrics.applicationLatencyMs = Math.round(dispatchEnd - baseTime);
        console.log(`[NotificationTiming] Immediate notification for "${type}" triggered in ${this.timingMetrics.applicationLatencyMs}ms`);
      } catch (err) {
        console.warn('[Notifications] Immediate schedule warning:', err);
      }
    }
  },

  async scheduleTaskDeadlines(task) {
    if (!task || !task.dueDate || task.completed) return;
    if (task.reminder === false) return; // Individual task reminder control: OFF schedules no notifications
    const activeConfig = this.getActiveChannelConfig();
    if (!activeConfig.enabled) return; // Master notifications disabled

    const deadline = parseTaskDeadline(task.dueDate, task.time);
    if (!deadline || isNaN(deadline.getTime())) return;

    const rawTitle = task.title && typeof task.title === 'string' ? task.title.trim() : '';
    const taskTitle = rawTitle || 'Untitled Task';
    const shortTitle = taskTitle.length > 55 ? (taskTitle.substring(0, 52) + '...') : taskTitle;
    const taskCategory = task.category || 'General';
    const taskPriority = task.priority || 'Medium';
    const taskTime = task.time ? task.time : '';
    const taskDesc = task.description && typeof task.description === 'string' && task.description.trim() ? `\n${task.description.trim()}` : '';

    const now = Date.now();
    const leadMinutes = state.notificationSettings?.reminderLeadMinutes || 30;
    const leadMs = leadMinutes * 60 * 1000;

    const approachingTime = new Date(deadline.getTime() - leadMs);
    const reachedTime = deadline;
    const overdueTime = new Date(deadline.getTime() + (60 * 60 * 1000));

    const plugin = this.getPlugin();
    const notificationsToSchedule = [];

    // 1. Approaching (strictly only future timestamps to prevent catch-up audio)
    if (approachingTime.getTime() > (now + 1000)) {
      const notifId = this.getStableId(task.id, 'approaching');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Taskly · Reminder (Upcoming)',
        body: 'Your deadline is getting closer!',
        largeBody: `Your deadline is getting closer!\n"${taskTitle}" is due in ${leadMinutes} minutes.${taskDesc}`,
        summaryText: 'Reminder',
        schedule: { at: approachingTime, allowWhileIdle: true },
        channelId: activeConfig.channelId,
        sound: activeConfig.sound,
        smallIcon: 'ic_stat_paw',
        largeIcon: 'notif_cat_upcoming',
        iconColor: '#F88438',
        group: 'taskly_reminders',
        actionTypeId: 'TASK_DEADLINE_ACTIONS',
        extra: { taskId: task.id, type: 'deadline_approaching', sourceType: 'task' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Taskly · Reminder (Upcoming)', `"${shortTitle}" is due in ${leadMinutes} minutes`, approachingTime.toISOString(), 'deadline_approaching');
    }

    // 2. Reached (strictly only future timestamps)
    if (reachedTime.getTime() > (now + 1000)) {
      const notifId = this.getStableId(task.id, 'reached');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Taskly · Deadline',
        body: 'Your task deadline has arrived!',
        largeBody: `Your task deadline has arrived!\n"${taskTitle}" is due now.${taskDesc}`,
        summaryText: 'Deadline',
        schedule: { at: reachedTime, allowWhileIdle: true },
        channelId: activeConfig.channelId,
        sound: activeConfig.sound,
        smallIcon: 'ic_stat_paw',
        largeIcon: 'notif_cat_reached',
        iconColor: '#F88438',
        group: 'taskly_reminders',
        actionTypeId: 'TASK_DEADLINE_ACTIONS',
        extra: { taskId: task.id, type: 'deadline_reached', sourceType: 'task' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Taskly · Deadline', `"${shortTitle}" deadline has arrived`, reachedTime.toISOString(), 'deadline_reached');
    }

    // 3. Overdue (strictly only future timestamps)
    if (overdueTime.getTime() > (now + 1000)) {
      const notifId = this.getStableId(task.id, 'overdue');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Taskly · Overdue',
        body: 'Your task is still in progress. Let\'s finish it!',
        largeBody: `Your task is still in progress. Let's finish it!\n"${taskTitle}" is overdue by 1 hour.${taskDesc}`,
        summaryText: 'Overdue',
        schedule: { at: overdueTime, allowWhileIdle: true },
        channelId: activeConfig.channelId,
        sound: activeConfig.sound,
        smallIcon: 'ic_stat_paw',
        largeIcon: 'notif_cat_overdue',
        iconColor: '#F88438',
        group: 'taskly_reminders',
        actionTypeId: 'TASK_DEADLINE_ACTIONS',
        extra: { taskId: task.id, type: 'task_overdue', sourceType: 'task' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Taskly · Overdue', `"${shortTitle}" is now past its deadline`, overdueTime.toISOString(), 'task_overdue');
    }

    if (plugin && notificationsToSchedule.length > 0) {
      try {
        await plugin.schedule({ notifications: notificationsToSchedule });
      } catch (err) {
        console.warn('[Notifications] Error scheduling task deadlines:', err);
      }
    }
  },

  async scheduleSnoozedTaskReminder(task, snoozeDate) {
    if (!task || !snoozeDate) return;
    const activeConfig = this.getActiveChannelConfig();
    if (!activeConfig.enabled) return;

    const rawTitle = task.title && typeof task.title === 'string' ? task.title.trim() : '';
    const taskTitle = rawTitle || 'Untitled Task';
    const shortTitle = taskTitle.length > 55 ? (taskTitle.substring(0, 52) + '...') : taskTitle;
    const taskDesc = task.description && typeof task.description === 'string' && task.description.trim() ? `\n${task.description.trim()}` : '';

    const notifId = this.getStableId(task.id, 'snoozed');
    const title = 'Taskly · Deadline';
    const body = 'Your task deadline has arrived!';
    const largeBody = `Your task deadline has arrived!\n"${taskTitle}" is due now.${taskDesc}`;

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              largeBody,
              summaryText: 'Deadline',
              schedule: { at: snoozeDate, allowWhileIdle: true },
              channelId: activeConfig.channelId,
              sound: activeConfig.sound,
              smallIcon: 'ic_stat_paw',
              largeIcon: 'notif_cat_reached',
              iconColor: '#F88438',
              group: 'taskly_reminders',
              actionTypeId: 'TASK_DEADLINE_ACTIONS',
              extra: { taskId: task.id, type: 'deadline_reached', sourceType: 'task' }
            }
          ]
        });
      } catch (err) {
        console.warn('[Notifications] Error scheduling snoozed task reminder:', err);
      }
    }

    this.recordScheduled(notifId, 'task', task.id, title, `"${shortTitle}" is due now`, snoozeDate.toISOString(), 'deadline_reached');
  },

  async cancelTaskReminders(taskId) {
    if (!taskId) return;
    const ids = [
      this.getStableId(taskId, 'approaching'),
      this.getStableId(taskId, 'reached'),
      this.getStableId(taskId, 'overdue'),
      this.getStableId(taskId, 'snoozed')
    ];

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.cancel({ notifications: ids.map(id => ({ id })) });
      } catch (_) {}
    }

    this.removeScheduledBySource('task', taskId);
  },

  async scheduleQuickNoteReminder(note, reminderDate) {
    if (!note || !reminderDate) return;
    const activeConfig = this.getActiveChannelConfig();
    if (!activeConfig.enabled) return;

    const atDate = new Date(reminderDate);
    if (isNaN(atDate.getTime()) || atDate.getTime() <= (Date.now() + 1000)) return;

    const rawText = note.text && typeof note.text === 'string' ? note.text.trim() : '';
    const noteText = rawText || 'Quick Note Reminder';
    const shortText = noteText.length > 55 ? (noteText.substring(0, 52) + '...') : noteText;

    const notifId = this.getStableId(note.id, 'quicknote');
    const title = 'Taskly · Quick Note Reminder';
    const body = 'You asked Taskly to remind you about this!';
    const largeBody = `You asked Taskly to remind you about this!\n"${noteText}"`;

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              largeBody,
              summaryText: 'Quick Note Reminder',
              schedule: { at: atDate, allowWhileIdle: true },
              channelId: activeConfig.channelId,
              sound: activeConfig.sound,
              smallIcon: 'ic_stat_paw',
              largeIcon: 'notif_cat_quicknote',
              iconColor: '#F88438',
              group: 'taskly_reminders',
              actionTypeId: 'QUICK_NOTE_ACTIONS',
              extra: { noteId: note.id, type: 'quick_note_reminder', sourceType: 'quick_note' }
            }
          ]
        });
      } catch (err) {
        console.warn('[Notifications] Quick Note reminder schedule warning:', err);
      }
    }

    this.recordScheduled(notifId, 'quick_note', note.id, title, `"${shortText}"`, atDate.toISOString(), 'quick_note_reminder');
  },

  async cancelQuickNoteReminder(noteId) {
    if (!noteId) return;
    const notifId = this.getStableId(noteId, 'quicknote');
    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.cancel({ notifications: [{ id: notifId }] });
      } catch (_) {}
    }
    this.removeScheduledBySource('quick_note', noteId);
  },

  getScheduledRegistry() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.SCHEDULE_REGISTRY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  },

  saveScheduledRegistry(registry) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.SCHEDULE_REGISTRY_KEY, JSON.stringify(registry));
      }
    } catch (_) {}
  },

  recordScheduled(id, sourceType, sourceId, title, body, scheduledAt, type) {
    const reg = this.getScheduledRegistry().filter(r => r.id !== id);
    reg.push({ id, sourceType, sourceId, title, body, scheduledAt, type });
    this.saveScheduledRegistry(reg);
  },

  removeScheduledBySource(sourceType, sourceId) {
    const reg = this.getScheduledRegistry().filter(r => !(r.sourceType === sourceType && String(r.sourceId) === String(sourceId)));
    this.saveScheduledRegistry(reg);
  },

  async reconcileScheduledReminders() {
    // Safety guard: if todos have not yet been loaded on startup, do not wipe the schedule registry
    const activeTasks = state.todos;
    if (!state.todosLoaded && (!activeTasks || activeTasks.length === 0)) {
      return;
    }

    const reg = this.getScheduledRegistry();
    const now = Date.now();
    const currentTasks = activeTasks || [];
    const activeNotes = state.quickNotes || [];

    const surviving = [];
    const idsToCancel = [];

    for (const item of reg) {
      if (item.sourceType === 'task') {
        const task = currentTasks.find(t => String(t.id) === String(item.sourceId));
        if (!task || task.completed || task.reminder === false) {
          idsToCancel.push(item.id);
          continue;
        }
      } else if (item.sourceType === 'quick_note') {
        const note = activeNotes.find(n => String(n.id) === String(item.sourceId));
        if (!note || !note.reminderDate) {
          idsToCancel.push(item.id);
          continue;
        }
      }

      const schedTime = new Date(item.scheduledAt).getTime();
      if (schedTime <= now) {
        // Notification timestamp has passed. It was delivered or expired while app was closed.
        // Record in in-app notification center silently (strictly NO sound!).
        const alreadyInHistory = (state.notifications || []).some(n => 
          String(n.sourceId) === String(item.sourceId) && n.type === item.type
        );
        if (!alreadyInHistory) {
          this.addInAppNotification({
            title: item.title,
            description: item.body,
            type: item.type,
            largeIcon: this.resolveCatIcon(item.type).largeIcon,
            sourceId: item.sourceId,
            sourceType: item.sourceType,
            playSound: false
          });
        }
      } else {
        surviving.push(item);
      }
    }

    if (idsToCancel.length > 0) {
      const plugin = this.getPlugin();
      if (plugin) {
        try {
          await plugin.cancel({ notifications: idsToCancel.map(id => ({ id })) });
        } catch (_) {}
      }
    }

    this.saveScheduledRegistry(surviving);

    for (const task of currentTasks) {
      if (!task.completed && task.dueDate && task.reminder === true) {
        const hasScheduled = surviving.some(r => r.sourceType === 'task' && String(r.sourceId) === String(task.id));
        if (!hasScheduled) {
          await this.scheduleTaskDeadlines(task);
        }
      }
    }

    for (const note of activeNotes) {
      if (note.reminderDate && new Date(note.reminderDate).getTime() > (now + 1000)) {
        const hasScheduled = surviving.some(r => r.sourceType === 'quick_note' && String(r.sourceId) === String(note.id));
        if (!hasScheduled) {
          await this.scheduleQuickNoteReminder(note, note.reminderDate);
        }
      }
    }
  },

  updateBadges() {
    if (typeof document === 'undefined') return;
    const unread = (state.notifications || []).filter(n => !n.read).length;
    state.unreadNotificationsCount = unread;

    const profileDot = document.getElementById('profile-notif-dot');
    const homeDot = document.getElementById('home-notif-dot');
    const homeCount = document.getElementById('home-notif-count');
    const desktopDot = document.getElementById('desktop-notif-dot');
    const modalBadge = document.getElementById('notif-modal-unread-count');

    if (profileDot) profileDot.style.display = unread > 0 ? 'block' : 'none';
    if (homeDot) homeDot.style.display = unread > 0 ? 'block' : 'none';
    if (desktopDot) desktopDot.style.display = unread > 0 ? 'block' : 'none';
    if (homeCount) {
      homeCount.textContent = unread > 99 ? '99+' : String(unread);
      homeCount.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
    if (modalBadge) {
      modalBadge.textContent = unread === 1 ? '1 unread' : `${unread} unread`;
      modalBadge.style.display = unread > 0 ? 'inline-block' : 'none';
    }
  },

  markAsRead(id) {
    const notif = (state.notifications || []).find(n => n.id === id);
    if (notif) {
      notif.read = true;
      this.saveHistory();
      this.renderNotificationList();
    }
  },

  markAllAsRead() {
    (state.notifications || []).forEach(n => { n.read = true; });
    this.saveHistory();
    this.renderNotificationList();
  },

  clearHistory() {
    state.notifications = [];
    this.saveHistory();
    this.renderNotificationList();
  },

  deleteNotification(id) {
    state.notifications = (state.notifications || []).filter(n => n.id !== id);
    this.saveHistory();
    this.renderNotificationList();
  },

  async handleNotificationAction(actionId, notification) {
    const extra = notification?.extra || {};
    const taskId = extra.taskId || extra.sourceId;
    const noteId = extra.noteId || extra.sourceId;

    if (notification?.id === 990001 || extra?.type === 'smart_lists_summary') {
      showMainFlow('smart-lists');
      if (typeof SmartListsManager !== 'undefined') {
        SmartListsManager.openSummaryModal();
      }
      return;
    }

    if (actionId === 'COMPLETE_TASK' && taskId) {
      await handleToggleComplete(taskId);
      this.notifyImmediate({
        title: 'Taskly · Task Completed',
        headline: 'Task completed! 🎉',
        description: 'Great job staying productive!',
        type: 'task_completed',
        largeIcon: 'notif_cat_created',
        sourceId: taskId,
        sourceType: 'task'
      });
      return;
    }

    if (actionId === 'SNOOZE_TASK' && taskId) {
      const task = (state.todos || []).find(t => String(t.id) === String(taskId));
      if (task) {
        await this.cancelTaskReminders(taskId);
        const snoozeDate = new Date(Date.now() + 10 * 60 * 1000); // 10 min
        await this.scheduleSnoozedTaskReminder(task, snoozeDate);
        this.addInAppNotification({
          title: 'Taskly · Reminder Snoozed',
          headline: 'Reminder snoozed for 10 minutes',
          description: `"${task.title}" reminder will sound again in 10 minutes.`,
          type: 'reminder_upcoming',
          largeIcon: 'notif_cat_upcoming',
          sourceId: taskId,
          sourceType: 'task'
        });
      }
      return;
    }

    if (actionId === 'SNOOZE_NOTE' && noteId) {
      const note = (state.quickNotes || []).find(n => String(n.id) === String(noteId));
      if (note) {
        await this.cancelQuickNoteReminder(noteId);
        const snoozeDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        note.reminderDate = snoozeDate.toISOString();
        saveQuickNotesToStorage();
        renderQuickNotes();
        await this.scheduleQuickNoteReminder(note, snoozeDate);
        this.addInAppNotification({
          title: 'Taskly · Quick Note Snoozed',
          headline: 'Note reminder snoozed for 1 hour',
          description: `"${note.text}" will remind you in 1 hour.`,
          type: 'quick_note_reminder',
          largeIcon: 'notif_cat_quicknote',
          sourceId: noteId,
          sourceType: 'quick_note'
        });
      }
      return;
    }

    if (actionId === 'OPEN_NOTE' || (!actionId && noteId)) {
      showMainFlow('home');
      setTimeout(() => {
        const sec = document.getElementById('section-quick-notes');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
      return;
    }

    if (actionId === 'VIEW_TASK' || (!actionId && taskId)) {
      showMainFlow('home');
      setTimeout(() => {
        const el = document.querySelector(`[data-task-id="${taskId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.transition = 'outline 0.3s';
          el.style.outline = '2px solid #F88438';
          setTimeout(() => { el.style.outline = 'none'; }, 2000);
        }
      }, 300);
    }
  },

  handleNotificationTap(action) {
    const actionId = action?.actionId;
    const notification = action?.notification || action;
    if (actionId && actionId !== 'tap') {
      this.handleNotificationAction(actionId, notification);
    } else {
      this.handleNotificationAction(null, notification);
    }
  },

  async handleInAppAction(actionName, sourceId, notifId, sourceType) {
    if (notifId) this.markAsRead(notifId);
    if (actionName === 'Complete' && sourceId) {
      await handleToggleComplete(sourceId);
    } else if (actionName === 'Snooze') {
      if (sourceType === 'quick_note') {
        await this.handleNotificationAction('SNOOZE_NOTE', { extra: { noteId: sourceId } });
      } else {
        await this.handleNotificationAction('SNOOZE_TASK', { extra: { taskId: sourceId } });
      }
    } else if (actionName === 'View Task') {
      this.closeModal();
      showMainFlow('home');
      if (sourceId) {
        setTimeout(() => {
          const el = document.querySelector(`[data-task-id="${sourceId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    } else if (actionName === 'Open Note') {
      this.closeModal();
      showMainFlow('home');
      setTimeout(() => {
        const sec = document.getElementById('section-quick-notes');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  },

  handleNotificationReceived(notification) {
    const extra = notification?.extra || {};
    // Android OS already plays the notification chime on delivery.
    // Record into in-app notification center silently with NO secondary HTML5 audio.
    this.addInAppNotification({
      title: notification.title || 'Taskly Notification',
      description: notification.body || '',
      type: extra.type || 'system',
      largeIcon: notification.largeIcon || extra.largeIcon,
      sourceId: extra.taskId || extra.noteId,
      sourceType: extra.sourceType,
      playSound: false
    });
  },

  renderNotificationList() {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('notifications-list');
    const emptyEl = document.getElementById('notifications-empty');
    if (!listEl) return;

    const notifs = state.notifications || [];
    if (notifs.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    listEl.innerHTML = notifs.map(n => {
      const timeAgo = formatTimeAgo(n.timestamp);
      const isDeadline = n.type === 'deadline_approaching' || n.type === 'deadline_reached' || n.type === 'task_overdue' || n.type === 'reminder_upcoming';
      const isQuickNote = n.type === 'quick_note_reminder' || n.type === 'quick_note_snoozed';
      const hasActions = (isDeadline || isQuickNote) && n.sourceId;
      const catImgSrc = (n.icon && n.icon.startsWith('/')) ? n.icon : (n.largeIcon === 'logo' ? '/logo.png' : (n.largeIcon ? `/assets/pets/${n.largeIcon}.png` : '/logo.png'));

      return `
        <div class="notif-card ${n.read ? 'read' : 'unread'}" data-notif-id="${n.id}" onclick="TasklyNotifications.handleItemClick('${n.id}')">
          <div class="notif-top-bar">
            <div class="notif-header-left">
              <span class="notif-paw-badge">
                <svg viewBox="0 0 24 24" class="notif-paw-svg"><ellipse cx="8.5" cy="5" rx="1.8" ry="2.2" /><ellipse cx="15.5" cy="5" rx="1.8" ry="2.2" /><ellipse cx="5" cy="10" rx="1.7" ry="2.1" /><ellipse cx="19" cy="10" rx="1.7" ry="2.1" /><path d="M 12 9 C 8.5 9 6.5 12 7.2 16 C 7.6 18.2 9.5 20 12 20 C 14.5 20 16.4 18.2 16.8 16 C 17.5 12 15.5 9 12 9 Z" /></svg>
              </span>
              <span class="notif-category-title">${escapeHtml(n.title)}</span>
            </div>
            <div class="notif-header-right">
              <span class="notif-time">${escapeHtml(timeAgo)}</span>
              <button type="button" class="btn-notif-dismiss" onclick="event.stopPropagation(); TasklyNotifications.deleteNotification('${n.id}')" title="Dismiss">×</button>
            </div>
          </div>

          <div class="notif-content-row">
            <div class="notif-text-col">
              <div class="notif-headline">${escapeHtml(n.headline || n.title)}</div>
              <div class="notif-desc">${escapeHtml(n.description)}</div>
            </div>
            <div class="notif-cat-col">
              <img src="${catImgSrc}" alt="" onerror="this.style.display='none'" class="notif-cat-img">
            </div>
          </div>

          ${hasActions ? `
            <div class="notif-actions-bar" onclick="event.stopPropagation()">
              ${isDeadline ? `
                <button type="button" class="btn-notif-orange" onclick="TasklyNotifications.handleInAppAction('Complete', '${n.sourceId}', '${n.id}', 'task')">✓ Complete</button>
                <button type="button" class="btn-notif-cream" onclick="TasklyNotifications.handleInAppAction('Snooze', '${n.sourceId}', '${n.id}', 'task')">⏰ Snooze</button>
                <button type="button" class="btn-notif-cream" onclick="TasklyNotifications.handleInAppAction('View Task', '${n.sourceId}', '${n.id}', 'task')">↗ View Task</button>
              ` : `
                <button type="button" class="btn-notif-orange" onclick="TasklyNotifications.handleInAppAction('Open Note', '${n.sourceId}', '${n.id}', 'quick_note')">📝 Open Note</button>
                <button type="button" class="btn-notif-cream" onclick="TasklyNotifications.handleInAppAction('Snooze', '${n.sourceId}', '${n.id}', 'quick_note')">⏰ Snooze</button>
              `}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  handleItemClick(id) {
    const notif = (state.notifications || []).find(n => n.id === id);
    if (!notif) return;
    this.markAsRead(id);
    this.closeModal();

    if (notif.sourceType === 'task' || notif.type?.includes('task') || notif.type?.includes('deadline')) {
      showMainFlow('home');
      if (notif.sourceId) {
        setTimeout(() => {
          const el = document.querySelector(`[data-task-id="${notif.sourceId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    } else if (notif.sourceType === 'quick_note' || notif.type === 'quick_note_reminder') {
      showMainFlow('home');
      setTimeout(() => {
        const sec = document.getElementById('section-quick-notes');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  },

  openModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-notifications');
    if (modal) {
      this.renderNotificationList();
      modal.classList.add('active');
    }
  },

  closeModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-notifications');
    if (modal) modal.classList.remove('active');
  }
};

// ==========================================================================
// Quick Notes & Quick Share Reminders Management (Part 5)
// ==========================================================================
function saveQuickNote() {
  if (typeof document === 'undefined') return;
  const input = document.getElementById('qc-input-text');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const newNote = {
    id: Date.now(),
    text,
    createdAt: new Date().toISOString(),
    reminderDate: null,
    reminderTimeStr: null
  };

  if (!Array.isArray(state.quickNotes)) state.quickNotes = [];
  state.quickNotes.unshift(newNote);
  input.value = '';
  saveQuickNotesToStorage();
  renderQuickNotes();

  // Prompt the user to set a reminder
  openQuickReminderPromptModal(newNote.id);
}

function saveQuickNotesToStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const data = JSON.stringify(state.quickNotes);
      localStorage.setItem('taskly_quick_notes', data);
      if (state.user && state.user.id) {
        localStorage.setItem(`taskly_quick_notes_${state.user.id}`, data);
      }
    }
  } catch (_) {}
}

function togglePinQuickNote(id) {
  if (!Array.isArray(state.quickNotes)) return;
  const note = state.quickNotes.find(n => n.id === id);
  if (!note) return;

  const willPin = !note.isPinned;
  state.quickNotes.forEach(n => {
    if (n.id === id) {
      n.isPinned = willPin;
    } else if (willPin) {
      n.isPinned = false; // Only 1 featured pinned note at a time
    }
  });

  saveQuickNotesToStorage();
  renderQuickNotes();
}

function renderPinnedQuickShare() {
  if (typeof document === 'undefined') return;
  const pinnedCard = document.getElementById('card-pinned-quick-share');
  if (!pinnedCard) return;

  const pinnedNote = (state.quickNotes || []).find(n => n.isPinned);
  if (!pinnedNote) {
    pinnedCard.style.display = 'none';
    pinnedCard.innerHTML = '';
    return;
  }

  pinnedCard.style.display = 'block';
  const createdStr = pinnedNote.createdAt ? formatTimeAgo(pinnedNote.createdAt) : 'Recently';
  const isScheduled = Boolean(pinnedNote.reminderDate && new Date(pinnedNote.reminderDate).getTime() > Date.now());
  const reminderText = pinnedNote.reminderTimeStr || (isScheduled ? 'Reminder Scheduled' : 'No reminder scheduled');

  pinnedCard.innerHTML = `
    <div class="card-eyebrow-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span class="card-badge badge-yellow">📌 PINNED QUICK SHARE</span>
      <div class="pinned-card-actions" style="display: flex; gap: 8px;">
        <button type="button" class="btn-pinned-action" onclick="togglePinQuickNote(${pinnedNote.id})" title="Unpin note">Unpin ✕</button>
        <button type="button" class="btn-pinned-action" onclick="openEditQuickNoteModal(${pinnedNote.id})" title="Edit note">Edit ✎</button>
      </div>
    </div>
    <div class="card-title-lg" style="font-size: 16px; margin-bottom: 8px; line-height: 1.4;">
      ${escapeHtml(pinnedNote.text)}
    </div>
    <div class="pinned-reminder-banner" style="background: rgba(254, 240, 138, 0.7); border-radius: 10px; padding: 8px 12px; margin: 10px 0; font-size: 12px; font-weight: 700; color: #A16207; display: flex; align-items: center; gap: 6px;">
      <span>⏰</span>
      <span>${escapeHtml(reminderText)}</span>
    </div>
    <div class="pinned-card-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
      <span style="font-size: 11px; color: #A16207; font-weight: 600;">📌 Pinned to top • ${escapeHtml(createdStr)}</span>
      <img src="/assets/pets/home_cat_peek.png" alt="Peeking Cat" class="pinned-cat-mascot" style="width: 50px; height: 50px; object-fit: contain; margin-top: -10px;">
    </div>
  `;
}

function deleteQuickNote(id) {
  if (!Array.isArray(state.quickNotes)) return;
  const noteToDelete = state.quickNotes.find(n => n.id === id);
  TasklyNotifications.cancelQuickNoteReminder(id);
  state.quickNotes = state.quickNotes.filter(n => n.id !== id);
  saveQuickNotesToStorage();
  renderQuickNotes();
  if (noteToDelete) {
    TasklyNotifications.addInAppNotification({
      title: 'Quick Note Removed',
      description: `"${noteToDelete.text}" was dismissed.`,
      type: 'quick_note_deleted',
      icon: '🗑️',
      sourceId: id,
      sourceType: 'quick_note'
    });
  }
}

function renderQuickNotes() {
  if (typeof document === 'undefined') return;
  const listEl = document.getElementById('qc-notes-list');
  const countBadge = document.getElementById('quick-notes-counter-badge');
  if (!listEl) return;

  const notes = state.quickNotes || [];
  if (countBadge) {
    countBadge.textContent = notes.length === 1 ? '1 Note' : `${notes.length} Notes`;
  }

  if (notes.length === 0) {
    listEl.innerHTML = `
      <div class="qn-empty-card">
        <div class="qn-empty-icon">📝</div>
        <div class="qn-empty-title">No quick notes yet</div>
        <div class="qn-empty-sub">Jot down quick thoughts or reminders using Quick Capture above!</div>
      </div>
    `;
    renderPinnedQuickShare();
    return;
  }

  listEl.innerHTML = notes.map(n => {
    const createdStr = n.createdAt ? formatTimeAgo(n.createdAt) : 'Recently';
    const isScheduled = Boolean(n.reminderDate && new Date(n.reminderDate).getTime() > Date.now());
    return `
      <div class="quick-note-card ${n.isPinned ? 'is-pinned-item' : ''}" data-note-id="${n.id}">
        <div class="qn-card-top">
          <span class="qn-date-tag">${escapeHtml(createdStr)}</span>
          <div class="qn-card-actions">
            <button type="button" class="btn-qn-action btn-qn-pin ${n.isPinned ? 'pinned' : ''}" onclick="togglePinQuickNote(${n.id})" title="${n.isPinned ? 'Unpin Note' : 'Pin Note'}">${n.isPinned ? '📌' : '📍'}</button>
            <button type="button" class="btn-qn-action btn-qn-edit" onclick="openEditQuickNoteModal(${n.id})" title="Edit Note">✎</button>
            <button type="button" class="btn-qn-action btn-qn-delete" onclick="deleteQuickNote(${n.id})" title="Delete Note">×</button>
          </div>
        </div>
        <div class="qn-content-text">${escapeHtml(n.text)}</div>
        <div class="qn-card-bottom">
          ${isScheduled ? `
            <div class="qn-reminder-pill scheduled" onclick="openEditQuickNoteModal(${n.id})" title="Edit reminder">
              <span class="qn-pill-icon">⏰</span>
              <span>${escapeHtml(n.reminderTimeStr || 'Reminder Scheduled')}</span>
            </div>
          ` : `
            <div class="qn-reminder-pill empty" onclick="openQuickReminderPicker(${n.id})" title="Set reminder">
              <span class="qn-pill-icon">🔔</span>
              <span>Set Reminder</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  renderPinnedQuickShare();
}

function openQuickReminderPromptModal(noteId) {
  if (typeof document === 'undefined') return;
  const note = (state.quickNotes || []).find(n => n.id === noteId);
  if (!note) return;
  state.pendingReminderNoteId = noteId;

  const previewEl = document.getElementById('prompt-note-preview-text');
  if (previewEl) previewEl.textContent = `"${note.text}"`;

  const modal = document.getElementById('modal-quick-reminder-prompt');
  if (modal) modal.classList.add('active');
}

function closeQuickReminderPromptModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('modal-quick-reminder-prompt');
  if (modal) modal.classList.remove('active');
  state.pendingReminderNoteId = null;
}

function openQuickReminderPicker(noteId) {
  if (typeof document === 'undefined') return;
  const note = (state.quickNotes || []).find(n => n.id === noteId);
  if (!note) return;

  const targetIdInput = document.getElementById('reminder-target-note-id');
  const dateInput = document.getElementById('reminder-picker-date');
  const timeInput = document.getElementById('reminder-picker-time');

  if (targetIdInput) targetIdInput.value = noteId;

  const now = new Date();
  if (dateInput) dateInput.value = toYmdString(now);
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const hh = String(nextHour.getHours()).padStart(2, '0');
  const mm = String(nextHour.getMinutes()).padStart(2, '0');
  if (timeInput) timeInput.value = `${hh}:${mm}`;

  const modal = document.getElementById('modal-quick-reminder-picker');
  if (modal) modal.classList.add('active');
}

function closeQuickReminderPicker() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('modal-quick-reminder-picker');
  if (modal) modal.classList.remove('active');
}

async function handleConfirmQuickReminder(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (typeof document === 'undefined') return;

  const confirmBtn = document.getElementById('btn-confirm-quick-reminder');
  if (confirmBtn) {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
  }

  try {
    const targetIdInput = document.getElementById('reminder-target-note-id');
    const dateInput = document.getElementById('reminder-picker-date');
    const timeInput = document.getElementById('reminder-picker-time');

    const noteId = targetIdInput ? Number(targetIdInput.value) : null;
    const note = (state.quickNotes || []).find(n => n.id === noteId);
    if (!note || !dateInput || !timeInput) return;

    const dateVal = dateInput.value;
    const timeVal = timeInput.value;
    if (!dateVal || !timeVal) {
      alert('Please choose both a date and time.');
      return;
    }

    const [year, month, day] = dateVal.split('-').map(Number);
    const [hours, minutes] = timeVal.split(':').map(Number);
    const targetDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

    if (isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
      alert('Please choose a time in the future.');
      return;
    }

    note.reminderDate = targetDate.toISOString();
    note.reminderTimeStr = formatDateTimeFriendly(targetDate);
    saveQuickNotesToStorage();
    renderQuickNotes();

    await TasklyNotifications.scheduleQuickNoteReminder(note, targetDate);

    TasklyNotifications.addInAppNotification({
      title: 'Taskly – Quick Note Reminder',
      description: `Reminder scheduled for: "${note.text}" at ${note.reminderTimeStr}`,
      type: 'quick_note_reminder',
      icon: '⏰',
      sourceId: note.id,
      sourceType: 'quick_note'
    });

    closeQuickReminderPicker();
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function openEditQuickNoteModal(noteId) {
  if (typeof document === 'undefined') return;
  const note = (state.quickNotes || []).find(n => n.id === noteId);
  if (!note) return;

  const idInput = document.getElementById('edit-quick-note-id');
  const textInput = document.getElementById('edit-quick-note-text');
  const dateInput = document.getElementById('edit-quick-note-date');
  const timeInput = document.getElementById('edit-quick-note-time');
  const btnRemove = document.getElementById('btn-remove-note-reminder');

  if (idInput) idInput.value = note.id;
  if (textInput) textInput.value = note.text;

  if (note.reminderDate) {
    const d = new Date(note.reminderDate);
    if (!isNaN(d.getTime())) {
      if (dateInput) dateInput.value = toYmdString(d);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (timeInput) timeInput.value = `${hh}:${mm}`;
    }
    if (btnRemove) btnRemove.style.display = 'inline';
  } else {
    if (dateInput) dateInput.value = '';
    if (timeInput) timeInput.value = '';
    if (btnRemove) btnRemove.style.display = 'none';
  }

  const modal = document.getElementById('modal-edit-quick-note');
  if (modal) modal.classList.add('active');
}

function closeEditQuickNoteModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('modal-edit-quick-note');
  if (modal) modal.classList.remove('active');
}

async function handleSaveEditQuickNote(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (typeof document === 'undefined') return;

  const idInput = document.getElementById('edit-quick-note-id');
  const textInput = document.getElementById('edit-quick-note-text');
  const dateInput = document.getElementById('edit-quick-note-date');
  const timeInput = document.getElementById('edit-quick-note-time');

  const noteId = idInput ? Number(idInput.value) : null;
  const note = (state.quickNotes || []).find(n => n.id === noteId);
  if (!note || !textInput) return;

  const newText = textInput.value.trim();
  if (!newText) return;
  note.text = newText;

  const dateVal = dateInput ? dateInput.value : '';
  const timeVal = timeInput ? timeInput.value : '';

  if (dateVal && timeVal) {
    const [year, month, day] = dateVal.split('-').map(Number);
    const [hours, minutes] = timeVal.split(':').map(Number);
    const targetDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

    if (!isNaN(targetDate.getTime()) && targetDate.getTime() > Date.now()) {
      note.reminderDate = targetDate.toISOString();
      note.reminderTimeStr = formatDateTimeFriendly(targetDate);
      await TasklyNotifications.cancelQuickNoteReminder(note.id);
      await TasklyNotifications.scheduleQuickNoteReminder(note, targetDate);
    }
  }

  saveQuickNotesToStorage();
  renderQuickNotes();
  closeEditQuickNoteModal();
}

function handleRemoveNoteReminder() {
  if (typeof document === 'undefined') return;
  const idInput = document.getElementById('edit-quick-note-id');
  const noteId = idInput ? Number(idInput.value) : null;
  const note = (state.quickNotes || []).find(n => n.id === noteId);
  if (!note) return;

  TasklyNotifications.cancelQuickNoteReminder(note.id);
  note.reminderDate = null;
  note.reminderTimeStr = null;

  const dateInput = document.getElementById('edit-quick-note-date');
  const timeInput = document.getElementById('edit-quick-note-time');
  const btnRemove = document.getElementById('btn-remove-note-reminder');
  if (dateInput) dateInput.value = '';
  if (timeInput) timeInput.value = '';
  if (btnRemove) btnRemove.style.display = 'none';

  saveQuickNotesToStorage();
  renderQuickNotes();
}

if (typeof globalThis !== 'undefined') {
  globalThis.TasklyNotifications = TasklyNotifications;
  globalThis.parseTaskDeadline = parseTaskDeadline;
  globalThis.formatTimeAgo = formatTimeAgo;
  globalThis.formatDateTimeFriendly = formatDateTimeFriendly;
  globalThis.saveQuickNote = saveQuickNote;
  globalThis.deleteQuickNote = deleteQuickNote;
  globalThis.renderQuickNotes = renderQuickNotes;
  globalThis.openQuickReminderPromptModal = openQuickReminderPromptModal;
  globalThis.closeQuickReminderPromptModal = closeQuickReminderPromptModal;
  globalThis.openQuickReminderPicker = openQuickReminderPicker;
  globalThis.closeQuickReminderPicker = closeQuickReminderPicker;
  globalThis.handleConfirmQuickReminder = handleConfirmQuickReminder;
  globalThis.openEditQuickNoteModal = openEditQuickNoteModal;
  globalThis.closeEditQuickNoteModal = closeEditQuickNoteModal;
  globalThis.handleSaveEditQuickNote = handleSaveEditQuickNote;
}

// Dynamic Calendar Timeline Connection to Cat Mascot
function updateCalendarTimelineRope() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('calendar-timeline-container');
  const svgLine = document.getElementById('timeline-svg-rope-line');
  const catBox = document.querySelector('.timeline-cat-mascot-box');
  if (
    !container ||
    !svgLine ||
    !catBox ||
    typeof container.getBoundingClientRect !== 'function' ||
    typeof catBox.getBoundingClientRect !== 'function' ||
    typeof container.querySelectorAll !== 'function' ||
    typeof container.querySelector !== 'function'
  ) return;

  const containerRect = container.getBoundingClientRect();
  const dots = container.querySelectorAll('.timeline-marker-dot');
  const catRect = catBox.getBoundingClientRect();
  const spineCols = container.querySelectorAll('.timeline-spine-col');
  if (spineCols.length === 0) return;

  const firstSpineRect = spineCols[0].getBoundingClientRect();
  const x = Math.round(firstSpineRect.left - containerRect.left + (firstSpineRect.width / 2));

  let y1 = 0;
  if (dots.length > 0) {
    const firstDotRect = dots[0].getBoundingClientRect();
    y1 = Math.round(firstDotRect.top - containerRect.top + (firstDotRect.height / 2));
  } else {
    const emptyRow = container.querySelector('.timeline-empty-card');
    if (emptyRow) {
      const emptyRect = emptyRow.getBoundingClientRect();
      y1 = Math.round(emptyRect.top - containerRect.top + 20);
    } else {
      y1 = 20;
    }
  }

  // Y2 touches top contour of sleeping cat with zero gap (accounting for transparent PNG padding)
  const y2 = Math.round(catRect.top - containerRect.top + (catRect.height * 0.362));

  svgLine.setAttribute('x1', x);
  svgLine.setAttribute('y1', y1);
  svgLine.setAttribute('x2', x);
  svgLine.setAttribute('y2', Math.max(y1, y2));
  svgLine.style.display = 'block';

  if (typeof window !== 'undefined' && window.ResizeObserver && !container.__observed) {
    container.__observed = true;
    new ResizeObserver(() => updateCalendarTimelineRope()).observe(container);
  }
}

// ==========================================================================
// Screen & Flow Routing
// ==========================================================================
function showOnboardingStep(stepId, pushHistory = true) {
  state.flow = 'onboarding';
  state.currentOnboardingStep = stepId;
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.add('onboarding-active');
  }

  const onboardingFlow = document.getElementById('onboarding-flow');
  const mainFlow = document.getElementById('main-flow');
  if (onboardingFlow) onboardingFlow.classList.add('active');
  if (mainFlow) mainFlow.classList.remove('active');

  // Persist current onboarding step in localStorage
  try {
    localStorage.setItem('taskly_active_flow', 'onboarding');
    localStorage.setItem('taskly_onboarding_step', stepId);
  } catch (_) {}

  // Synchronize URL hash
  if (pushHistory) {
    if (window.location.hash !== `#${stepId}`) {
      try {
        history.pushState(null, '', `#${stepId}`);
      } catch (_) {
        window.location.hash = stepId;
      }
    }
  } else {
    try {
      history.replaceState(null, '', `#${stepId}`);
    } catch (_) {}
  }

  const steps = ['screen-launch', 'screen-carousel', 'screen-profile-setup', 'screen-welcome'];
  steps.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === `screen-${stepId}`);
  });

  if (stepId === 'carousel') {
    updateCarouselSlide(state.carouselIndex);
  } else if (stepId === 'launch') {
    state.carouselIndex = 0;
  }
}

function showMainFlow(tabName = 'home', pushHistory = true) {
  if (!isAuthenticated() && !(isLocalPreview() && state.isPreviewSession)) {
    console.warn(`[Auth Guard]: Attempted to show main flow '${tabName}' while unauthenticated. Redirecting to profile-setup.`);
    try {
      if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
    } catch (_) {
      if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
    }
    showOnboardingStep('profile-setup', false);
    return;
  }

  if (isLocalPreview() && state.isPreviewSession) {
    initPreviewData();
  }

  state.flow = 'main';
  state.activeTab = tabName;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-active-tab', tabName);
    if (document.body) {
      document.body.classList.remove('onboarding-active');
      document.body.setAttribute('data-active-tab', tabName);
    }
    if (state.theme === 'day' || state.theme === 'light') {
      const metaTheme = document.getElementById('meta-theme-color');
      if (metaTheme) {
        const colorMap = {
          home: '#38BDF8',
          calendar: '#FFE1E7',
          progress: '#FFF1B8',
          profile: '#38BDF8',
          add: '#38BDF8',
          'smart-lists': '#38BDF8'
        };
        metaTheme.setAttribute('content', colorMap[tabName] || '#38BDF8');
      }
    } else if (state.theme === 'dark') {
      const metaTheme = document.getElementById('meta-theme-color');
      if (metaTheme) metaTheme.setAttribute('content', '#121820');
    }
  }

  const onboardingFlow = document.getElementById('onboarding-flow');
  const mainFlow = document.getElementById('main-flow');
  if (onboardingFlow) onboardingFlow.classList.remove('active');
  if (mainFlow) mainFlow.classList.add('active');

  // Persist current active tab in localStorage
  try {
    localStorage.setItem('taskly_active_flow', 'main');
    localStorage.setItem('taskly_active_tab', tabName);
  } catch (_) {}

  // Synchronize URL hash
  if (pushHistory) {
    if (window.location.hash !== `#${tabName}`) {
      try {
        history.pushState(null, '', `#${tabName}`);
      } catch (_) {
        window.location.hash = tabName;
      }
    }
  } else {
    try {
      history.replaceState(null, '', `#${tabName}`);
    } catch (_) {}
  }

  // Switch tab views
  const tabs = ['home', 'calendar', 'add', 'progress', 'profile', 'smart-lists'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.toggle('active', t === tabName);
  });

  // Switch bottom navigation active state
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Switch desktop navigation active state
  document.querySelectorAll('.desktop-nav-link').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update views
  renderAll();
  if (tabName === 'smart-lists' && typeof SmartListsManager !== 'undefined') {
    SmartListsManager.renderRoutines();
  }
  if (tabName === 'add') {
    initAddTaskDateTime();
    if (typeof syncCustomCategoriesToDOM === 'function') {
      syncCustomCategoriesToDOM();
    }
  }
  if (tabName === 'calendar') {
    setTimeout(updateCalendarTimelineRope, 20);
    setTimeout(updateCalendarTimelineRope, 220);
  }
}

function updateCarouselSlide(idx) {
  state.carouselIndex = Math.max(0, Math.min(2, idx));

  // Slides
  document.querySelectorAll('.carousel-slide').forEach(slide => {
    slide.classList.toggle('active', parseInt(slide.dataset.slide, 10) === state.carouselIndex);
  });

  // Dots
  document.querySelectorAll('.carousel-dots .dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === state.carouselIndex);
  });

  // Toggle button between FAB (slides 0 & 1) and Wide button (slide 2)
  const btnNext = document.getElementById('btn-next-slide');
  const btnGetStarted = document.getElementById('btn-get-started');
  if (state.carouselIndex === 2) {
    btnNext.classList.add('hidden');
    btnGetStarted.classList.remove('hidden');
  } else {
    btnNext.classList.remove('hidden');
    btnGetStarted.classList.add('hidden');
  }

  // Update Back button visibility and page counter
  const btnBack = document.getElementById('btn-back-to-launch');
  if (btnBack) {
    btnBack.style.visibility = state.carouselIndex === 0 ? 'hidden' : 'visible';
  }
  const counterEl = document.querySelector('.step-nav-counter');
  if (counterEl) {
    counterEl.textContent = `Page ${state.carouselIndex + 1} of 3`;
  }
}

// ==========================================================================
// API Operations (User-Scoped & Authenticated)
// ==========================================================================
async function fetchTodos() {
  if (isLocalPreview() && state.isPreviewSession) {
    initPreviewData();
    renderAll();
    return;
  }
  if (!state.userToken) {
    state.todos = [];
    renderAll();
    return;
  }
  try {
    let rawTodos = null;

    // 1. Direct Supabase query if client is authenticated
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data: dbRows, error: dbError } = await supabaseClient
          .from('todos')
          .select('*')
          .eq('user_id', state.user.id)
          .order('created_at', { ascending: false });

        if (!dbError && Array.isArray(dbRows)) {
          rawTodos = dbRows.map(row => ({
            id: row.id,
            userId: row.user_id,
            user_id: row.user_id,
            title: row.title,
            completed: Boolean(row.completed),
            dueDate: row.due_date || row.dueDate || null,
            time: row.time || null,
            description: row.description || '',
            priority: row.priority || 'Medium',
            category: row.category || 'Personal',
            reminder: Boolean(row.reminder === true),
            createdAt: row.created_at || row.createdAt || new Date().toISOString(),
            updatedAt: row.updated_at || row.updatedAt || null
          }));
        }
      } catch (sbErr) {
        console.warn('[Supabase Direct Fetch]: Fallback to API endpoint due to:', sbErr);
      }
    }

    // 2. Fallback to API endpoint if not retrieved via direct Supabase client
    if (!rawTodos) {
      const res = await fetch(`${getApiBaseUrl()}/api/todos`, {
        headers: {
          'Authorization': `Bearer ${state.userToken}`
        }
      });
      if (res.status === 401) {
        handleAuthExpiry();
        return;
      }
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
        return;
      }
      if (!res.ok) throw new Error('Failed to load tasks');
      rawTodos = await res.json();
    }

    state.todos = Array.isArray(rawTodos) ? rawTodos.map(t => {
      if (t && typeof t === 'object') {
        t.reminder = Boolean(t.reminder === true);
      }
      return t;
    }) : [];
    state.todosLoaded = true;

    // Discover custom categories and synchronize to DOM
    if (typeof getStoredCustomCategories === 'function') {
      getStoredCustomCategories();
    }
    if (typeof syncCustomCategoriesToDOM === 'function') {
      syncCustomCategoriesToDOM();
    }

    renderAll();
    TasklyNotifications.reconcileScheduledReminders();
  } catch (err) {
    console.warn('[Fetch Warning]:', err.message);
    state.todos = state.todos || [];
    state.todosLoaded = true;
    renderAll();
  }
}

async function handleAddTask(e) {
  if (e && e.preventDefault) e.preventDefault();

  const submitBtn = (e && e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null) || (typeof document !== 'undefined' ? document.querySelector('#tab-add button[type="submit"]') : null);
  if (submitBtn) {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
  }

  try {
    if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) {
      if (typeof alert !== 'undefined') {
        alert('Please sign in or create an account to create tasks.');
      } else {
        console.warn('Please sign in or create an account to create tasks.');
      }
      showOnboardingStep('profile-setup');
      return;
    }
    const titleInput = document.getElementById('add-title');
    const descInput = document.getElementById('add-desc');
    const dateInput = document.getElementById('add-due-date');
    const timeInput = document.getElementById('add-time');
    const reminderInput = document.getElementById('add-reminder');

    const title = titleInput.value.trim();
    if (!title) return;

    const activePriorityBtn = document.querySelector('#add-priority-selector .pill-opt.active');
    const priority = activePriorityBtn ? activePriorityBtn.dataset.val : 'Medium';

    const addCatSelect = document.getElementById('add-task-category');
    const activeCategoryBtn = document.querySelector('#add-category-selector .pill-opt.active');
    let category = 'Personal';
    if (activeCategoryBtn && activeCategoryBtn.dataset && activeCategoryBtn.dataset.val && activeCategoryBtn.dataset.val !== 'Custom') {
      category = activeCategoryBtn.dataset.val;
    } else if (addCatSelect && addCatSelect.value && addCatSelect.value !== '__new_custom__' && addCatSelect.value !== 'Custom') {
      category = addCatSelect.value;
    }

    const customInput = document.getElementById('input-new-custom-category');
    if (category === 'Custom' || (addCatSelect && addCatSelect.value === '__new_custom__') || (customInput && customInput.value.trim() && customInput.offsetParent !== null)) {
      if (customInput && customInput.value.trim()) {
        try {
          category = saveCustomCategory(customInput.value.trim());
        } catch (e) {
          category = customInput.value.trim();
        }
      } else {
        category = 'Personal';
      }
    }

    const selectedDate = (dateInput && dateInput.value) ? dateInput.value : toYmdString(new Date());
    const rawTime = (timeInput && timeInput.value) ? timeInput.value.trim() : getRoundedLocalTime();
    const formattedTime = formatTime24To12(rawTime);

    const deadlineCheck = parseTaskDeadline(selectedDate, formattedTime);
    if (!deadlineCheck || isNaN(deadlineCheck.getTime())) {
      alert('Please enter a valid date and time.');
      return;
    }

    const payload = {
      title,
      description: descInput ? descInput.value.trim() : '',
      dueDate: selectedDate,
      time: formattedTime,
      priority,
      category,
      reminder: Boolean(reminderInput ? reminderInput.checked : false)
    };

    if (isLocalPreview() && state.isPreviewSession) {
      const created = Object.assign({ id: 'preview-' + Date.now(), completed: false }, payload);
      state.todos.unshift(created);
      TasklyNotifications.notifyImmediate({
        title: 'Taskly · Task Created',
        headline: 'Your new task is ready! 🎉',
        description: `"${created.title}" has been added.`,
        type: 'task_created',
        largeIcon: 'notif_cat_created',
        sourceId: created.id,
        sourceType: 'task'
      });
      if (created.reminder === true) {
        TasklyNotifications.scheduleTaskDeadlines(created);
      }
      titleInput.value = '';
      if (descInput) descInput.value = '';
      initAddTaskDateTime();
      const targetTab = state.previousTab === 'calendar' ? 'calendar' : 'home';
      state.previousTab = null;
      showMainFlow(targetTab);
      return;
    }

    try {
      let created = null;

      // 1. Direct Supabase insert if client is authenticated
      if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
        try {
          const newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : ('task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9));

          const insertRow = {
            id: newId,
            user_id: state.user.id,
            title: payload.title,
            description: payload.description,
            due_date: payload.dueDate,
            time: payload.time,
            priority: payload.priority,
            category: payload.category,
            reminder: payload.reminder,
            completed: false,
            created_at: new Date().toISOString()
          };

          const { data: dbData, error: dbError } = await supabaseClient
            .from('todos')
            .insert(insertRow)
            .select()
            .single();

          if (!dbError && dbData) {
            created = {
              id: dbData.id,
              userId: dbData.user_id,
              user_id: dbData.user_id,
              title: dbData.title,
              completed: Boolean(dbData.completed),
              dueDate: dbData.due_date || dbData.dueDate || payload.dueDate,
              time: dbData.time || payload.time,
              description: dbData.description || payload.description,
              priority: dbData.priority || payload.priority,
              category: dbData.category || payload.category,
              reminder: Boolean(dbData.reminder === true),
              createdAt: dbData.created_at || new Date().toISOString(),
              updatedAt: dbData.updated_at || null
            };
          }
        } catch (sbErr) {
          console.warn('[Supabase Direct Insert]: Fallback to API endpoint due to:', sbErr);
        }
      }

      // 2. Fallback to API endpoint
      if (!created) {
        const res = await fetch(`${getApiBaseUrl()}/api/todos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.userToken}`
          },
          body: JSON.stringify(payload)
        });

        if (res.status === 401) {
          handleAuthExpiry();
          return;
        }
        if (res.status === 403) {
          const errData = await res.json().catch(() => ({}));
          handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save task.');
        }

        created = await res.json();
        // Guard against stale proxy overwriting custom category with Personal
        if (payload.category && payload.category !== 'Personal' && created && created.category === 'Personal') {
          created.category = payload.category;
        }
      }

      state.todos.unshift(created);

      // Discover custom categories and synchronize DOM
      if (typeof getStoredCustomCategories === 'function') {
        getStoredCustomCategories();
      }
      if (typeof syncCustomCategoriesToDOM === 'function') {
        syncCustomCategoriesToDOM();
      }
      TasklyNotifications.notifyImmediate({
        title: 'Taskly · Task Created',
        headline: 'Your new task is ready! 🎉',
        description: `"${created.title}" has been added.`,
        type: 'task_created',
        largeIcon: 'notif_cat_created',
        sourceId: created.id,
        sourceType: 'task'
      });
      if (created.reminder === true) {
        TasklyNotifications.scheduleTaskDeadlines(created);
      }

      // Reset Form
      titleInput.value = '';
      if (descInput) descInput.value = '';
      initAddTaskDateTime();

      // Route back to calendar or home
      const targetTab = state.previousTab === 'calendar' ? 'calendar' : 'home';
      state.previousTab = null;
      showMainFlow(targetTab);
    } catch (err) {
      console.error('Add task error:', err);
      if (typeof alert !== 'undefined') {
        alert(`Could not create task: ${err.message}`);
      }
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleToggleComplete(id) {
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) return;
  const task = state.todos.find(t => t.id === id);
  if (!task) return;

  const nextStatus = !task.completed;
  task.completed = nextStatus;
  renderAll();

  if (nextStatus) {
    TasklyNotifications.cancelTaskReminders(id);
  } else if (task.reminder === true) {
    TasklyNotifications.scheduleTaskDeadlines(task);
  }

  const triggerCompletionNotification = () => {
    const opSuccessAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    TasklyNotifications.notifyImmediate({
      title: nextStatus ? 'Taskly · Task Completed' : 'Taskly · Task Reopened',
      headline: nextStatus ? 'Task completed! 🎉' : 'Task reopened 📝',
      description: nextStatus ? `"${task.title}" has been completed.` : `"${task.title}" has been reopened.`,
      type: nextStatus ? 'task_completed' : 'task_updated',
      largeIcon: 'notif_cat_created',
      sourceId: task.id,
      sourceType: 'task',
      opSuccessTimestamp: opSuccessAt
    });
  };

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) {
    triggerCompletionNotification();
    return;
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/todos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.userToken}`
      },
      body: JSON.stringify({ completed: nextStatus })
    });
    if (res.status === 401) {
      handleAuthExpiry();
      return;
    }
    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
      return;
    }
    if (res.ok) {
      triggerCompletionNotification();
    }
  } catch (err) {
    console.warn('Update completion warning:', err);
  }
}

async function handleDeleteTask(event, id) {
  if (event && event.stopPropagation) {
    event.stopPropagation();
  }
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) return;
  const taskToDelete = state.todos.find(t => t.id === id);
  const taskTitle = taskToDelete ? taskToDelete.title : 'Task';
  TasklyNotifications.cancelTaskReminders(id);
  state.todos = state.todos.filter(t => t.id !== id);
  renderAll();

  const triggerDeleteNotification = () => {
    const opSuccessAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    TasklyNotifications.notifyImmediate({
      title: 'Taskly · Task Deleted',
      headline: 'Task removed successfully.',
      description: `"${taskTitle}" has been deleted.`,
      type: 'task_deleted',
      largeIcon: 'notif_cat_deleted',
      sourceId: id,
      sourceType: 'task',
      opSuccessTimestamp: opSuccessAt
    });
  };

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) {
    triggerDeleteNotification();
    return;
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/todos/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${state.userToken}`
      }
    });
    if (res.status === 401) {
      handleAuthExpiry();
      return;
    }
    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
      return;
    }
    if (res.ok) {
      triggerDeleteNotification();
    }
  } catch (err) {
    console.warn('Delete task warning:', err);
  }
}

async function updateTask(id, updates) {
  if (!id || !updates) throw new Error('Task ID and updates are required');
  const task = state.todos.find(t => t.id === id);
  if (!task) throw new Error(`Task with ID "${id}" was not found`);

  const triggerUpdateNotification = (updatedTask) => {
    const opSuccessAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    TasklyNotifications.notifyImmediate({
      title: 'Taskly · Task Updated',
      headline: 'Your task details have been updated.',
      description: `"${updatedTask.title}" details have been updated.`,
      type: 'task_updated',
      largeIcon: 'notif_cat_updated',
      sourceId: updatedTask.id,
      sourceType: 'task',
      opSuccessTimestamp: opSuccessAt
    });
  };

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) {
    Object.assign(task, updates);
    TasklyNotifications.cancelTaskReminders(task.id);
    if (!task.completed && task.reminder === true) {
      TasklyNotifications.scheduleTaskDeadlines(task);
    }
    renderHome();
    renderCalendar();
    renderAnalytics();
    triggerUpdateNotification(task);
    return task;
  }

  // Network call with 10-second timeout to prevent hung saves
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;

  try {
    let updated = null;

    // 1. Direct Supabase update if client is authenticated
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const dbFields = {
          updated_at: new Date().toISOString()
        };
        if (updates.title !== undefined) dbFields.title = updates.title;
        if (updates.description !== undefined) dbFields.description = updates.description;
        if (updates.dueDate !== undefined) dbFields.due_date = updates.dueDate;
        if (updates.time !== undefined) dbFields.time = updates.time;
        if (updates.priority !== undefined) dbFields.priority = updates.priority;
        if (updates.category !== undefined) dbFields.category = updates.category;
        if (updates.completed !== undefined) dbFields.completed = Boolean(updates.completed);
        if (updates.reminder !== undefined) dbFields.reminder = Boolean(updates.reminder);

        const { data: dbData, error: dbError } = await supabaseClient
          .from('todos')
          .update(dbFields)
          .eq('id', id)
          .eq('user_id', state.user.id)
          .select()
          .single();

        if (!dbError && dbData) {
          updated = {
            id: dbData.id,
            userId: dbData.user_id,
            user_id: dbData.user_id,
            title: dbData.title,
            completed: Boolean(dbData.completed),
            dueDate: dbData.due_date || dbData.dueDate || updates.dueDate,
            time: dbData.time || updates.time,
            description: dbData.description || updates.description,
            priority: dbData.priority || updates.priority,
            category: dbData.category || updates.category,
            reminder: Boolean(dbData.reminder === true),
            createdAt: dbData.created_at,
            updatedAt: dbData.updated_at
          };
        }
      } catch (sbErr) {
        console.warn('[Supabase Direct Update]: Fallback to API endpoint due to:', sbErr);
      }
    }

    // 2. Fallback to API endpoint
    if (!updated) {
      const fetchOptions = {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.userToken}`
        },
        body: JSON.stringify(updates)
      };
      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/todos/${id}`, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);

      if (res.status === 401) {
        handleAuthExpiry();
        throw new Error('Your session has expired. Please sign in again.');
      }
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
        throw new Error(errData.error || 'Please verify your email address to access Taskly.');
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned error (${res.status}) while saving task`);
      }

      updated = await res.json();
      if (updated && updated.id && updated.id !== id) {
        throw new Error('Database response ID mismatch: confirmed update does not match targeted task');
      }
      // Guard against stale proxy overwriting custom category with Personal
      if (updates.category && updates.category !== 'Personal' && updated && updated.category === 'Personal') {
        updated.category = updates.category;
      }
    }

    if (timeoutId) clearTimeout(timeoutId);

    // Apply confirmed updates to local state
    Object.assign(task, updated || updates);

    // Discover custom categories and synchronize DOM
    if (typeof getStoredCustomCategories === 'function') {
      getStoredCustomCategories();
    }
    if (typeof syncCustomCategoriesToDOM === 'function') {
      syncCustomCategoriesToDOM();
    }

    TasklyNotifications.cancelTaskReminders(task.id);
    if (!task.completed && task.reminder === true) {
      TasklyNotifications.scheduleTaskDeadlines(task);
    }

    // Targeted DOM updates (Home task card, calendar, analytics) without full page reload
    renderHome();
    renderCalendar();
    renderAnalytics();
    triggerUpdateNotification(task);
    return task;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Save request timed out. Please check your network connection and retry.');
    }
    throw err;
  }
}

function handleOpenEditTaskModal(event, id) {
  if (event && event.stopPropagation) event.stopPropagation();
  const task = state.todos.find(t => t.id === id);
  if (!task) return;

  const modal = document.getElementById('modal-edit-task');
  const idInput = document.getElementById('edit-task-id');
  const titleInput = document.getElementById('edit-task-title');
  const descInput = document.getElementById('edit-task-desc');
  const dateInput = document.getElementById('edit-task-date');
  const priorityInput = document.getElementById('edit-task-priority');
  const catInput = document.getElementById('edit-task-category');

  if (idInput) idInput.value = task.id;
  if (titleInput) titleInput.value = task.title || '';
  if (descInput) descInput.value = task.description || '';
  if (dateInput) dateInput.value = task.dueDate || '';
  if (priorityInput) priorityInput.value = task.priority || 'Medium';
  const currentCategory = task.category || 'Personal';
  syncCustomCategoriesToDOM(currentCategory);
  if (catInput) {
    let found = false;
    if (catInput.options) {
      for (let i = 0; i < catInput.options.length; i++) {
        if (catInput.options[i] && catInput.options[i].value.toLowerCase() === currentCategory.toLowerCase()) {
          catInput.selectedIndex = i;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      try {
        const opt = new Option(`${currentCategory} (Custom)`, currentCategory, true, true);
        catInput.add(opt);
      } catch (_) {}
    }
    catInput.value = currentCategory;
  }

  const reminderInput = document.getElementById('edit-task-reminder');
  if (reminderInput) {
    // Safe default of OFF (false) if task doesn't have reminder field
    reminderInput.checked = Boolean(task.reminder === true);
  }

  const timeInput = document.getElementById('edit-task-time');
  const timeDisplay = document.getElementById('edit-task-time-display');
  if (timeInput) {
    const time24 = task.time ? formatTimeTo24Hour(task.time) : getRoundedLocalTime();
    timeInput.value = time24;
    if (timeDisplay) {
      timeDisplay.textContent = formatTime24To12(time24);
    }
  }

  const errBanner = document.getElementById('edit-task-error-banner');
  if (errBanner) errBanner.style.display = 'none';
  const saveBtn = document.getElementById('btn-save-edit-task') || (modal && modal.querySelector('button[type="submit"]'));
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }

  if (modal) modal.classList.add('active');
}

function closeEditTaskModal() {
  const modal = document.getElementById('modal-edit-task');
  if (modal) modal.classList.remove('active');
  const errBanner = document.getElementById('edit-task-error-banner');
  if (errBanner) errBanner.style.display = 'none';
  const saveBtn = document.getElementById('btn-save-edit-task') || (modal && modal.querySelector('button[type="submit"]'));
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

async function handleClearCompleted() {
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) return;
  const hasCompleted = state.todos.some(t => t.completed);
  if (!hasCompleted) return;

  state.todos = state.todos.filter(t => !t.completed);
  renderAll();

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) return;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/todos`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${state.userToken}`
      }
    });
    if (res.status === 401) {
      handleAuthExpiry();
      return;
    }
    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
      return;
    }
  } catch (err) {
    console.warn('Clear completed warning:', err);
  }
}

// ==========================================================================
// Rendering Engine
// ==========================================================================
function renderAll() {
  if (typeof document === 'undefined') return;
  updatePreviewUI();
  renderHome();
  renderQuickNotes();
  renderCalendar();
  renderAnalytics();
  renderProfile();
}

// 1. Home Dashboard Render
function renderHome() {
  // Personalized Greeting
  const greetingEl = document.getElementById('greeting-title');
  if (greetingEl) {
    greetingEl.textContent = `Hello, ${state.user.name || 'User'} 👋`;
  }

  // Counts
  const total = state.todos.length;
  const completed = state.todos.filter(t => t.completed).length;
  const pending = total - completed;
  const todayStr = toYmdString(new Date());
  const todayCount = state.todos.filter(t => t.dueDate === todayStr).length;

  const totalEl = document.getElementById('stat-total-count');
  const compEl = document.getElementById('stat-completed-count');
  const pendEl = document.getElementById('stat-pending-count');
  const rateEl = document.getElementById('stat-efficiency-count');
  if (totalEl) totalEl.textContent = total;
  if (compEl) compEl.textContent = completed;
  if (pendEl) pendEl.textContent = pending;
  if (rateEl) rateEl.textContent = total > 0 ? `${Math.round((completed / total) * 100)}%` : '0%';

  // Filter Pills Counts
  const pillAll = document.getElementById('pill-count-all');
  const pillToday = document.getElementById('pill-count-today');
  const pillPending = document.getElementById('pill-count-pending');
  const pillCompleted = document.getElementById('pill-count-completed');
  if (pillAll) pillAll.textContent = total;
  if (pillToday) pillToday.textContent = todayCount;
  if (pillPending) pillPending.textContent = pending;
  if (pillCompleted) pillCompleted.textContent = completed;

  // Update Active Filter Pill UI
  const currentFilter = state.dashboardFilter || 'all';
  document.querySelectorAll('#home-filter-pills .filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentFilter);
  });

  // Filter Tasks to Display
  let displayTasks = [];
  if (currentFilter === 'today') {
    displayTasks = state.todos.filter(t => t.dueDate === todayStr);
  } else if (currentFilter === 'pending') {
    displayTasks = state.todos.filter(t => !t.completed);
  } else if (currentFilter === 'completed') {
    displayTasks = state.todos.filter(t => t.completed);
  } else {
    // 'all'
    displayTasks = state.todos;
  }

  // Update tasks counter badge & heading
  const activeBadge = document.getElementById('tasks-active-badge');
  if (activeBadge) {
    activeBadge.textContent = `${displayTasks.length} ${displayTasks.length === 1 ? 'Task' : 'Tasks'}`;
  }

  const container = document.getElementById('home-today-task-list');
  if (container) {
    if (displayTasks.length === 0) {
      container.innerHTML = `<div class="empty-state">No tasks in this view. Tap <strong>+</strong> or switch filters!</div>`;
    } else {
      container.innerHTML = displayTasks.map(t => renderTaskItemHtml(t)).join('');
    }
  }

  // Progress Card Ring
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const ringFill = document.getElementById('home-progress-ring-fill');
  const percentText = document.getElementById('home-progress-percent');
  const countText = document.getElementById('home-progress-task-count');

  if (ringFill) {
    // Circumference of r=40 is ~251.2
    const offset = 251.2 - (251.2 * percent / 100);
    ringFill.style.strokeDashoffset = offset;
  }
  if (percentText) percentText.textContent = `${percent}%`;
  if (countText) countText.textContent = `${completed} of ${total} tasks completed`;

  // Render Pinned Quick Share card if present
  renderPinnedQuickShare();
}

// Task Item HTML Template (with Checkbox, Description, Category, Priority & Delete Button)
function renderTaskItemHtml(t) {
  const isChecked = t.completed;
  const priorityClass = t.completed ? 'badge-done' : (
    t.priority === 'High' ? 'badge-high' :
    t.priority === 'Low' ? 'badge-low' : 'badge-medium'
  );
  const badgeLabel = t.completed ? 'Done' : (t.priority || 'Medium');
  const dueLabel = formatDateFriendly(t.dueDate);
  const timeLabel = t.time ? ` • ${t.time}` : '';
  const descHtml = t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : '';

  const cat = t.category || 'Work';
  let catClass = 'cat-badge cat-general';
  let catIcon = '📌';
  const catLower = (cat || '').toLowerCase();
  if (catLower.includes('work')) { catClass = 'cat-badge cat-work'; catIcon = '💼'; }
  else if (catLower.includes('study')) { catClass = 'cat-badge cat-study'; catIcon = '📚'; }
  else if (catLower.includes('project')) { catClass = 'cat-badge cat-project'; catIcon = '🚀'; }
  else if (catLower.includes('personal')) { catClass = 'cat-badge cat-personal'; catIcon = '🌟'; }
  else { catClass = 'cat-badge cat-custom cat-badge-custom'; catIcon = '✨'; }
  const catConfig = getTaskCategoryConfig(cat);
  const catStyle = catConfig.key === 'custom' ? `style="background-color: ${catConfig.hex} !important; color: ${catConfig.badgeText} !important; border: 1px solid #EAB308 !important;"` : '';
  const catBadgeHtml = `<span class="${catClass}" ${catStyle}>${catIcon} ${escapeHtml(cat)}</span>`;

  // Dynamic Harmonious Pastel Theme Assignment
  let pastelClass = 'card-task-warmcream';
  if (isChecked) {
    pastelClass = 'card-task-buttercup';
  } else if (t.priority === 'High') {
    pastelClass = 'card-task-pink';
  } else if (catLower.includes('project')) {
    pastelClass = 'card-task-lavender';
  } else if (catLower.includes('study')) {
    pastelClass = 'card-task-periwinkle';
  } else {
    pastelClass = 'card-task-warmcream';
  }

  return `
    <div class="task-item ${pastelClass} ${isChecked ? 'completed' : ''}" data-id="${t.id}">
      <div class="task-item-left">
        <button type="button" class="custom-checkbox ${isChecked ? 'checked' : ''}" onclick="handleToggleComplete('${t.id}')" aria-label="Toggle task completed">
          ${isChecked ? '✓' : ''}
        </button>
        <div class="task-info">
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${descHtml}
          <div class="task-subtext">${catBadgeHtml}<span>${dueLabel}${timeLabel}</span></div>
        </div>
      </div>
      <div class="task-item-right">
        <span class="badge-pill ${priorityClass}">${badgeLabel}</span>
        <button type="button" class="btn-task-edit" onclick="handleOpenEditTaskModal(event, '${t.id}')" title="Edit Task" aria-label="Edit Task">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
        <button type="button" class="btn-task-delete" onclick="handleDeleteTask(event, '${t.id}')" title="Delete Task" aria-label="Delete Task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// 2. Calendar Dynamic Timeline & Strip Helpers
function parseTimeSortKey(timeStr) {
  if (!timeStr) return 1440; // End of day for unscheduled items
  const match = String(timeStr).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return 1440;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3] ? match[3].toLowerCase() : null;
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function getTimelineCategoryIcon(task) {
  const text = `${task.title} ${task.category || ''} ${task.description || ''}`.toLowerCase();
  if (text.includes('wake') || text.includes('morning') || text.includes('routine') || text.includes('alarm')) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3L2 6M22 6l-3-3"/></svg>`;
  }
  if (text.includes('study') || text.includes('algorithm') || text.includes('learn') || text.includes('book') || text.includes('read') || text.includes('course')) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
  }
  if (text.includes('project') || text.includes('dev') || text.includes('code') || text.includes('work') || text.includes('ui') || text.includes('api')) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
  }
  if (text.includes('lunch') || text.includes('dinner') || text.includes('breakfast') || text.includes('food') || text.includes('meal') || text.includes('eat')) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2M15 11v11M4 2v20M4 7h4"/></svg>`;
  }
  if (text.includes('gym') || text.includes('workout') || text.includes('fitness') || text.includes('health') || text.includes('exercise') || text.includes('walk')) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 5h12M6 19h12M9 5v14M15 5v14"/></svg>`;
  }
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}

// ==========================================================================
// Task Category Color System (Independent of Date-Cell Workload)
// Project: Pink #E83E9D | Work: Green #83DF64 | Study: Cyan #83DDE8 | Personal: Grey #EEEEEE | Custom: Yellow #FACC15
// ==========================================================================
const TaskCategoryColors = {
  Project:  { key: 'project',  name: 'Project',  hex: '#E83E9D', bg: '#FFF0F7', border: '#FBCFE8', text: '#9D174D', badgeText: '#FFFFFF', icon: '🚀' },
  Work:     { key: 'work',     name: 'Work',     hex: '#83DF64', bg: '#F2FDF0', border: '#BBF7D0', text: '#15803D', badgeText: '#153E0C', icon: '💼' },
  Study:    { key: 'study',    name: 'Study',    hex: '#83DDE8', bg: '#F0FBFC', border: '#BAE6FD', text: '#0369A1', badgeText: '#0A3B43', icon: '📚' },
  Personal: { key: 'personal', name: 'Personal', hex: '#EEEEEE', bg: '#F8F9FA', border: '#E5E7EB', text: '#4B5563', badgeText: '#2B180E', icon: '🌟' },
  Custom:   { key: 'custom',   name: 'Custom',   hex: '#FACC15', bg: '#FEFCE8', border: '#FEF08A', text: '#854D0E', badgeText: '#422006', icon: '✨' }
};

function getCustomCategoriesStorageKey() {
  const userId = (state.user && state.user.id) || (state.userProfile && state.userProfile.email) || 'guest';
  return `taskly_custom_categories_${userId}`;
}

function getStoredCustomCategories() {
  const standard = ['project', 'work', 'study', 'personal'];
  const categoriesMap = new Map();

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getCustomCategoriesStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(c => {
            if (typeof c === 'string' && c.trim().length > 0) {
              const trimmed = c.trim();
              if (!standard.includes(trimmed.toLowerCase())) {
                categoriesMap.set(trimmed.toLowerCase(), trimmed);
              }
            }
          });
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read custom categories from storage:', err);
  }

  // Also discover any custom categories from state.todos
  try {
    if (typeof state !== 'undefined' && Array.isArray(state.todos)) {
      state.todos.forEach(t => {
        if (t && t.category && typeof t.category === 'string') {
          const trimmed = t.category.trim();
          if (trimmed && !standard.includes(trimmed.toLowerCase()) && !categoriesMap.has(trimmed.toLowerCase())) {
            categoriesMap.set(trimmed.toLowerCase(), trimmed);
          }
        }
      });
    }
  } catch (_) {}

  // Also discover from user metadata if authenticated
  try {
    const metaCats = state.user?.user_metadata?.custom_categories || state.userProfile?.custom_categories;
    if (Array.isArray(metaCats)) {
      metaCats.forEach(c => {
        if (typeof c === 'string' && c.trim()) {
          const trimmed = c.trim();
          if (!standard.includes(trimmed.toLowerCase()) && !categoriesMap.has(trimmed.toLowerCase())) {
            categoriesMap.set(trimmed.toLowerCase(), trimmed);
          }
        }
      });
    }
  } catch (_) {}

  const allDiscovered = Array.from(categoriesMap.values());
  try {
    if (typeof localStorage !== 'undefined' && allDiscovered.length > 0) {
      localStorage.setItem(getCustomCategoriesStorageKey(), JSON.stringify(allDiscovered));
    }
  } catch (_) {}

  return allDiscovered;
}

function saveCustomCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw new Error('Category name cannot be empty.');
  }

  const standard = ['project', 'work', 'study', 'personal'];
  if (standard.includes(trimmed.toLowerCase())) {
    throw new Error(`"${trimmed}" is already a built-in category.`);
  }

  const existing = getStoredCustomCategories();
  const duplicate = existing.some(c => c.toLowerCase() === trimmed.toLowerCase());
  if (duplicate) {
    throw new Error(`Category "${trimmed}" already exists.`);
  }

  existing.push(trimmed);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getCustomCategoriesStorageKey(), JSON.stringify(existing));
    }
  } catch (err) {
    console.warn('Failed to store custom category:', err);
  }

  // Also sync to Supabase user_metadata if client is authenticated
  try {
    if (supabaseClient && typeof supabaseClient.auth?.updateUser === 'function' && state.userToken) {
      (async () => {
        try {
          await supabaseClient.auth.updateUser({
            data: { custom_categories: existing }
          });
        } catch (err) {
          console.warn('Supabase custom_categories metadata sync notice:', err?.message);
        }
      })();
    }
  } catch (_) {}

  if (typeof document !== 'undefined') {
    syncCustomCategoriesToDOM(trimmed);
  }

  return trimmed;
}

function syncCustomCategoriesToDOM(activeToSelect = null) {
  if (typeof document === 'undefined') return;

  try {
    const categories = getStoredCustomCategories();

    // 1. Add Task form Category Selector (pills)
    const addSelector = document.getElementById('add-category-selector');
    if (addSelector && typeof addSelector.querySelector === 'function') {
      const activeBtn = addSelector.querySelector('.pill-opt.active');
      const currentActive = activeToSelect || (activeBtn && activeBtn.dataset ? activeBtn.dataset.val : 'Project');

      let pillsHtml = `
        <button type="button" class="pill-opt opt-cat ${currentActive === 'Project' ? 'active' : ''}" data-val="Project">Project</button>
        <button type="button" class="pill-opt opt-cat ${currentActive === 'Work' ? 'active' : ''}" data-val="Work">Work</button>
        <button type="button" class="pill-opt opt-cat ${currentActive === 'Study' ? 'active' : ''}" data-val="Study">Study</button>
        <button type="button" class="pill-opt opt-cat ${currentActive === 'Personal' ? 'active' : ''}" data-val="Personal">Personal</button>
      `;

      categories.forEach(catName => {
        const isAct = currentActive && currentActive.toLowerCase() === catName.toLowerCase();
        pillsHtml += `
          <div class="custom-cat-pill-wrapper" style="position: relative; display: inline-flex; align-items: center; width: 100%;">
            <button type="button" class="pill-opt opt-cat opt-cat-custom ${isAct ? 'active' : ''}" data-val="${escapeHtml(catName)}" style="background-color: ${isAct ? '#FACC15' : 'transparent'} !important; color: ${isAct ? '#422006' : 'inherit'} !important; border: 1.5px solid #FACC15 !important; padding-right: 28px !important; text-align: left; width: 100%;">
              ${escapeHtml(catName)}
            </button>
            <button type="button" class="btn-delete-custom-cat" data-cat="${escapeHtml(catName)}" title="Delete category ${escapeHtml(catName)}" aria-label="Delete category ${escapeHtml(catName)}" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(66, 32, 6, 0.14); color: #422006; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 3;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        `;
      });

      pillsHtml += `<button type="button" class="pill-opt opt-cat opt-custom-trigger" id="btn-custom-category-trigger" data-val="Custom" style="border: 1.5px dashed #FACC15 !important; color: #854D0E !important;">+ Custom</button>`;
      addSelector.innerHTML = pillsHtml;

      if (typeof addSelector.querySelectorAll === 'function') {
        addSelector.querySelectorAll('.pill-opt').forEach(btn => {
          btn.addEventListener('click', () => {
            if (btn.id === 'btn-custom-category-trigger') {
              const inputRow = document.getElementById('add-custom-category-input-row');
              if (inputRow) {
                inputRow.style.display = inputRow.style.display === 'none' ? 'flex' : 'none';
                const inputField = document.getElementById('input-new-custom-category');
                if (inputField && inputRow.style.display !== 'none') inputField.focus();
              }
              return;
            }

            addSelector.querySelectorAll('.pill-opt').forEach(b => {
              b.classList.remove('active');
              if (b.classList.contains('opt-cat-custom')) {
                b.style.backgroundColor = 'transparent';
                b.style.color = 'inherit';
              }
            });
            btn.classList.add('active');
            if (btn.classList.contains('opt-cat-custom')) {
              btn.style.backgroundColor = '#FACC15';
              btn.style.color = '#422006';
            }

            // Sync with #add-task-category select dropdown if present
            const addCatSel = document.getElementById('add-task-category');
            if (addCatSel && btn.dataset && btn.dataset.val) {
              const targetVal = btn.dataset.val;
              let found = false;
              if (addCatSel.options) {
                for (let i = 0; i < addCatSel.options.length; i++) {
                  if (addCatSel.options[i] && addCatSel.options[i].value.toLowerCase() === targetVal.toLowerCase()) {
                    addCatSel.selectedIndex = i;
                    found = true;
                    break;
                  }
                }
              }
              if (!found && !['project', 'work', 'study', 'personal'].includes(targetVal.toLowerCase())) {
                try {
                  const opt = new Option(`${targetVal} (Custom)`, targetVal, true, true);
                  addCatSel.add(opt, addCatSel.options[4] || null);
                } catch (_) {}
              }
              addCatSel.value = targetVal;
            }
          });
        });

        // Delete button listener on custom category pills
        addSelector.querySelectorAll('.btn-delete-custom-cat').forEach(delBtn => {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const catToDelete = delBtn.dataset.cat;
            openDeleteCategoryModal(catToDelete);
          });
        });
      }
    }

    // 1b. Add Task form Category Select Dropdown
    const addCatSelect = document.getElementById('add-task-category');
    if (addCatSelect) {
      const currentAddVal = activeToSelect || addCatSelect.value || 'Project';
      let addOptionsHtml = `
        <option value="Project">Project</option>
        <option value="Work">Work</option>
        <option value="Study">Study</option>
        <option value="Personal">Personal</option>
      `;

      if (categories.length > 0) {
        addOptionsHtml += `<optgroup label="Custom Categories">`;
        categories.forEach(catName => {
          addOptionsHtml += `<option value="${escapeHtml(catName)}">${escapeHtml(catName)} (Custom)</option>`;
        });
        addOptionsHtml += `</optgroup>`;
      }
      addOptionsHtml += `<option value="__new_custom__">+ New Custom Category...</option>`;

      addCatSelect.innerHTML = addOptionsHtml;
      try {
        if (addCatSelect.options && typeof addCatSelect.options.length === 'number') {
          let found = false;
          for (let i = 0; i < addCatSelect.options.length; i++) {
            if (addCatSelect.options[i] && addCatSelect.options[i].value.toLowerCase() === (currentAddVal || '').toLowerCase()) {
              addCatSelect.selectedIndex = i;
              found = true;
              break;
            }
          }
          if (!found && currentAddVal && !['project', 'work', 'study', 'personal'].includes(currentAddVal.toLowerCase())) {
            const customOpt = new Option(`${currentAddVal} (Custom)`, currentAddVal, true, true);
            addCatSelect.add(customOpt, addCatSelect.options[4] || null);
            addCatSelect.value = currentAddVal;
          }
        }
      } catch (_) {
        addCatSelect.value = currentAddVal;
      }
    }

    // 2. Edit Task Category Select Dropdown
    const editCatSelect = document.getElementById('edit-task-category');
    if (editCatSelect) {
      const currentVal = activeToSelect || editCatSelect.value || 'Personal';
      let optionsHtml = `
        <option value="Project">Project</option>
        <option value="Work">Work</option>
        <option value="Study">Study</option>
        <option value="Personal">Personal</option>
      `;

      if (categories.length > 0) {
        optionsHtml += `<optgroup label="Custom Categories">`;
        categories.forEach(catName => {
          optionsHtml += `<option value="${escapeHtml(catName)}">${escapeHtml(catName)} (Custom)</option>`;
        });
        optionsHtml += `</optgroup>`;
      }
      optionsHtml += `<option value="__new_custom__">+ New Custom Category...</option>`;

      editCatSelect.innerHTML = optionsHtml;
      try {
        if (editCatSelect.options && typeof editCatSelect.options.length === 'number') {
          let found = false;
          for (let i = 0; i < editCatSelect.options.length; i++) {
            if (editCatSelect.options[i] && editCatSelect.options[i].value.toLowerCase() === (currentVal || '').toLowerCase()) {
              editCatSelect.selectedIndex = i;
              found = true;
              break;
            }
          }
          if (found) {
            // value already set via selectedIndex
          } else if (currentVal && typeof Option !== 'undefined' && typeof editCatSelect.add === 'function') {
            const customOpt = new Option(`${currentVal} (Custom)`, currentVal, true, true);
            editCatSelect.add(customOpt, editCatSelect.options[4] || null);
            editCatSelect.value = currentVal;
          } else {
            editCatSelect.value = currentVal;
          }
        } else {
          editCatSelect.value = currentVal;
        }
      } catch (_) {
        editCatSelect.value = currentVal;
      }
    }

    // 3. Edit Task Custom Categories Manage Row
    const editManageRow = document.getElementById('edit-custom-categories-manage-row');
    if (editManageRow) {
      if (categories.length > 0) {
        editManageRow.style.display = 'flex';
        let tagsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted); width: 100%; margin-bottom: 2px;">Custom categories (tap × to delete):</span>`;
        categories.forEach(catName => {
          tagsHtml += `
            <span class="custom-cat-manage-chip" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: #FEFCE8; border: 1px solid #FEF08A; color: #854D0E; font-size: 0.8125rem; font-weight: 500;">
              <span>${escapeHtml(catName)}</span>
              <button type="button" class="btn-delete-custom-cat" data-cat="${escapeHtml(catName)}" title="Delete category ${escapeHtml(catName)}" aria-label="Delete category ${escapeHtml(catName)}" style="width: 16px; height: 16px; border-radius: 50%; border: none; background: rgba(66, 32, 6, 0.15); color: #422006; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </span>
          `;
        });
        editManageRow.innerHTML = tagsHtml;
        if (typeof editManageRow.querySelectorAll === 'function') {
          editManageRow.querySelectorAll('.btn-delete-custom-cat').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              openDeleteCategoryModal(btn.dataset.cat);
            });
          });
        }
      } else {
        editManageRow.style.display = 'none';
        editManageRow.innerHTML = '';
      }
    }
  } catch (err) {
    console.warn('syncCustomCategoriesToDOM warning:', err);
  }
}

let pendingCategoryToDelete = null;

function deleteCustomCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw new Error('Category name cannot be empty.');
  }

  const standard = ['project', 'work', 'study', 'personal'];
  if (standard.includes(trimmed.toLowerCase())) {
    throw new Error(`Built-in category "${trimmed}" cannot be deleted.`);
  }

  const existing = getStoredCustomCategories();
  const updated = existing.filter(c => c.toLowerCase() !== trimmed.toLowerCase());
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getCustomCategoriesStorageKey(), JSON.stringify(updated));
    }
  } catch (err) {
    console.warn('Failed to delete custom category from storage:', err);
  }

  // Also sync to Supabase user_metadata if client is authenticated
  try {
    if (supabaseClient && typeof supabaseClient.auth?.updateUser === 'function' && state.userToken) {
      (async () => {
        try {
          await supabaseClient.auth.updateUser({
            data: { custom_categories: updated }
          });
        } catch (err) {
          console.warn('Supabase custom_categories metadata sync notice:', err?.message);
        }
      })();
    }
  } catch (_) {}

  // Reassign any tasks currently having this category to 'Personal'
  if (Array.isArray(state.todos)) {
    let remapped = false;
    state.todos.forEach(t => {
      if (t && t.category && t.category.trim().toLowerCase() === trimmed.toLowerCase()) {
        t.category = 'Personal';
        remapped = true;
      }
    });
    if (remapped) {
      if (typeof saveTodosLocally === 'function') {
        saveTodosLocally();
      }
      if (supabaseClient && typeof supabaseClient.from === 'function' && state.user && state.user.id) {
        try {
          supabaseClient.from('todos')
            .update({ category: 'Personal' })
            .eq('user_id', state.user.id)
            .ilike('category', trimmed)
            .then(() => {}, (e) => console.warn('Supabase category reassign error:', e));
        } catch (e) {
          console.warn('Supabase category reassign error:', e);
        }
      }
    }
  }

  if (typeof document !== 'undefined') {
    syncCustomCategoriesToDOM('Personal');
    if (typeof renderHome === 'function') renderHome();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof renderAnalytics === 'function') renderAnalytics();
  }

  return updated;
}

function openDeleteCategoryModal(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const standard = ['project', 'work', 'study', 'personal'];
  if (standard.includes(trimmed.toLowerCase())) {
    alert(`Built-in category "${trimmed}" cannot be deleted.`);
    return;
  }

  pendingCategoryToDelete = trimmed;
  if (typeof document === 'undefined') return;

  const modal = document.getElementById('modal-delete-category-confirm');
  const targetLabel = document.getElementById('delete-category-target-name');
  const warningBox = document.getElementById('delete-category-task-warning');
  const taskCountSpan = document.getElementById('delete-category-task-count');

  if (targetLabel) targetLabel.textContent = trimmed;

  const assignedTasks = (state.todos || []).filter(t => t && t.category && t.category.trim().toLowerCase() === trimmed.toLowerCase());
  if (warningBox && taskCountSpan) {
    if (assignedTasks.length > 0) {
      taskCountSpan.textContent = String(assignedTasks.length);
      warningBox.style.display = 'block';
    } else {
      warningBox.style.display = 'none';
    }
  }

  if (modal) modal.classList.add('active');
}

function closeDeleteCategoryModal() {
  pendingCategoryToDelete = null;
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('modal-delete-category-confirm');
  if (modal) modal.classList.remove('active');
}

function handleConfirmDeleteCategory() {
  if (!pendingCategoryToDelete) {
    closeDeleteCategoryModal();
    return;
  }
  const toDelete = pendingCategoryToDelete;
  closeDeleteCategoryModal();
  try {
    deleteCustomCategory(toDelete);
  } catch (err) {
    alert(err.message || 'Could not delete category.');
  }
}

function getTaskCategoryConfig(category) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    return TaskCategoryColors.Personal;
  }
  const cat = category.trim();
  const lower = cat.toLowerCase();
  if (lower === 'project' || lower.includes('project')) return TaskCategoryColors.Project;
  if (lower === 'work' || lower.includes('work'))    return TaskCategoryColors.Work;
  if (lower === 'study' || lower.includes('study'))   return TaskCategoryColors.Study;
  if (lower === 'personal' || lower.includes('personal')) return TaskCategoryColors.Personal;

  // Custom category (always Yellow #FACC15, dark text #422006)
  return {
    key: 'custom',
    name: cat || 'Custom',
    hex: '#FACC15',
    bg: '#FEFCE8',
    border: '#FEF08A',
    text: '#854D0E',
    badgeText: '#422006',
    icon: '✨'
  };
}

if (typeof window !== 'undefined') {
  window.TaskCategoryColors = TaskCategoryColors;
  window.getTaskCategoryConfig = getTaskCategoryConfig;
  window.getStoredCustomCategories = getStoredCustomCategories;
  window.saveCustomCategory = saveCustomCategory;
  window.deleteCustomCategory = deleteCustomCategory;
  window.openDeleteCategoryModal = openDeleteCategoryModal;
  window.closeDeleteCategoryModal = closeDeleteCategoryModal;
  window.handleConfirmDeleteCategory = handleConfirmDeleteCategory;
  window.syncCustomCategoriesToDOM = syncCustomCategoriesToDOM;
}

function renderCalendarTimelineItemHtml(t) {
  const isChecked = Boolean(t.completed);
  const timeDisplay = t.time ? escapeHtml(t.time) : 'All Day';
  let shortTime = 'All Day';
  if (t.time) {
    const timeMatch = t.time.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    shortTime = timeMatch ? timeMatch[1] : t.time;
  }
  
  // Category configuration (Independent of Calendar Date-Cell Workload)
  const catConfig = getTaskCategoryConfig(t.category);
  const cardClass = `tl-card-cat-${catConfig.key}`;
  const dotColor = catConfig.hex;
  const iconBg = catConfig.hex;
  const iconColor = catConfig.badgeText;
  const pct = isChecked ? '100%' : '0%';
  const nodeIcon = getTimelineCategoryIcon(t);

  return `
    <div class="timeline-event-row cal-timeline-item ${isChecked ? 'completed' : ''}" data-id="${t.id}" data-task-id="${t.id}" data-category="${catConfig.name}">
      <div class="timeline-time-col">
        <span class="timeline-time-text timeline-time-label">${shortTime}</span>
      </div>
      <div class="timeline-spine-col">
        <div class="timeline-marker-dot ${isChecked ? 'checked' : ''}" style="background: ${dotColor};"></div>
      </div>
      <div class="timeline-card ${cardClass}" style="border-left: 4px solid ${catConfig.hex} !important;">
        <div class="tl-card-main">
          <div class="tl-icon-circle timeline-node-circle" style="background: ${iconBg} !important; color: ${iconColor} !important; width: 28px; height: 28px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0;" title="${escapeHtml(catConfig.name)}">
            ${nodeIcon}
          </div>
          <div class="tl-text-box timeline-content">
            <div class="tl-title timeline-title" style="${isChecked ? 'color: #065F46;' : ''}">${escapeHtml(t.title)}</div>
            <div class="tl-sub timeline-sub" style="${isChecked ? 'color: #047857;' : ''}">${escapeHtml(t.description || timeDisplay)}</div>
            <div class="tl-badge-row">
              <span class="priority-badge-pill p-${(t.priority || 'medium').toLowerCase()}">${escapeHtml(t.priority || 'Medium')}</span>
              <span class="tl-category-tag cat-badge-${catConfig.key}" style="background-color: ${catConfig.hex} !important; color: ${catConfig.badgeText} !important; font-weight: 700;">${escapeHtml(catConfig.name)}</span>
            </div>
          </div>
        </div>
        <div class="tl-status-col">
          <span class="tl-percent" style="${isChecked ? 'color: #047857;' : ''}">${pct}</span>
          <button type="button" class="tl-check-round timeline-status-btn ${isChecked ? 'checked' : ''}" onclick="handleToggleComplete('${t.id}')" aria-label="Toggle task completed">
            ${isChecked ? '✓' : ''}
          </button>
          <button type="button" class="btn-task-edit" onclick="handleOpenEditTaskModal(event, '${t.id}')" title="Edit Task" aria-label="Edit Task" style="margin-top: 4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// Taskly Dynamic Calendar Priority Workload Calculation Engine
// High priority: Pink #E83E9D | Medium priority: Green #83DF64 | Low priority: Cyan #83DDE8
// All assigned tasks have the same priority: Grey #EEEEEE | Empty date: Neutral empty-date
// ==========================================================================
const TasklyWorkloadEngine = {
  colors: {
    high:     { key: 'high',     hex: '#E83E9D', text: '#FFFFFF', label: 'High Priority',   class: 'workload-high' },
    medium:   { key: 'medium',   hex: '#83DF64', text: '#153E0C', label: 'Medium Priority', class: 'workload-medium' },
    moderate: { key: 'moderate', hex: '#83DF64', text: '#153E0C', label: 'Medium Priority', class: 'workload-medium' },
    low:      { key: 'low',      hex: '#83DDE8', text: '#0A3B43', label: 'Low Priority',    class: 'workload-low' },
    custom:   { key: 'custom',   hex: '#FACC15', text: '#422006', label: 'Custom Category', class: 'workload-custom' },
    equal:    { key: 'equal',    hex: '#EEEEEE', text: '#2B180E', label: 'Equal Priority',  class: 'workload-equal' },
    empty:    { key: 'empty',    hex: 'transparent', text: 'inherit', label: 'No Tasks',    class: 'workload-empty' }
  },

  getWorkloadCategory(dateStr, todos = state.todos) {
    if (!dateStr || !Array.isArray(todos)) {
      return { score: 0, count: 0, ...this.colors.empty };
    }
    const tasksOnDate = todos.filter(t => t && t.dueDate === dateStr);
    const count = tasksOnDate.length;
    if (count === 0) {
      return { score: 0, count: 0, ...this.colors.empty };
    }

    // Read normalized priority for every task
    const priorities = tasksOnDate.map(t => {
      const p = String(t.priority || '').trim().toLowerCase();
      if (p === 'high') return 'high';
      if (p === 'medium' || p === 'med') return 'medium';
      return 'low';
    });

    const distinctPriorities = new Set(priorities);
    const hasDifferentPriorities = distinctPriorities.size > 1;

    // Part 2 Calendar Requirement:
    // 1. If a calendar date contains tasks with different priorities, apply the existing priority-based aggregation:
    //    - High priority -> Pink #E83E9D
    //    - Medium priority -> Green #83DF64
    //    - Low priority -> Cyan #83DDE8
    if (hasDifferentPriorities) {
      if (priorities.includes('high')) {
        return { score: count, count, priority: 'high', ...this.colors.high };
      }
      if (priorities.includes('medium')) {
        return { score: count, count, priority: 'medium', ...this.colors.medium };
      }
      return { score: count, count, priority: 'low', ...this.colors.low };
    }

    // 2. Otherwise, for single tasks or when tasks do not have different priorities:
    //    - Custom category tasks must display Yellow (#FACC15) with text #422006
    const hasCustomCategory = tasksOnDate.some(t => {
      const cfg = typeof getTaskCategoryConfig === 'function' ? getTaskCategoryConfig(t.category) : null;
      return cfg && cfg.key === 'custom';
    });
    if (hasCustomCategory) {
      return { score: count, count, priority: 'custom', ...this.colors.custom };
    }

    // 3. If multiple assigned tasks all have the exact same priority (and no custom category), display Grey (#EEEEEE)
    const isAllEqual = priorities.length > 1 && priorities.every(p => p === priorities[0]);
    if (isAllEqual) {
      return { score: count, count, priority: priorities[0], ...this.colors.equal };
    }

    // 4. Single standard-category task: display its priority color
    if (priorities.includes('high')) {
      return { score: count, count, priority: 'high', ...this.colors.high };
    }
    if (priorities.includes('medium')) {
      return { score: count, count, priority: 'medium', ...this.colors.medium };
    }
    return { score: count, count, priority: 'low', ...this.colors.low };
  },

  calculateScore(dateStr, todos = state.todos) {
    const res = this.getWorkloadCategory(dateStr, todos);
    return res.count || res.score || 0;
  }
};

if (typeof window !== 'undefined') {
  window.TasklyWorkloadEngine = TasklyWorkloadEngine;
}

// 2. Calendar Render
function renderCalendar() {
  const monthTitle = document.getElementById('cal-month-display');
  const daysContainer = document.getElementById('calendar-days-container');
  const selectedDateTitle = document.getElementById('cal-selected-date-title');
  const taskListContainer = document.getElementById('calendar-task-list');
  const weekdaysRow = document.getElementById('calendar-weekdays');
  const viewToggleLabel = document.getElementById('btn-cal-view-label');

  const curYear = state.calCurrentDate.getFullYear();
  const curMonth = state.calCurrentDate.getMonth();

  if (monthTitle) {
    monthTitle.textContent = state.calCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Map which dates have tasks
  const datesWithTasks = new Set();
  state.todos.forEach(t => {
    if (t.dueDate) datesWithTasks.add(t.dueDate);
  });

  const isMonthView = state.calendarViewMode === 'month';
  if (viewToggleLabel) {
    viewToggleLabel.textContent = isMonthView ? 'Week Strip' : 'Month View';
  }
  if (weekdaysRow) {
    weekdaysRow.style.display = isMonthView ? 'grid' : 'none';
  }

  // Days Grid / Strip
  if (daysContainer) {
    let cellsHtml = '';

    if (isMonthView) {
      // Full Month Grid View with Dynamic Heatmap
      const firstDayIndex = (new Date(curYear, curMonth, 1).getDay() + 6) % 7; // Monday = 0
      const totalDaysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
      const todayStr = toYmdString(new Date());

      for (let i = 0; i < firstDayIndex; i++) {
        cellsHtml += `<div class="cal-day-cell other-month"><span class="day-num"></span></div>`;
      }

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const cellDateStr = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isSelected = cellDateStr === state.selectedDateStr;
        const isToday = cellDateStr === todayStr;
        const workload = TasklyWorkloadEngine.getWorkloadCategory(cellDateStr, state.todos);
        const isEmptyDate = workload.key === 'empty' || (workload.count === 0);
        const bgStyle = isEmptyDate ? '' : `background-color: ${workload.hex} !important;`;
        const textStyle = isEmptyDate ? '' : `color: ${workload.text} !important;`;
        const workloadTitle = isEmptyDate ? 'No tasks scheduled' : `${workload.label} (${workload.count} task${workload.count > 1 ? 's' : ''})`;

        cellsHtml += `
          <div class="cal-day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'is-today' : ''} ${workload.class}" 
               data-date="${cellDateStr}" 
               data-workload-score="${workload.score || 0}"
               data-workload-level="${workload.key}"
               data-workload-count="${workload.count || 0}"
               title="${workloadTitle}"
               ${bgStyle ? `style="${bgStyle}"` : ''} 
               onclick="selectCalendarDate('${cellDateStr}')">
            <span class="day-num" ${textStyle ? `style="${textStyle}"` : ''}>${d}</span>
            ${isToday ? '<span class="today-marker-dot"></span>' : ''}
          </div>
        `;
      }
    } else {
      // 7-Day Horizontal Strip View (Matching Reference Design with Heatmap Number Badges)
      const parts = state.selectedDateStr.split('-').map(Number);
      const selDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const selDayOfWeek = selDateObj.getDay(); // 0 is Sun, 1 is Mon
      const mondayOffset = (selDayOfWeek === 0 ? 6 : selDayOfWeek - 1);
      const mondayDate = new Date(selDateObj);
      mondayDate.setDate(selDateObj.getDate() - mondayOffset);
      const todayStr = toYmdString(new Date());

      for (let i = 0; i < 7; i++) {
        const stripDate = new Date(mondayDate);
        stripDate.setDate(mondayDate.getDate() + i);
        const stripDateStr = toYmdString(stripDate);
        const dayAbbr = stripDate.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = stripDate.getDate();
        const isSelected = stripDateStr === state.selectedDateStr;
        const isToday = stripDateStr === todayStr;
        const workload = TasklyWorkloadEngine.getWorkloadCategory(stripDateStr, state.todos);
        const isEmptyDate = workload.key === 'empty' || (workload.count === 0);
        const bgStyle = isEmptyDate ? '' : `background-color: ${workload.hex} !important;`;
        const textStyle = isEmptyDate ? '' : `color: ${workload.text} !important;`;

        cellsHtml += `
          <div class="cal-strip-day ${isSelected ? 'selected' : ''} ${isToday ? 'is-today' : ''} ${workload.class}" 
               data-date="${stripDateStr}" 
               data-workload-score="${workload.score || 0}"
               data-workload-level="${workload.key}"
               data-workload-count="${workload.count || 0}"
               onclick="selectCalendarDate('${stripDateStr}')">
            <span class="cal-strip-weekday ${isSelected ? 'text-active' : ''}">${dayAbbr}</span>
            <div class="cal-strip-num-wrap" ${bgStyle ? `style="${bgStyle}"` : ''}>
              <span class="cal-strip-num" ${textStyle ? `style="${textStyle}"` : ''}>${dayNum}</span>
              ${isToday ? '<span class="today-marker-dot"></span>' : ''}
            </div>
          </div>
        `;
      }
    }

    daysContainer.innerHTML = cellsHtml;
  }

  // Summary Metrics Calculation (Tasks Completed)
  const tasksOnDate = state.todos.filter(t => t.dueDate === state.selectedDateStr);
  const tasksCountEl = document.getElementById('cal-metric-tasks-count');
  const ringTasksEl = document.getElementById('cal-ring-tasks');

  const completedOnDate = tasksOnDate.filter(t => t.completed).length;
  const totalOnDate = tasksOnDate.length;

  if (tasksCountEl) {
    if (totalOnDate > 0) {
      tasksCountEl.textContent = `${completedOnDate} / ${totalOnDate}`;
    } else {
      const overallCompleted = state.todos.filter(t => t.completed).length;
      tasksCountEl.textContent = `${overallCompleted} / ${state.todos.length}`;
    }
  }

  if (ringTasksEl) {
    const pct = totalOnDate === 0
      ? (state.todos.length === 0 ? 0 : Math.round((state.todos.filter(t => t.completed).length / state.todos.length) * 100))
      : Math.round((completedOnDate / totalOnDate) * 100);
    ringTasksEl.style.strokeDasharray = `${pct}, 100`;
  }

  // Scheduled tasks for selected date
  if (selectedDateTitle) {
    const parts = state.selectedDateStr.split('-');
    const selObj = new Date(parts[0], parts[1] - 1, parts[2]);
    selectedDateTitle.textContent = `Tasks on ${selObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }

  // Chronological Daily Task Timeline (Real database tasks)
  if (taskListContainer) {
    if (tasksOnDate.length === 0) {
      taskListContainer.innerHTML = `
        <div class="timeline-event-row timeline-empty-row">
          <div class="timeline-time-col"></div>
          <div class="timeline-spine-col"></div>
          <div class="timeline-empty-card">
            <div style="font-size: 20px; margin-bottom: 4px;">🎉</div>
            <div style="font-weight: 800; font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">No tasks scheduled for this day</div>
            <p style="font-size: 0.8125rem; margin: 0; color: var(--text-muted);">Tap the red + button below to create a task for this date.</p>
          </div>
        </div>
      `;
    } else {
      const sortedTasks = [...tasksOnDate].sort((a, b) => parseTimeSortKey(a.time) - parseTimeSortKey(b.time));
      taskListContainer.innerHTML = sortedTasks.map(t => renderCalendarTimelineItemHtml(t)).join('');
    }
  }

  // Undated Tasks Section (Requirement 4D)
  const undatedTasks = state.todos.filter(t => !t.dueDate);
  const undatedSection = document.getElementById('calendar-undated-section');
  const undatedCountEl = document.getElementById('undated-tasks-count');
  const undatedListEl = document.getElementById('calendar-undated-list');

  if (undatedSection && undatedCountEl && undatedListEl) {
    if (undatedTasks.length > 0) {
      undatedSection.style.display = 'block';
      undatedCountEl.textContent = undatedTasks.length;
      undatedListEl.innerHTML = undatedTasks.map(t => renderTaskItemHtml(t)).join('');
    } else {
      undatedSection.style.display = 'none';
    }
  }

  setTimeout(updateCalendarTimelineRope, 20);
}

function selectCalendarDate(dateStr) {
  state.selectedDateStr = dateStr;
  const parts = dateStr.split('-').map(Number);
  state.calCurrentDate = new Date(parts[0], parts[1] - 1, 1);
  renderCalendar();
}

function changeCalendarMonth(offset) {
  if (state.calendarViewMode === 'month') {
    state.calCurrentDate.setMonth(state.calCurrentDate.getMonth() + offset);
    const y = state.calCurrentDate.getFullYear();
    const m = String(state.calCurrentDate.getMonth() + 1).padStart(2, '0');
    state.selectedDateStr = `${y}-${m}-01`;
  } else {
    // Navigate by week in 7-day strip mode
    const parts = state.selectedDateStr.split('-').map(Number);
    const curSel = new Date(parts[0], parts[1] - 1, parts[2]);
    curSel.setDate(curSel.getDate() + (offset * 7));
    state.selectedDateStr = toYmdString(curSel);
    state.calCurrentDate = new Date(curSel.getFullYear(), curSel.getMonth(), 1);
  }
  renderCalendar();
}

function toggleCalendarViewMode() {
  state.calendarViewMode = state.calendarViewMode === 'month' ? 'strip' : 'month';
  renderCalendar();
}

// ==========================================================================
// 3. Analytics & Progress Engine (Fully Dynamic Real-Data Driven)
// ==========================================================================

function calculateStreaks(todos) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return { currentStreak: 0, bestStreak: 0, completedDates: new Set() };
  }

  const completedDates = new Set();
  todos.forEach(t => {
    if (t.completed) {
      const d = t.completedAt ? toYmdString(t.completedAt) : (t.dueDate || toYmdString(t.createdAt || new Date()));
      if (d) completedDates.add(d);
    }
  });

  if (completedDates.size === 0) {
    return { currentStreak: 0, bestStreak: 0, completedDates };
  }

  const todayStr = toYmdString(new Date());
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = toYmdString(yesterdayObj);

  let currentStreak = 0;
  if (completedDates.has(todayStr)) {
    let checkDate = new Date();
    while (true) {
      const dateStr = toYmdString(checkDate);
      if (completedDates.has(dateStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  } else if (completedDates.has(yesterdayStr)) {
    // If completed yesterday, today's streak is preserved as active (waiting for today's tasks)
    let checkDate = new Date(yesterdayObj);
    while (true) {
      const dateStr = toYmdString(checkDate);
      if (completedDates.has(dateStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // All-time best streak
  const sortedDates = Array.from(completedDates).sort();
  let bestStreak = 0;
  let runningStreak = 0;
  let prevDateObj = null;

  sortedDates.forEach(dateStr => {
    const parts = dateStr.split('-').map(Number);
    const curDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    if (!prevDateObj) {
      runningStreak = 1;
    } else {
      const diffTime = curDateObj.getTime() - prevDateObj.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        runningStreak++;
      } else if (diffDays > 1) {
        runningStreak = 1;
      }
    }
    prevDateObj = curDateObj;
    if (runningStreak > bestStreak) {
      bestStreak = runningStreak;
    }
  });

  bestStreak = Math.max(bestStreak, currentStreak);
  return { currentStreak, bestStreak, completedDates };
}

function getWeeklyOverview(todos, refDate = new Date()) {
  const d = new Date(refDate);
  const dayOfWeek = d.getDay(); // 0 is Sun, 1 is Mon
  const mondayOffset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);

  const daysLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekDays = [];
  const todayStr = toYmdString(new Date());

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = toYmdString(cur);

    const dayTasks = (todos || []).filter(t => t.dueDate === dateStr);
    const completed = dayTasks.filter(t => t.completed).length;
    const pending = dayTasks.filter(t => !t.completed).length;
    const isToday = (dateStr === todayStr);

    weekDays.push({
      dateStr,
      label: daysLabels[i],
      completed,
      pending,
      total: dayTasks.length,
      isToday,
      isDone: completed > 0
    });
  }
  return weekDays;
}

function getProductivityLast7Days(todos, refDate = new Date()) {
  const result = [];
  const daysLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date(refDate);

  for (let i = 6; i >= 0; i--) {
    const cur = new Date(today);
    cur.setDate(today.getDate() - i);
    const dateStr = toYmdString(cur);
    const dayLabel = daysLabels[cur.getDay()];

    const dayTasks = (todos || []).filter(t => t.dueDate === dateStr);
    const completed = dayTasks.filter(t => t.completed).length;
    const pending = dayTasks.filter(t => !t.completed).length;

    result.push({
      dateStr,
      dayLabel,
      completed,
      pending,
      total: dayTasks.length
    });
  }
  return result;
}

function getCategoryBreakdown(todos) {
  const standardCats = ['Project', 'Work', 'Study', 'Personal'];
  const metaMap = {
    'Project': { tag: 'PR', color: '#0D9488', bg: '#CCFBF1' },
    'Work': { tag: 'WO', color: '#3B82F6', bg: '#DBEAFE' },
    'Study': { tag: 'ST', color: '#F97316', bg: '#FFEDD5' },
    'Personal': { tag: 'PE', color: '#8B5CF6', bg: '#EDE9FE' }
  };

  const customCats = new Set();
  (todos || []).forEach(t => {
    if (t.category && !standardCats.some(c => c.toLowerCase() === t.category.toLowerCase())) {
      customCats.add(t.category);
    }
  });

  const allCategories = [...standardCats, ...Array.from(customCats)];

  return allCategories.map(cat => {
    const matched = (todos || []).filter(t => (t.category || 'Personal').toLowerCase() === cat.toLowerCase());
    const total = matched.length;
    const completed = matched.filter(t => t.completed).length;
    const pending = total - completed;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    const meta = metaMap[cat] || {
      tag: cat.slice(0, 2).toUpperCase(),
      color: '#64748B',
      bg: '#F1F5F9'
    };

    return {
      category: cat,
      tag: meta.tag,
      color: meta.color,
      bg: meta.bg,
      total,
      completed,
      pending,
      percent
    };
  });
}

function filterTodosByTimeframe(todos, timeframe = 'week') {
  if (!Array.isArray(todos) || todos.length === 0) return [];
  if (timeframe === 'all') return [...todos];

  const today = new Date();
  const todayStr = toYmdString(today);

  if (timeframe === 'week') {
    const dayOfWeek = today.getDay(); // 0 is Sun, 1 is Mon
    const mondayOffset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const monStr = toYmdString(monday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const sunStr = toYmdString(sunday);

    return todos.filter(t => {
      const d = t.dueDate || toYmdString(t.createdAt || today);
      return d >= monStr && d <= sunStr;
    });
  }

  if (timeframe === 'month') {
    const curYearMonth = todayStr.slice(0, 7); // 'YYYY-MM'
    return todos.filter(t => {
      const d = t.dueDate || toYmdString(t.createdAt || today);
      return d.startsWith(curYearMonth);
    });
  }

  return [...todos];
}

function calculateRadarPoints(overallPercent, catBreakdown, onTimePercent) {
  const cx = 170;
  const cy = 120;
  const maxR = 64;
  const minR = 10;

  const getCatRate = (name) => {
    const item = (catBreakdown || []).find(c => c.category.toLowerCase() === name.toLowerCase());
    return item ? (item.percent / 100) : 0;
  };

  const rates = [
    Math.min(1, Math.max(0, (overallPercent || 0) / 100)),
    getCatRate('Project'),
    getCatRate('Work'),
    getCatRate('Study'),
    getCatRate('Personal'),
    Math.min(1, Math.max(0, (onTimePercent || 0) / 100))
  ];

  return rates.map((p, i) => {
    const r = Math.round(minR + (p * (maxR - minR)));
    const angle = (-Math.PI / 2) + (i * (Math.PI / 3));
    const x = Math.round(cx + r * Math.cos(angle));
    const y = Math.round(cy + r * Math.sin(angle));
    return { x, y, r, p };
  });
}

/**
 * Taskly v2.0.0 Build 11 — Overall Productivity Score Calculator
 *
 * Formula:
 * 1. Task Completion Rate (TCR) = (Completed Tasks / Total Tasks) * 100
 * 2. On-Time Completion Rate (OTR) = (On-time Completed / Total Completed with Due Date) * 100
 * 3. Task Performance Score (TPS) = 0.7 * TCR + 0.3 * OTR
 * 4. Routine Consistency Score (RCS) = Weekly Routine Consistency %
 * 5. Overall Productivity Score = 0.5 * TPS + 0.5 * RCS (or individual score if only one dataset exists)
 * 6. Returns null when zero task and zero routine data exist (clean empty state).
 */
function calculateOverallProductivityScore({ todos = [], timeframe = 'week', routineConsistency = null }) {
  const filteredTodos = filterTodosByTimeframe(todos, timeframe);
  const totalTasks = filteredTodos.length;
  const completedTasks = filteredTodos.filter(t => t.completed).length;
  const todayStr = toYmdString(new Date());

  let taskCompletionRate = null;
  if (totalTasks > 0) {
    taskCompletionRate = Math.round((completedTasks / totalTasks) * 100);
  }

  const completedWithDueDate = filteredTodos.filter(t => t.completed && t.dueDate);
  let onTimeRate = 100;
  if (completedWithDueDate.length > 0) {
    const onTimeCount = completedWithDueDate.filter(t => {
      const compDate = t.completedAt ? toYmdString(t.completedAt) : (t.updatedAt ? toYmdString(t.updatedAt) : todayStr);
      return compDate <= t.dueDate;
    }).length;
    onTimeRate = Math.round((onTimeCount / completedWithDueDate.length) * 100);
  }

  let taskPerformanceScore = null;
  if (totalTasks > 0) {
    taskPerformanceScore = Math.round(0.7 * taskCompletionRate + 0.3 * onTimeRate);
  }

  let routineScore = null;
  if (routineConsistency !== null && typeof routineConsistency === 'object') {
    if (typeof routineConsistency.percentage === 'number' && routineConsistency.totalDays > 0) {
      routineScore = routineConsistency.percentage;
    }
  }

  let overallScore = null;
  let statusTier = 'No Data';
  let tierBadge = 'No Activity';

  if (taskPerformanceScore !== null && routineScore !== null) {
    overallScore = Math.round(0.5 * taskPerformanceScore + 0.5 * routineScore);
  } else if (taskPerformanceScore !== null) {
    overallScore = taskPerformanceScore;
  } else if (routineScore !== null) {
    overallScore = routineScore;
  }

  if (overallScore !== null) {
    if (overallScore >= 80) {
      statusTier = 'Exceptional';
      tierBadge = 'Outstanding 🌟';
    } else if (overallScore >= 65) {
      statusTier = 'Great Progress';
      tierBadge = 'Strong Pace ⚡';
    } else if (overallScore >= 50) {
      statusTier = 'Consistent';
      tierBadge = 'On Track ✨';
    } else {
      statusTier = 'Needs Focus';
      tierBadge = 'Building Momentum 🎯';
    }
  }

  return {
    overallScore,
    taskPerformanceScore,
    taskCompletionRate,
    onTimeRate,
    routineScore,
    statusTier,
    tierBadge,
    hasData: overallScore !== null
  };
}

/**
 * Monthly Productivity Trends Breakdown (4-Week Progression)
 */
function getMonthlyProductivityTrends(todos, refDate = new Date()) {
  const today = new Date(refDate);
  const curYear = today.getFullYear();
  const curMonth = today.getMonth();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const weeks = [
    { label: 'Week 1 (1-7)', start: 1, end: 7, completed: 0, total: 0 },
    { label: 'Week 2 (8-14)', start: 8, end: 14, completed: 0, total: 0 },
    { label: 'Week 3 (15-21)', start: 15, end: 21, completed: 0, total: 0 },
    { label: 'Week 4 (22+)', start: 22, end: daysInMonth, completed: 0, total: 0 }
  ];

  const prefix = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
  (todos || []).forEach(t => {
    const dStr = t.dueDate || toYmdString(t.createdAt || today);
    if (!dStr.startsWith(prefix)) return;
    const dayNum = parseInt(dStr.slice(8, 10), 10);
    weeks.forEach(w => {
      if (dayNum >= w.start && dayNum <= w.end) {
        w.total++;
        if (t.completed) w.completed++;
      }
    });
  });

  weeks.forEach(w => {
    w.rate = w.total > 0 ? Math.round((w.completed / w.total) * 100) : 0;
  });

  const monthTasks = (todos || []).filter(t => {
    const dStr = t.dueDate || toYmdString(t.createdAt || today);
    return dStr.startsWith(prefix);
  });
  const monthCompleted = monthTasks.filter(t => t.completed).length;
  const monthRate = monthTasks.length > 0 ? Math.round((monthCompleted / monthTasks.length) * 100) : 0;

  return {
    monthName,
    totalMonthTasks: monthTasks.length,
    completedMonthTasks: monthCompleted,
    monthCompletionRate: monthRate,
    weeks
  };
}

function renderAnalytics() {
  const allTodos = state.todos || [];
  const todayStr = toYmdString(new Date());
  const timeframe = state.analyticsTimeframe || 'week';
  const smartManager = (typeof SmartListsManager !== 'undefined') ? SmartListsManager : null;

  // Retrieve routine consistency metrics if available
  const routineConsistency = smartManager?.state?.consistency?.weekly || null;

  // 1. Overall Productivity Score (Combined tasks + habit routines)
  const scoreData = calculateOverallProductivityScore({
    todos: allTodos,
    timeframe,
    routineConsistency
  });

  // 2. Dynamic Streak Calculation (based on full task history)
  const streakData = calculateStreaks(allTodos);
  const streakDaysEl = document.getElementById('streak-days-display');
  const streakCurrentStatEl = document.getElementById('streak-current-stat');
  const streakBestStatEl = document.getElementById('streak-best-stat');

  if (streakDaysEl) {
    const s = streakData.currentStreak;
    streakDaysEl.textContent = `${s} day${s === 1 ? '' : 's'}`;
  }
  if (streakCurrentStatEl) {
    streakCurrentStatEl.textContent = `🔥 ${streakData.currentStreak} day streak`;
  }
  if (streakBestStatEl) {
    streakBestStatEl.textContent = `🏆 Best: ${streakData.bestStreak} day${streakData.bestStreak === 1 ? '' : 's'}`;
  }

  // 3. Weekly Task Overview (Mon-Sun task completion row)
  const streakRowEl = document.getElementById('streak-7days-row');
  if (streakRowEl) {
    const weekDays = getWeeklyOverview(allTodos);
    streakRowEl.innerHTML = weekDays.map(d => {
      let circleClass = 'streak-day-circle';
      let content = '';
      if (d.completed > 0) {
        circleClass += ' done';
        content = '✓';
      } else if (d.pending > 0) {
        circleClass += ' pending';
        content = '○';
      }
      if (d.isToday) {
        circleClass += ' today';
      }
      const titleAttr = `${d.label} (${d.dateStr}): ${d.completed} completed, ${d.pending} pending`;
      return `
        <div class="streak-day-item" title="${escapeHtml(titleAttr)}">
          <span class="streak-day-label" style="${d.isToday ? 'color: var(--primary); font-weight: 800;' : ''}">${d.label}</span>
          <div class="${circleClass}">${content}</div>
        </div>
      `;
    }).join('');
  }

  // 4. Timeframe Filtering & Task Performance Stats
  const filteredTodos = filterTodosByTimeframe(allTodos, timeframe);
  const total = filteredTodos.length;
  const completed = filteredTodos.filter(t => t.completed).length;
  const pending = total - completed;
  const overdue = filteredTodos.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  // Hero Circular Progress Ring (Score Display)
  const ringFill = document.getElementById('analytics-ring-fill');
  const percentEl = document.getElementById('analytics-percent');
  const heroTierEl = document.getElementById('analytics-hero-tier');
  const summaryEl = document.getElementById('analytics-tasks-summary');
  const trendEl = document.getElementById('analytics-trend-badge');
  const formulaNoteEl = document.getElementById('analytics-score-formula-note');

  if (ringFill) {
    const offset = 251.2 - (251.2 * percent / 100);
    ringFill.style.strokeDashoffset = offset;
  }
  if (percentEl) {
    percentEl.textContent = `${percent}%`;
  }
  if (heroTierEl) {
    heroTierEl.textContent = scoreData.hasData ? `Productivity: ${scoreData.statusTier}` : 'Productivity Score';
  }
  if (summaryEl) {
    if (total === 0) {
      summaryEl.textContent = 'No tasks in this timeframe';
    } else {
      summaryEl.textContent = `${completed} of ${total} tasks completed`;
    }
  }
  if (trendEl) {
    if (total === 0) {
      trendEl.textContent = 'Add tasks to start 🚀';
    } else if (percent === 100) {
      trendEl.textContent = '100% All tasks done! 🌟';
    } else if (percent >= 75) {
      trendEl.textContent = 'Excellent velocity ⚡';
    } else if (percent >= 50) {
      trendEl.textContent = `${percent}% On track ✨`;
    } else {
      trendEl.textContent = `${percent}% In progress`;
    }
  }
  if (formulaNoteEl) {
    const tRate = scoreData.taskCompletionRate != null ? `${scoreData.taskCompletionRate}%` : '--';
    const rRate = scoreData.routineScore != null ? `${scoreData.routineScore}%` : '--';
    formulaNoteEl.textContent = `Tasks: ${tRate} • Routines: ${rRate} • On-Time: ${scoreData.onTimeRate}%`;
  }

  // Section 2: Task Performance 4-Grid Numbers
  const compVal = document.getElementById('overview-completed-val');
  const pendVal = document.getElementById('overview-pending-val');
  const overVal = document.getElementById('overview-overdue-val');
  const onTimeVal = document.getElementById('overview-ontime-val');
  const subComp = document.getElementById('sub-task-completed');
  const timeframePill = document.getElementById('task-analytics-timeframe-pill');

  if (compVal) compVal.textContent = completed;
  if (pendVal) pendVal.textContent = pending;
  if (overVal) overVal.textContent = overdue;
  if (onTimeVal) onTimeVal.textContent = `${scoreData.onTimeRate}%`;
  if (subComp) subComp.textContent = `${percent}% of total`;
  if (timeframePill) {
    timeframePill.textContent = timeframe === 'month' ? 'This Month' : (timeframe === 'all' ? 'All Time' : 'This Week');
  }

  // Task Ratio Stacked Bar Segments
  const segComp = document.getElementById('ratio-seg-completed');
  const segPend = document.getElementById('ratio-seg-pending');
  const segOver = document.getElementById('ratio-seg-overdue');
  if (segComp && segPend && segOver) {
    if (total === 0) {
      segComp.style.width = '0%';
      segPend.style.width = '100%';
      segOver.style.width = '0%';
    } else {
      const compPct = Math.round((completed / total) * 100);
      const overPct = Math.round((overdue / total) * 100);
      const pendPct = Math.max(0, 100 - compPct - overPct);
      segComp.style.width = `${compPct}%`;
      segPend.style.width = `${pendPct}%`;
      segOver.style.width = `${overPct}%`;
    }
  }

  // Section 3: Habit Streaks & Routine Analytics Integration
  if (smartManager) {
    const currHabitEl = document.getElementById('progress-habit-current-streak');
    const bestHabitEl = document.getElementById('progress-habit-best-streak');
    const dailyRoutineEl = document.getElementById('progress-habit-daily-rate');
    const weeklyRoutineEl = document.getElementById('progress-habit-weekly-rate');
    const weeklyDaysEl = document.getElementById('progress-habit-weekly-days');
    const monthlyRoutineEl = document.getElementById('progress-habit-monthly-rate');
    const monthlyDaysEl = document.getElementById('progress-habit-monthly-days');

    const chipDone = document.getElementById('progress-routine-chip-completed');
    const chipPend = document.getElementById('progress-routine-chip-pending');
    const chipPost = document.getElementById('progress-routine-chip-postponed');
    const chipCanc = document.getElementById('progress-routine-chip-cancelled');

    const streaks = smartManager.state.streaks || { currentStreak: 0, longestStreak: 0 };
    const consistency = smartManager.state.consistency || {};
    const dailyStats = smartManager.state.dailyStats || {};

    if (currHabitEl) currHabitEl.textContent = `🔥 ${streaks.currentStreak} Days`;
    if (bestHabitEl) bestHabitEl.textContent = `🏆 Best: ${streaks.longestStreak} Days`;
    if (dailyRoutineEl) dailyRoutineEl.textContent = `${dailyStats.completionRate || 0}%`;
    if (weeklyRoutineEl) weeklyRoutineEl.textContent = `${consistency.weekly?.percentage || 0}%`;
    if (weeklyDaysEl) weeklyDaysEl.textContent = `${consistency.weekly?.qualifyingDays || 0}/${consistency.weekly?.totalDays || 0} days`;
    if (monthlyRoutineEl) monthlyRoutineEl.textContent = `${consistency.monthly?.percentage || 0}%`;
    if (monthlyDaysEl) monthlyDaysEl.textContent = `${consistency.monthly?.qualifyingDays || 0}/${consistency.monthly?.totalDays || 0} days`;

    if (chipDone) chipDone.textContent = `✓ ${dailyStats.completedCount || 0} Done`;
    if (chipPend) chipPend.textContent = `○ ${dailyStats.pendingCount || 0} Pending`;
    if (chipPost) chipPost.textContent = `↳ ${dailyStats.postponedCount || 0} Postponed`;
    if (chipCanc) chipCanc.textContent = `✕ ${dailyStats.cancelledCount || 0} Cancelled`;
  }

  // Section 4: Weekly Performance Bar Chart (Last 7 Days)
  const barContainer = document.getElementById('barchart-bars');
  const peakDayPill = document.getElementById('weekly-peak-day-pill');
  if (barContainer) {
    const last7 = getProductivityLast7Days(allTodos);
    const maxVal = Math.max(...last7.map(d => d.completed), 1);
    let peakDay = null;
    let peakCount = 0;

    barContainer.innerHTML = last7.map((dayItem) => {
      if (dayItem.completed > peakCount) {
        peakCount = dayItem.completed;
        peakDay = dayItem.dayLabel;
      }
      const heightPercent = dayItem.completed === 0 ? 0 : Math.round((dayItem.completed / maxVal) * 100);
      const titleAttr = `${dayItem.dayLabel} (${dayItem.dateStr}): ${dayItem.completed} completed, ${dayItem.pending} pending`;
      return `
        <div class="bar-col" title="${escapeHtml(titleAttr)}">
          <div class="bar-tube">
            <div class="bar-fill" style="height: ${heightPercent}%;"></div>
          </div>
          <span class="bar-label">${dayItem.dayLabel}</span>
        </div>
      `;
    }).join('');

    if (peakDayPill) {
      peakDayPill.textContent = peakCount > 0 ? `Peak: ${peakDay} (${peakCount})` : 'Peak: None';
    }
  }

  // Section 5: Monthly Performance & Trends
  const monthlyBreakdownEl = document.getElementById('monthly-weeks-breakdown');
  const monthlySummarySubEl = document.getElementById('monthly-summary-sub');
  const monthlyCompBadgeEl = document.getElementById('monthly-comparison-badge');
  if (monthlyBreakdownEl) {
    const monthTrends = getMonthlyProductivityTrends(allTodos);
    if (monthlySummarySubEl) {
      monthlySummarySubEl.textContent = `${monthTrends.monthName}: ${monthTrends.completedMonthTasks} of ${monthTrends.totalMonthTasks} tasks completed (${monthTrends.monthCompletionRate}%)`;
    }
    if (monthlyCompBadgeEl) {
      if (monthTrends.monthCompletionRate >= 75) {
        monthlyCompBadgeEl.textContent = 'High momentum 🚀';
      } else if (monthTrends.monthCompletionRate >= 50) {
        monthlyCompBadgeEl.textContent = 'Consistent pace ✨';
      } else {
        monthlyCompBadgeEl.textContent = 'Building cadence 🎯';
      }
    }

    monthlyBreakdownEl.innerHTML = monthTrends.weeks.map(w => `
      <div class="monthly-week-row">
        <span class="monthly-week-lbl">${w.label}</span>
        <div class="monthly-week-tube">
          <div class="monthly-week-fill" style="width: ${w.rate}%;"></div>
        </div>
        <span class="monthly-week-rate">${w.rate}%</span>
      </div>
    `).join('');
  }

  // Section 6: Category-wise Task Completion Breakdown
  const catListEl = document.getElementById('progress-category-list');
  const catBreakdown = getCategoryBreakdown(filteredTodos);
  if (catListEl) {
    const activeCategories = catBreakdown.filter(c => c.total > 0);
    if (activeCategories.length === 0) {
      catListEl.innerHTML = `
        <div class="progress-empty-state">
          No tasks found for this period. Create tasks and assign categories (Project, Work, Study, Personal) to see your breakdown.
        </div>
      `;
    } else {
      catListEl.innerHTML = activeCategories.map(c => `
        <div class="learning-item-card">
          <div class="learning-tag-box" style="background: ${c.color};">${c.tag}</div>
          <div class="learning-info-col">
            <div class="learning-title">${escapeHtml(c.category)}</div>
            <div class="learning-meta">${c.completed} of ${c.total} completed • ${c.percent}%</div>
          </div>
          <div class="circle-progress-mini" style="border: 3px solid ${c.color}; border-radius: 9999px;">${c.percent}%</div>
        </div>
      `).join('');
    }
  }

  // Section 6: Productivity & Category Dynamic Radar Chart
  const radarPolygon = document.getElementById('radar-polygon');
  const radarPointsGroup = document.getElementById('radar-points');
  if (radarPolygon) {
    const onTimeRate = scoreData.onTimeRate;
    const radarPts = calculateRadarPoints(percent, catBreakdown, onTimeRate);
    const pointsStr = radarPts.map(p => `${p.x},${p.y}`).join(' ');
    radarPolygon.setAttribute('points', pointsStr);

    if (radarPointsGroup) {
      radarPointsGroup.innerHTML = radarPts.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#F88438"/>
      `).join('');
    }
  }
}

// 4. Profile Render
function renderProfile() {
  const nameEl = document.getElementById('profile-display-name');
  const ageEl = document.getElementById('profile-display-age');
  const emailEl = document.getElementById('profile-display-email');
  const deskNameEl = document.getElementById('desktop-user-name');
  const deskAvatarEl = document.getElementById('desktop-user-avatar');

  const isPreview = Boolean(state.isPreviewSession && isLocalPreview());
  const currentName = isPreview ? 'Preview User' : (state.user.name || 'User');
  const currentEmail = isPreview ? 'preview@local.test' : (state.user.email || '');

  if (nameEl) nameEl.textContent = currentName;
  if (ageEl) ageEl.textContent = isPreview ? 'LOCAL UI PREVIEW' : `Age: ${state.user.age || 18}`;
  if (emailEl) {
    if (currentEmail) {
      emailEl.textContent = currentEmail;
      emailEl.style.display = 'block';
    } else {
      emailEl.textContent = '';
      emailEl.style.display = 'none';
    }
  }
  if (deskNameEl) deskNameEl.textContent = isPreview ? 'Preview User (Local UI)' : currentName;
  if (deskAvatarEl) deskAvatarEl.textContent = currentName.charAt(0).toUpperCase();

  const profileAvatarCircle = document.getElementById('profile-avatar-circle');
  if (profileAvatarCircle) {
    profileAvatarCircle.innerHTML = `<span style="font-weight: 800; font-size: 1.5rem;">${currentName.charAt(0).toUpperCase()}</span>`;
  }
}

// ==========================================================================
// Authentication Password Visibility Toggle
// ==========================================================================
function updatePasswordVisibilityUI(visible, mode) {
  const currentMode = mode || state.authMode || 'login';
  const passwordInput = document.getElementById('setup-password');
  const toggleBtn = document.getElementById('btn-toggle-password');

  if (passwordInput) {
    const currentVal = passwordInput.value;
    passwordInput.type = visible ? 'text' : 'password';
    passwordInput.value = currentVal;
  }

  if (toggleBtn) {
    const label = visible ? 'Hide password' : 'Show password';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('title', label);
    const eyeIcon = toggleBtn.querySelector('.icon-eye');
    const eyeOffIcon = toggleBtn.querySelector('.icon-eye-off');
    if (eyeIcon && eyeOffIcon) {
      eyeIcon.style.display = visible ? 'none' : 'block';
      eyeOffIcon.style.display = visible ? 'block' : 'none';
    }
  }
}

function togglePasswordVisibility(target, btnEl) {
  let mode = state.authMode || 'login';
  let input = document.getElementById('setup-password');
  let btn = btnEl || document.getElementById('btn-toggle-password');

  if (typeof target === 'string') {
    if (target === 'login' || target === 'signup') {
      mode = target;
      input = document.getElementById('setup-password');
      btn = btn || document.getElementById('btn-toggle-password');
    } else {
      const el = document.getElementById(target);
      if (el) {
        input = el;
        if (target.includes('signin') || target.includes('login')) mode = 'login';
        else if (target.includes('signup')) mode = 'signup';
      }
    }
  } else if (target && target.tagName) {
    input = target;
  }

  if (!input) return false;

  const currentVal = input.value;
  const isCurrentlyVisible = input.type === 'text';
  const newVisible = !isCurrentlyVisible;

  if (state.passwordVisibility) {
    state.passwordVisibility[mode] = newVisible;
  }

  input.type = newVisible ? 'text' : 'password';
  input.value = currentVal;

  if (btn) {
    const label = newVisible ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    const eyeIcon = btn.querySelector('.icon-eye');
    const eyeOffIcon = btn.querySelector('.icon-eye-off');
    if (eyeIcon && eyeOffIcon) {
      eyeIcon.style.display = newVisible ? 'none' : 'block';
      eyeOffIcon.style.display = newVisible ? 'block' : 'none';
    } else {
      btn.innerHTML = newVisible ? `
        <svg class="icon-eye-off" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      ` : `
        <svg class="icon-eye" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      `;
    }
  }

  return newVisible;
}

if (typeof window !== 'undefined') {
  window.togglePasswordVisibility = togglePasswordVisibility;
  window.togglePassVisibility = togglePasswordVisibility;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const authErrorMsg = document.getElementById('auth-error-msg');
  if (authErrorMsg) {
    authErrorMsg.style.display = 'none';
    authErrorMsg.textContent = '';
  }
  const authPetImg = document.getElementById('auth-pet-img');
  if (authPetImg) {
    authPetImg.src = mode === 'signup' ? '/assets/pets/signup_cat_wave.png' : '/assets/pets/signin_dog_sleep.png';
    authPetImg.alt = mode === 'signup' ? 'Waving Cat Mascot' : 'Sleeping Dog Mascot';
  }

  // Sync password visibility to this mode's independent setting
  const targetVisibility = state.passwordVisibility ? (state.passwordVisibility[mode] || false) : false;
  updatePasswordVisibilityUI(targetVisibility, mode);

  const btnToggleLogin = document.getElementById('btn-toggle-login');
  const btnToggleSignup = document.getElementById('btn-toggle-signup');
  const fieldWrapName = document.getElementById('field-wrap-name');
  const fieldWrapAge = document.getElementById('field-wrap-age');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');
  const btnAuthText = document.getElementById('btn-auth-text');

  if (mode === 'signup') {
    btnToggleSignup?.classList.add('active');
    btnToggleLogin?.classList.remove('active');
    if (fieldWrapName) fieldWrapName.style.display = 'flex';
    if (fieldWrapAge) fieldWrapAge.style.display = 'flex';
    if (authTitle) authTitle.innerHTML = 'Create your<br>account ✨';
    if (authSubtitle) authSubtitle.textContent = 'Start organizing your tasks with Taskly.';
    if (btnAuthText) btnAuthText.textContent = 'Create Account';
  } else {
    btnToggleLogin?.classList.add('active');
    btnToggleSignup?.classList.remove('active');
    if (fieldWrapName) fieldWrapName.style.display = 'none';
    if (fieldWrapAge) fieldWrapAge.style.display = 'none';
    if (authTitle) authTitle.innerHTML = 'Welcome back<br>to Taskly ✨';
    if (authSubtitle) authSubtitle.textContent = 'Sign in to access and sync your tasks.';
    if (btnAuthText) btnAuthText.textContent = 'Sign In';
  }
}

// ==========================================================================
// FAQ Accordion & Real-time Search Helpers
// ==========================================================================
function toggleFaqAccordion(btn) {
  if (!btn) return;
  const item = btn.closest('.faq-item');
  if (!item) return;

  const isCurrentlyOpen = item.classList.contains('active');

  // Collapse all other questions (Do not display all answers expanded simultaneously)
  const container = document.getElementById('faq-list-container');
  if (container) {
    container.querySelectorAll('.faq-item.active').forEach(otherItem => {
      otherItem.classList.remove('active');
      const otherBtn = otherItem.querySelector('.faq-question-btn');
      if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // If this item was not already open, expand it
  if (!isCurrentlyOpen) {
    item.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  }
}

function filterFaqItems(query) {
  const term = (query || '').trim().toLowerCase();
  const container = document.getElementById('faq-list-container');
  if (!container) return;

  const items = container.querySelectorAll('.faq-item');
  const sections = container.querySelectorAll('.faq-category-section');
  const emptyPlaceholder = document.getElementById('faq-empty-search');
  const clearBtn = document.getElementById('btn-clear-faq-search');

  if (clearBtn) {
    clearBtn.style.display = term ? 'block' : 'none';
  }

  let visibleCount = 0;

  items.forEach(item => {
    const qText = (item.querySelector('.faq-question-text')?.textContent || '').toLowerCase();
    const aText = (item.querySelector('.faq-answer-content')?.textContent || '').toLowerCase();
    const matches = !term || qText.includes(term) || aText.includes(term);

    item.style.display = matches ? 'block' : 'none';
    if (matches) visibleCount++;
  });

  sections.forEach(sec => {
    const visibleInSec = sec.querySelectorAll('.faq-item:not([style*="display: none"])');
    sec.style.display = visibleInSec.length > 0 ? 'flex' : 'none';
  });

  if (emptyPlaceholder) {
    emptyPlaceholder.style.display = visibleCount === 0 ? 'flex' : 'none';
  }
}

if (typeof window !== 'undefined') {
  window.toggleFaqAccordion = toggleFaqAccordion;
  window.filterFaqItems = filterFaqItems;
}

// ==========================================================================
// Taskly In-App Version & Owner-Controlled Update System
// ==========================================================================

const TasklyUpdateManager = {
  config: {
    primaryManifestUrl: 'https://raw.githubusercontent.com/vimaljayganthan/taskly-todo-app/main/releases/version-manifest.json',
    localFallbackUrl: '/version-manifest.json',
    fallbackVersionName: '1.5.0',
    fallbackVersionCode: 6,
    expectedPackageName: 'com.taskly.app',
    autoCheckIntervalMs: 15 * 60 * 1000, // 15 minutes between automatic checks
    storageKeyWhatsNewSeen: 'taskly_last_seen_whats_new_version'
  },

  state: {
    installedVersionName: '1.5.0',
    installedVersionCode: 6,
    isNative: false,
    platform: 'web',
    latestVersionName: null,
    latestVersionCode: null,
    updateStatus: 'idle', // 'idle' | 'checking' | 'up_to_date' | 'update_available' | 'downloading' | 'installing' | 'error'
    lastChecked: null,
    manifest: null,
    errorMessage: null,
    downloadProgress: { downloadedBytes: 0, totalBytes: 0, percent: 0 },
    historyExpanded: false,
    activeWhatsNewVersionCode: null
  },

  fallbackHistory: [
    {
      version: '1.5.0',
      versionName: '1.5.0',
      versionCode: 6,
      releaseDate: '2026-11-07',
      title: 'Official Notification Branding & In-App APK Updates',
      summary: 'Taskly v1.5.0 brings approved Android notification branding with the Cat & Dog logo for system notices, monochrome paw status icon, cute cat mascot deadline alerts, and full in-app APK update capabilities.',
      features: [
        'Official Taskly Cat & Dog branding for system notices and app identity',
        'Monochrome paw status-bar icon for Android 13+ notifications',
        'Cute cat mascot alerts for approaching and overdue task deadlines',
        'In-app APK update checking, downloading, and package installer integration in Profile → Version',
        'Automatic SHA-256 package checksum verification and downgrade protection before installation'
      ],
      improvements: [
        "Configured persistent Android notification channel 'taskly-reminders-v3'",
        'Streamlined Profile screen with new Version & Updates option'
      ],
      performance: [],
      fixes: [
        'Replaced legacy red paper rocket icon on Android notifications',
        'Normalized delivered notification management on application startup'
      ],
      security: [
        'Verified package download and installation safeguards against unauthorized or corrupted APKs',
        'Strict Android versionCode downgrade prevention'
      ]
    },
    {
      version: '1.4.0',
      versionName: '1.4.0',
      versionCode: 5,
      releaseDate: '2026-11-07',
      title: 'Brand Refresh & Dynamic Calendar Priority Intelligence',
      summary: 'Brand refresh, dynamic calendar priority intelligence & cute cat meow notifications',
      features: [
        'New Taskly Cat & Dog logo across Android launcher and web application',
        'Dynamic calendar priority workload colors (Pink for High, Green for Medium, Cyan for Low, Grey for Homogeneous)',
        'Custom category deletion with safe task reassignment to Personal',
        'Cute Cat Meow notification sound on Android task reminders'
      ],
      improvements: [
        'High-contrast Dark Mode styling for Quick Capture cards and badges',
        'Logout confirmation modal with duplicate-tap protection',
        'Preserved Supabase authentication session across app updates'
      ],
      performance: [],
      fixes: [
        'Fixed CSS declaration structure in public/styles.css',
        'Separated Android monochrome notification icon from cute cat mascots'
      ],
      security: []
    },
    {
      version: '1.2.0',
      versionName: '1.2.0',
      versionCode: 3,
      releaseDate: '2026-11-05',
      title: 'Multi-User Cloud Synchronization',
      summary: 'Multi-user cloud synchronization & Supabase authentication',
      features: [
        'Supabase cloud database synchronization for tasks and notes',
        'Secure user registration and email confirmation workflow'
      ],
      improvements: [
        'Offline-first local cache fallback when network is unavailable'
      ],
      performance: [],
      fixes: [
        'Improved deadline reminder notification scheduling across device sleep cycles'
      ],
      security: []
    },
    {
      version: '1.0.0',
      versionName: '1.0.0',
      versionCode: 1,
      releaseDate: '2026-11-01',
      title: 'Initial Taskly Release',
      summary: 'Initial Taskly release',
      features: [
        'Smart task management and progress tracking',
        'Quick notes capture with pin functionality',
        'Interactive calendar view and four theme system'
      ],
      improvements: [],
      performance: [],
      fixes: [],
      security: []
    }
  ],

  // Reference to Build 10 release for historical regression and test compatibility
  build10Release: {
    version: '1.9.0',
    versionName: '1.9.0',
    versionCode: 10,
    releaseDate: '2026-11-08',
    title: 'Smart Lists – Daily Routine Management',
    summary: 'Introduced Smart Lists, a dedicated space for managing daily routines, tracking completion, and reviewing personal productivity.',
    features: [
      'Simple daily routine creation, editing, and deletion',
      'Individual routine completion checkboxes',
      'Date-specific completion tracking',
      'Daily productivity summary reports',
      'Configurable daily summary reminder, defaulting to 10:00 PM',
      'Carry-forward options for incomplete routines',
      'Historical daily reports',
      'Four-theme support',
      'Persistent routine data and account synchronization'
    ],
    improvements: [
      'Clean printed paper report document design for daily productivity summaries',
      'Android status bar safe-area top inset spacing and clean header navigation',
      'Dedicated golden yellow Summary button and muted neutral grey Settings button'
    ],
    performance: [
      'Optimized date-isolated routine status caching and instant checklist rendering'
    ],
    fixes: [
      'Fixed daily routine completion and carry-forward count synchronization bug'
    ],
    security: [
      'Row-Level Security (RLS) enforcement on all smart lists Supabase tables and endpoints'
    ]
  },

  // Reference to Build 11 release for historical regression and test compatibility
  build11Release: {
    version: '2.0.0',
    versionName: '2.0.0',
    versionCode: 11,
    releaseDate: '2026-11-08',
    title: 'Habit Streaks & Productivity Analytics',
    summary: 'Taskly v2.0.0 introduces Habit Streaks integrated into Smart Lists with four-state routine tracking, comprehensive Productivity Analytics on the Progress screen with an Overall Productivity Score, and in-app update management.',
    features: [
      'Habit Streaks integrated directly into Smart Lists with an 80% daily qualifying threshold',
      'Four-state daily routine management: Completed, Pending, Postponed, and Cancelled',
      'Daily, weekly, and monthly routine consistency tracking with current and longest streaks',
      'Touch-friendly routine status picker modal with forward postponement and cancellation reasons',
      'Comprehensive Productivity Analytics on the Progress screen across 6 organized sections',
      'Overall Productivity Score (0–100) combining task delivery performance and routine consistency',
      'Task analytics: total completed, pending, overdue, and on-time completion rates',
      'Weekly and monthly productivity trend visualizations with 7-day completion bars',
      'Category-wise task completion breakdown and multi-axis performance radar'
    ],
    improvements: [
      'Organized Progress screen into 6 clear analytical sections with explainable score metrics',
      'Responsive mobile-first layouts with minimum 44px touch targets across all controls',
      'Full visual parity across Light Mode, Dark Mode, Pet Mode, and Pastel Light Mode',
      'Accurate empty-state and insufficient-data handling without misleading scores'
    ],
    performance: [
      'Client-side offline calculation engine ensuring zero fabricated analytics data',
      'Reactive DOM updates for checklist completions and streak counters'
    ],
    fixes: [
      'Preserved immutable historical report snapshots during routine status updates',
      'Fixed startup routing and persistent onboarding verification on Android 15'
    ],
    security: [
      'Strict user-level data isolation and RLS policies on all routine and analytics endpoints',
      'Secure APK update verification with SHA-256 package checksums and downgrade protection'
    ]
  },

  // Reference to Build 12 release for historical regression and test compatibility
  build12Release: {
    version: '2.1.0',
    versionName: '2.1.0',
    versionCode: 12,
    releaseDate: '2026-11-10',
    title: 'Taskly v2.1.0 – Reliability & Smart Lists Update',
    summary: 'Taskly v2.1.0 brings improved Smart Lists reliability and carry-forward synchronization. Routine updates now appear immediately without restarting the application. We have also improved Supabase persistence, fixed synchronization issues and strengthened duplicate-action protection.',
    features: [
      'Immediate carry-forward UI refresh without requiring application restart',
      'Direct Supabase cloud persistence for Android/Capacitor carry-forward decisions',
      'Robust date-range filtering preserving carried-forward routines',
      'Protection against duplicate carry-forward actions with button state locking',
      'Automatic state rollback safeguarding UI and data integrity on synchronization failure',
      'Instant multi-component refresh across routine lists, counts, daily summaries, and streaks',
      'Updated productivity analytics and habit consistency tracking reflecting immediate progress'
    ],
    improvements: [
      'Improved Smart Lists data synchronization between local state and Supabase',
      'Strengthened Android Capacitor runtime persistence and offline resiliency',
      'Enhanced touch responsiveness and button locking during network sync operations'
    ],
    performance: [
      'Instantaneous UI state transitions with zero artificial delays or blocking loaders',
      'Eliminated duplicate or unnecessary network queries during carry-forward operations'
    ],
    fixes: [
      'Fixed carry-forward changes not appearing immediately in the application',
      'Fixed missing Supabase persistence for Android/Capacitor carry-forward operations',
      'Fixed carried-forward routines being incorrectly excluded by date-range filtering',
      'Fixed routine completion and habit streak calculations after carry-forward'
    ],
    security: [
      'Preserved Row-Level Security (RLS) enforcement across all routine completion operations',
      'Cryptographically signed production APK with SHA-256 integrity verification'
    ]
  },

  // Locally bundled current-build release entry for Taskly v2.1.1 Build 12.1
  localInstalledRelease: {
    version: '2.1.1',
    versionName: '2.1.1',
    versionCode: 121,
    displayBuild: '12.1',
    buildLabel: 'Build 12.1',
    releaseDate: '2026-11-10',
    title: 'Taskly v2.1.1 (Build 12.1) – Routine Deletion & Foreign Key Integrity Hotfix',
    summary: 'Taskly v2.1.1 (Build 12.1) fixes a critical foreign key constraint error when deleting routines. When a routine is deleted from today\'s list, future occurrences are immediately and safely cleaned up. Removing remaining tomorrow occurrences no longer triggers foreign key violations, and orphaned completion records are safely pruned without application errors.',
    features: [
      'Safe and idempotent routine deletion preventing foreign key constraint violations',
      'Instant removal of deleted routines from tomorrow\'s list and routine counts without restarting',
      'Automatic cleanup of orphaned completion records when parent routines are removed',
      'Robust existence verification before attempting completion state updates or upserts',
      'Multi-device and multi-user routine deletion isolation and integrity protection'
    ],
    improvements: [
      'Strengthened referential integrity safeguards across Supabase and local storage',
      'Eliminated spurious error alerts when removing deleted routines from tomorrow',
      'Immediate UI synchronization across routine counts, daily summaries, and habit streaks upon deletion'
    ],
    performance: [
      'Optimistic sub-10ms UI deletion updates with asynchronous background database reconciliation',
      'Eliminated redundant network queries and failed retries during routine deletion'
    ],
    fixes: [
      'Fixed foreign key constraint violation (smart_routine_completions_routine_id_fkey) during routine deletion',
      'Fixed deleted routines remaining visible in tomorrow\'s routine list',
      'Fixed failed remove operations when deleting tomorrow entries after parent routine is deleted',
      'Fixed orphaned completion records lingering after parent routine removal'
    ],
    security: [
      'Preserved strict Row-Level Security (RLS) enforcement on all routine deletion operations',
      'Cryptographically signed production APK with verified SHA-256 package integrity'
    ],
    isLocalInstalled: true
  },

  formatBuildNumber(code, rel) {
    if (rel && (rel.displayBuild || rel.buildLabel)) {
      return rel.displayBuild || rel.buildLabel.replace(/^Build\s+/i, '');
    }
    const num = parseInt(code, 10);
    if (num === 121) return '12.1';
    return String(code != null ? code : '');
  },

  setCachedManifest(newManifest) {
    if (!newManifest || newManifest.versionCode == null) return;
    const newCode = parseInt(newManifest.versionCode, 10);
    const currentCode = this.state.latestVersionCode || this.config.fallbackVersionCode;

    // Anti-downgrade / anti-stale guard: never overwrite with an older manifest
    if (this.state.manifest && currentCode > newCode) {
      console.warn(`[TasklyUpdateManager] Rejected stale manifest (code ${newCode} < current ${currentCode})`);
      return;
    }

    this.state.manifest = newManifest;
    this.state.latestVersionName = String(newManifest.latestVersion);
    this.state.latestVersionCode = newCode;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('taskly_cached_manifest', JSON.stringify(newManifest));
      } catch (_) {}
    }

    this.updateProfileBadge();
  },

  async loadInitialManifest() {
    // 1. Check cached manifest in localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        const cachedRaw = localStorage.getItem('taskly_cached_manifest');
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.versionCode != null && Array.isArray(cached.history) && cached.history.length > 0) {
            // Anti-stale: if cached manifest is older than fallback baseline, discard it
            if (parseInt(cached.versionCode, 10) >= this.config.fallbackVersionCode) {
              this.state.manifest = cached;
              this.state.latestVersionName = String(cached.latestVersion);
              this.state.latestVersionCode = parseInt(cached.versionCode, 10);
            } else {
              localStorage.removeItem('taskly_cached_manifest');
            }
          }
        }
      } catch (_) {}
    }

    // 2. Fetch authoritative manifest from local or remote endpoints
    try {
      const base = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') ||
                   (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
      const candidates = [
        `${base}/version-manifest.json`,
        `${base}/releases/version-manifest.json`,
        this.config.primaryManifestUrl
      ];

      for (const url of candidates) {
        if (!url) continue;
        try {
          const resp = await fetch(url + `?_cb=${Date.now()}`, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.latestVersion && data.versionCode != null && Array.isArray(data.history)) {
              this.setCachedManifest(data);
              break;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // 3. Fallback defaults if still null
    if (!this.state.manifest) {
      this.state.latestVersionName = this.config.fallbackVersionName;
      this.state.latestVersionCode = this.config.fallbackVersionCode;
    }
  },

  async init() {
    await this.loadInitialManifest();
    await this.detectInstalledVersion();
    this.updateProfileBadge();
    this.setupNativeListeners();
    this.checkPostUpgradeWhatsNew();
    this.checkUpdateAnnouncementOnStartup();

    // Restore cached lastChecked timestamp
    if (typeof localStorage !== 'undefined') {
      try {
        const cachedTime = localStorage.getItem('taskly_last_update_check');
        if (cachedTime) {
          this.state.lastChecked = new Date(cachedTime);
        }
      } catch (_) {}
    }
  },

  async detectInstalledVersion() {
    const isCapacitor = Boolean(
      (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) ||
      (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android') ||
      (typeof window !== 'undefined' && window.location?.protocol === 'capacitor:')
    );

    this.state.isNative = isCapacitor;
    this.state.platform = isCapacitor ? 'android' : 'web';

    // 1. Query custom native ApkInstaller plugin if available
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.ApkInstaller) {
      try {
        const info = await window.Capacitor.Plugins.ApkInstaller.getAppInfo();
        if (info && (info.versionName || info.versionCode != null)) {
          this.state.installedVersionName = String(info.versionName || this.config.fallbackVersionName);
          this.state.installedVersionCode = parseInt(info.versionCode, 10) || this.config.fallbackVersionCode;
          this.state.platform = 'android';
          this.updateProfileBadge();
          return;
        }
      } catch (err) {
        console.warn('[TasklyUpdateManager] Native ApkInstaller.getAppInfo failed, falling back:', err);
      }
    }

    // 2. Query standard Capacitor App plugin
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App) {
      try {
        const appInfo = await window.Capacitor.Plugins.App.getInfo();
        if (appInfo && appInfo.version) {
          this.state.installedVersionName = String(appInfo.version);
          this.state.installedVersionCode = parseInt(appInfo.build, 10) || this.config.fallbackVersionCode;
          this.updateProfileBadge();
          return;
        }
      } catch (err) {
        console.warn('[TasklyUpdateManager] App.getInfo failed, falling back to defaults:', err);
      }
    }

    // 3. Fallback for browser preview
    this.state.installedVersionName = this.config.fallbackVersionName;
    this.state.installedVersionCode = this.config.fallbackVersionCode;
    this.updateProfileBadge();
  },

  updateProfileBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('profile-version-badge');
    if (badge) {
      badge.textContent = `v${this.state.installedVersionName}`;
    }
  },

  setupNativeListeners() {
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.ApkInstaller?.addListener) {
      try {
        window.Capacitor.Plugins.ApkInstaller.addListener('downloadProgress', (data) => {
          this.handleDownloadProgress(data);
        });
      } catch (e) {
        console.warn('[TasklyUpdateManager] Failed to register downloadProgress listener:', e);
      }
    }
  },

  handleDownloadProgress(data) {
    if (!data) return;
    this.state.downloadProgress = {
      downloadedBytes: data.downloadedBytes || 0,
      totalBytes: data.totalBytes || 0,
      percent: data.percent != null ? data.percent : 0
    };
    this.renderUI();
  },

  async openModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-version');
    if (modal) modal.classList.add('active');

    await this.detectInstalledVersion();

    // Automatically check for updates if never checked or if check interval expired
    const now = Date.now();
    const shouldCheck = !this.state.lastChecked || (now - this.state.lastChecked.getTime() > this.config.autoCheckIntervalMs);
    if (shouldCheck && this.state.updateStatus !== 'downloading' && this.state.updateStatus !== 'installing') {
      await this.checkForUpdates(false);
    } else {
      this.renderUI();
    }
  },

  closeModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-version');
    if (modal) modal.classList.remove('active');
  },

  toggleHistory() {
    this.state.historyExpanded = !this.state.historyExpanded;
    this.renderUI();
  },

  getApprovedReleaseHistory() {
    let list = (this.state.manifest && Array.isArray(this.state.manifest.history) && this.state.manifest.history.length > 0)
      ? this.state.manifest.history
      : this.fallbackHistory;
    return [...list].sort((a, b) => (parseInt(b.versionCode, 10) || 0) - (parseInt(a.versionCode, 10) || 0));
  },

  getLatestApprovedRelease() {
    const approved = this.getApprovedReleaseHistory();
    if (approved.length > 0) return approved[0];
    return {
      version: this.state.latestVersionName || this.config.fallbackVersionName,
      versionName: this.state.latestVersionName || this.config.fallbackVersionName,
      versionCode: this.state.latestVersionCode || this.config.fallbackVersionCode
    };
  },

  getReleaseHistory() {
    const approved = this.getApprovedReleaseHistory();
    const installedCode = parseInt(this.state.installedVersionCode, 10) || 0;
    const latestApproved = this.getLatestApprovedRelease();
    const latestApprovedCode = parseInt(latestApproved.versionCode, 10) || 0;

    // Show currently installed version's local history entry when newer than latest approved
    if (this.localInstalledRelease && installedCode > latestApprovedCode) {
      const localCode = parseInt(this.localInstalledRelease.versionCode, 10);
      const alreadyInApproved = approved.some(r => parseInt(r.versionCode, 10) === localCode);
      if (!alreadyInApproved && installedCode >= localCode) {
        return [this.localInstalledRelease, ...approved];
      }
    }

    return approved;
  },

  getReleaseByVersion(versionOrCode) {
    const history = this.getReleaseHistory();
    let rel = null;
    if (versionOrCode == null) {
      const installedCode = parseInt(this.state.installedVersionCode, 10);
      rel = history.find(r => parseInt(r.versionCode, 10) === installedCode) || history[0] || null;
    } else {
      const strVal = String(versionOrCode).trim().replace(/^v/i, '');
      const numVal = parseInt(strVal, 10);
      rel = history.find(r => {
        if (!isNaN(numVal) && (r.versionCode === numVal || parseInt(r.versionCode, 10) === numVal)) {
          return true;
        }
        const v = String(r.versionName || r.version || '').replace(/^v/i, '');
        return v === strVal;
      });

      // Also check localInstalledRelease if not in history
      if (!rel && this.localInstalledRelease) {
        const localCode = parseInt(this.localInstalledRelease.versionCode, 10);
        if (!isNaN(numVal) && (localCode === numVal)) {
          rel = this.localInstalledRelease;
        } else {
          const lv = String(this.localInstalledRelease.versionName || this.localInstalledRelease.version || '').replace(/^v/i, '');
          if (lv === strVal) {
            rel = this.localInstalledRelease;
          }
        }
      }

      if (!rel) rel = history[0] || null;
    }

    if (!rel) return null;

    // Correct v1.5.0 historical release notes if loaded from a manifest containing placeholder "Approved production release"
    if (parseInt(rel.versionCode, 10) === 6) {
      const isPlaceholder = Array.isArray(rel.features) &&
        (rel.features.length === 0 || (rel.features.length === 1 && rel.features[0] === 'Approved production release'));
      if (isPlaceholder) {
        const approvedFallback = this.fallbackHistory.find(h => h.versionCode === 6);
        if (approvedFallback) {
          rel = {
            ...rel,
            title: (rel.title && rel.title !== 'Taskly v1.5.0') ? rel.title : approvedFallback.title,
            features: approvedFallback.features,
            improvements: (rel.improvements && rel.improvements.length > 0) ? rel.improvements : approvedFallback.improvements,
            performance: [],
            fixes: (rel.fixes && rel.fixes.length > 0) ? rel.fixes : approvedFallback.fixes,
            security: (rel.security && rel.security.length > 0) ? rel.security : approvedFallback.security
          };
        }
      }
    }

    return rel;
  },

  openWhatsNew(versionOrCode = null) {
    if (typeof document === 'undefined') return;
    const history = this.getReleaseHistory();
    const installedCode = parseInt(this.state.installedVersionCode, 10);
    const latestApproved = this.getLatestApprovedRelease();
    const latestApprovedCode = parseInt(latestApproved.versionCode, 10);

    // If no version specified, default to currently installed version if it exists in history,
    // otherwise fallback to latest approved release
    let defaultCode = latestApprovedCode;
    if (history.some(r => parseInt(r.versionCode, 10) === installedCode)) {
      defaultCode = installedCode;
    } else if (history[0]) {
      defaultCode = parseInt(history[0].versionCode, 10);
    }

    const targetCode = (versionOrCode != null) ? versionOrCode : defaultCode;
    const release = this.getReleaseByVersion(targetCode);
    this.state.activeWhatsNewVersionCode = release ? release.versionCode : targetCode;

    this.populateWhatsNewVersionSelect();
    this.renderWhatsNew(this.state.activeWhatsNewVersionCode);

    const modal = document.getElementById('modal-whats-new');
    if (modal) modal.classList.add('active');
  },

  closeWhatsNew() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-whats-new');
    if (modal) modal.classList.remove('active');
  },

  dismissWhatsNew() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.config.storageKeyWhatsNewSeen, String(this.state.installedVersionCode));
      } catch (_) {}
    }
    this.closeWhatsNew();
  },

  checkPostUpgradeWhatsNew() {
    if (typeof localStorage === 'undefined') return;
    try {
      const lastSeen = localStorage.getItem(this.config.storageKeyWhatsNewSeen);
      const currentCode = this.state.installedVersionCode || this.config.fallbackVersionCode;
      if (lastSeen === null) {
        // First app installation on this device: register version without popping up
        localStorage.setItem(this.config.storageKeyWhatsNewSeen, String(currentCode));
        return;
      }
      const lastSeenCode = parseInt(lastSeen, 10);
      if (!isNaN(lastSeenCode) && currentCode > lastSeenCode) {
        // Just upgraded to a newer APK! Show What's New once for the newly installed release
        this.openWhatsNew(currentCode);
        localStorage.setItem(this.config.storageKeyWhatsNewSeen, String(currentCode));
      }
    } catch (e) {
      console.warn('[TasklyUpdateManager] checkPostUpgradeWhatsNew error:', e);
    }
  },

  populateWhatsNewVersionSelect() {
    if (typeof document === 'undefined') return;
    const select = document.getElementById('select-whats-new-version');
    if (!select) return;
    select.innerHTML = '';
    const history = this.getReleaseHistory();
    const latestApproved = this.getLatestApprovedRelease();
    const latestApprovedCode = parseInt(latestApproved.versionCode, 10);
    const installedCode = parseInt(this.state.installedVersionCode, 10);

    history.forEach((rel) => {
      const opt = document.createElement('option');
      const relCode = parseInt(rel.versionCode, 10);
      opt.value = String(relCode);
      const isApprovedLatest = (relCode === latestApprovedCode);
      const isInstalled = (relCode === installedCode);
      const displayBuild = this.formatBuildNumber(relCode, rel);
      let label = `v${rel.versionName || rel.version} (Build ${displayBuild})`;

      if (isInstalled && isApprovedLatest) {
        label += ' — Latest & Installed';
      } else if (isInstalled && relCode > latestApprovedCode) {
        label += ' — Current Installed';
      } else if (isApprovedLatest) {
        label += ' — Latest Approved';
      } else if (isInstalled) {
        label += ' — Installed';
      }
      opt.textContent = label;
      if (relCode === parseInt(this.state.activeWhatsNewVersionCode, 10)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  },

  renderWhatsNew(versionOrCode = null) {
    if (typeof document === 'undefined') return;
    const rel = this.getReleaseByVersion(versionOrCode || this.state.activeWhatsNewVersionCode);
    if (!rel) return;
    this.state.activeWhatsNewVersionCode = rel.versionCode;

    // Sync select element
    const select = document.getElementById('select-whats-new-version');
    if (select && select.value !== String(rel.versionCode)) {
      select.value = String(rel.versionCode);
    }

    // Installed vs Selected Version Diff Banner
    const diffBanner = document.getElementById('whats-new-diff-banner');
    const diffIcon = document.getElementById('whats-new-diff-icon');
    const diffText = document.getElementById('whats-new-diff-text');
    if (diffBanner && diffIcon && diffText) {
      diffBanner.className = 'whats-new-diff-banner';
      const instBuild = this.formatBuildNumber(this.state.installedVersionCode);
      const relBuild = this.formatBuildNumber(rel.versionCode, rel);
      if (rel.versionCode > this.state.installedVersionCode) {
        diffBanner.classList.add('diff-upgrade-available');
        diffIcon.textContent = '📥';
        diffText.innerHTML = `<strong>Upgrade Available:</strong> You are currently on <strong>v${this.state.installedVersionName} (Build ${instBuild})</strong>. Upgrading to <strong>v${rel.versionName || rel.version}</strong> brings the improvements shown below.`;
      } else if (rel.versionCode === this.state.installedVersionCode) {
        diffBanner.classList.add('diff-current-installed');
        diffIcon.textContent = '✓';
        diffText.innerHTML = `<strong>Installed Version:</strong> You are running <strong>v${this.state.installedVersionName} (Build ${instBuild})</strong>. All features below are active on your device.`;
      } else {
        diffBanner.classList.add('diff-older-version');
        diffIcon.textContent = '⏮️';
        diffText.innerHTML = `<strong>Historical Release:</strong> Showing notes for <strong>v${rel.versionName || rel.version} (Build ${relBuild})</strong>. Your device is running newer <strong>v${this.state.installedVersionName} (Build ${instBuild})</strong>.`;
      }
    }

    // Hero Card
    const heroPill = document.getElementById('whats-new-hero-version-pill');
    if (heroPill) heroPill.textContent = `Version ${rel.versionName || rel.version} (Build ${this.formatBuildNumber(rel.versionCode, rel)})`;

    const heroDate = document.getElementById('whats-new-hero-date');
    if (heroDate) heroDate.textContent = rel.releaseDate || '';

    const heroTitle = document.getElementById('whats-new-hero-title');
    if (heroTitle) heroTitle.textContent = rel.title || `Taskly v${rel.versionName || rel.version}`;

    const heroSummary = document.getElementById('whats-new-hero-summary');
    if (heroSummary) heroSummary.textContent = rel.summary || 'Official production release notes.';

    // Categorized Release Notes (5 buckets)
    const categoriesContainer = document.getElementById('whats-new-categories-container');
    const emptyState = document.getElementById('whats-new-empty-state');
    if (categoriesContainer) {
      categoriesContainer.innerHTML = '';
      const buckets = [
        { key: 'features', title: 'New Features', icon: '🚀', className: 'cat-features' },
        { key: 'improvements', title: 'Improvements', icon: '⚡', className: 'cat-improvements' },
        { key: 'performance', title: 'Performance Enhancements', icon: '🏎️', className: 'cat-performance' },
        { key: 'fixes', title: 'Bug Fixes', icon: '🐞', className: 'cat-fixes' },
        { key: 'security', title: 'Security & Reliability', icon: '🛡️', className: 'cat-security' }
      ];

      let totalItems = 0;
      buckets.forEach(bucket => {
        const items = rel[bucket.key];
        if (Array.isArray(items) && items.length > 0) {
          totalItems += items.length;
          const catCard = document.createElement('div');
          catCard.className = `whats-new-cat-card ${bucket.className}`;

          const catHead = document.createElement('div');
          catHead.className = 'whats-new-cat-head';
          const badge = document.createElement('span');
          badge.className = 'whats-new-cat-badge';
          badge.textContent = `${bucket.icon} ${bucket.title}`;
          catHead.appendChild(badge);
          catCard.appendChild(catHead);

          const itemsWrap = document.createElement('div');
          itemsWrap.className = 'whats-new-cat-items';

          items.forEach(item => {
            if (typeof item === 'string') {
              const itemRow = document.createElement('div');
              itemRow.className = 'whats-new-item-simple';
              const dot = document.createElement('span');
              dot.className = 'whats-new-item-bullet';
              dot.textContent = '•';
              const txt = document.createElement('span');
              txt.className = 'whats-new-item-text';
              txt.textContent = item;
              itemRow.appendChild(dot);
              itemRow.appendChild(txt);
              itemsWrap.appendChild(itemRow);
            } else if (item && typeof item === 'object') {
              const itemCard = document.createElement('div');
              itemCard.className = 'whats-new-item-rich';
              if (item.title) {
                const itemTitle = document.createElement('div');
                itemTitle.className = 'whats-new-rich-title';
                itemTitle.textContent = item.title;
                itemCard.appendChild(itemTitle);
              }
              if (item.description) {
                const itemDesc = document.createElement('div');
                itemDesc.className = 'whats-new-rich-desc';
                itemDesc.textContent = item.description;
                itemCard.appendChild(itemDesc);
              }
              if (item.benefit) {
                const itemBenefit = document.createElement('div');
                itemBenefit.className = 'whats-new-rich-benefit';
                const benefitPill = document.createElement('span');
                benefitPill.className = 'benefit-pill';
                benefitPill.textContent = `💡 User Benefit: ${item.benefit}`;
                itemBenefit.appendChild(benefitPill);
                itemCard.appendChild(itemBenefit);
              }
              itemsWrap.appendChild(itemCard);
            }
          });

          catCard.appendChild(itemsWrap);
          categoriesContainer.appendChild(catCard);
        }
      });

      if (emptyState) {
        emptyState.style.display = totalItems === 0 ? 'flex' : 'none';
      }
    }
  },

  /**
   * Compare version codes numerically.
   * Remote version code strictly greater than installed version code indicates update available.
   */
  isUpdateAvailable(installedCode, remoteCode) {
    const installed = parseInt(installedCode, 10);
    const remote = parseInt(remoteCode, 10);
    if (isNaN(installed) || isNaN(remote)) return false;
    return remote > installed;
  },

  async checkForUpdates(forceManual = false) {
    this.state.updateStatus = 'checking';
    this.state.errorMessage = null;
    this.renderUI();

    let manifest = null;
    let fetchError = null;

    const cacheBuster = `?_cb=${Date.now()}`;

    // 1. Try remote centralized HTTPS manifest
    try {
      const resp = await fetch(this.config.primaryManifestUrl + cacheBuster, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (resp.ok) {
        manifest = await resp.json();
      } else {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
    } catch (err) {
      console.warn('[TasklyUpdateManager] Remote manifest fetch failed, falling back to local endpoint:', err);
      fetchError = err;
    }

    // 2. If remote unreachable, try local fallback endpoint
    if (!manifest) {
      try {
        const base = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') ||
                     (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost:3000');
        const fallbackUrl = this.config.localFallbackUrl.startsWith('http')
          ? this.config.localFallbackUrl
          : `${base.replace(/\/+$/, '')}${this.config.localFallbackUrl}`;

        const localResp = await fetch(fallbackUrl + cacheBuster, {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });
        if (localResp.ok) {
          manifest = await localResp.json();
          fetchError = null;
        } else {
          throw new Error(`Local fallback HTTP ${localResp.status}`);
        }
      } catch (localErr) {
        console.warn('[TasklyUpdateManager] Local fallback manifest fetch failed:', localErr);
        if (!fetchError) fetchError = localErr;
      }
    }

    // 3. Strict failure handling: Never claim "up to date" if check failed
    if (!manifest) {
      this.state.updateStatus = 'error';
      this.state.errorMessage = (fetchError && fetchError.message)
        ? `Unable to connect to Taskly update server (${fetchError.message}). Please check your internet connection.`
        : 'Unable to connect to Taskly update server. Please check your internet connection.';
      this.renderUI();
      return;
    }

    // 4. Validate manifest fields
    if (!manifest.latestVersion || manifest.versionCode == null) {
      this.state.updateStatus = 'error';
      this.state.errorMessage = 'Invalid or malformed update manifest received from server.';
      this.renderUI();
      return;
    }

    this.setCachedManifest(manifest);
    this.state.lastChecked = new Date();

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('taskly_last_update_check', this.state.lastChecked.toISOString());
      } catch (_) {}
    }

    // 5. Compare versionCode numerically
    const hasUpdate = this.isUpdateAvailable(this.state.installedVersionCode, this.state.latestVersionCode);
    if (hasUpdate) {
      this.state.updateStatus = 'update_available';
    } else {
      this.state.updateStatus = 'up_to_date';
    }

    this.renderUI();
  },

  async startUpdate() {
    if (this.state.updateStatus !== 'update_available' || !this.state.manifest) {
      return;
    }

    const manifest = this.state.manifest;

    // A. Native Android In-App APK Download and Installation
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.ApkInstaller) {
      const plugin = window.Capacitor.Plugins.ApkInstaller;

      // 1. Check install permission
      try {
        const permResult = await plugin.canRequestPackageInstalls();
        if (permResult && permResult.canInstall === false) {
          const proceed = (typeof confirm === 'function')
            ? confirm(
                'Taskly needs permission to install app updates.\n\nTap OK to open Android Settings and enable "Allow from this source", then return to Taskly to complete the update.'
              )
            : true;
          if (proceed) {
            await plugin.openInstallPermissionSettings();
          }
          return;
        }
      } catch (permErr) {
        console.warn('[TasklyUpdateManager] canRequestPackageInstalls check error:', permErr);
      }

      // 2. Start native download and verification
      this.state.updateStatus = 'downloading';
      this.state.errorMessage = null;
      this.state.downloadProgress = {
        downloadedBytes: 0,
        totalBytes: manifest.fileSizeBytes || 0,
        percent: 0
      };
      this.renderUI();

      try {
        const installResult = await plugin.downloadAndInstall({
          url: manifest.apkDownloadUrl,
          sha256: manifest.sha256,
          expectedPackageName: this.config.expectedPackageName,
          expectedVersionCode: manifest.versionCode
        });

        if (installResult && installResult.cancelled) {
          this.state.updateStatus = 'update_available';
          this.renderUI();
          return;
        }

        this.state.updateStatus = 'installing';
        this.renderUI();
      } catch (installErr) {
        console.error('[TasklyUpdateManager] Native update installation failed:', installErr);
        this.state.updateStatus = 'error';
        this.state.errorMessage = (installErr && installErr.message) ? installErr.message : String(installErr);
        this.renderUI();
      }
      return;
    }

    // B. Web Browser Fallback (Opens direct APK link)
    if (manifest.apkDownloadUrl) {
      const shouldDownload = (typeof confirm === 'function')
        ? confirm(
            `Download Taskly v${manifest.latestVersion} APK (${manifest.fileSize || '18 MB'})?\n\nNote: On Android devices, Taskly downloads and updates directly in-app. In web browsers, this downloads the APK file to your device.`
          )
        : true;
      if (shouldDownload && typeof window !== 'undefined') {
        window.open(manifest.apkDownloadUrl, '_blank');
      }
    }
  },

  async cancelDownload() {
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.ApkInstaller) {
      try {
        await window.Capacitor.Plugins.ApkInstaller.cancelDownload();
      } catch (_) {}
    }
    this.state.updateStatus = 'update_available';
    this.state.downloadProgress = { downloadedBytes: 0, totalBytes: 0, percent: 0 };
    this.renderUI();
  },

  formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  },

  formatRelativeTime(date) {
    if (!date) return 'Never';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 30) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  renderUI() {
    if (typeof document === 'undefined') return;

    // Platform indicator
    const platformLabel = document.getElementById('version-platform-label');
    if (platformLabel) {
      platformLabel.textContent = this.state.isNative ? 'Android Native Application' : 'Web Browser Preview';
    }

    // Installed version
    const valInstalled = document.getElementById('val-installed-version');
    if (valInstalled) {
      const instBuild = this.formatBuildNumber(this.state.installedVersionCode);
      valInstalled.textContent = `v${this.state.installedVersionName} (Build ${instBuild})`;
    }

    // Latest approved version
    const valLatest = document.getElementById('val-latest-version');
    if (valLatest) {
      const latestApproved = this.getLatestApprovedRelease();
      const latestName = (latestApproved && (latestApproved.versionName || latestApproved.version)) || this.state.latestVersionName || this.config.fallbackVersionName;
      const latestCode = (latestApproved && latestApproved.versionCode) || this.state.latestVersionCode || this.config.fallbackVersionCode;
      const latestBuild = this.formatBuildNumber(latestCode, latestApproved);
      valLatest.textContent = `v${latestName} (Build ${latestBuild})`;
    }

    // Last checked timestamp
    const labelLastChecked = document.getElementById('version-last-checked-label');
    if (labelLastChecked) {
      labelLastChecked.textContent = `Last checked: ${this.formatRelativeTime(this.state.lastChecked)}`;
    }

    // Status Badge & Icon
    const badge = document.getElementById('version-status-badge');
    const statusIcon = document.getElementById('version-status-icon');
    const statusText = document.getElementById('version-status-text');

    if (badge && statusIcon && statusText) {
      badge.className = 'version-status-badge';
      switch (this.state.updateStatus) {
        case 'checking':
          badge.classList.add('status-checking');
          statusIcon.textContent = '⏳';
          statusText.textContent = 'Checking for updates...';
          break;
        case 'update_available':
          badge.classList.add('status-update-available');
          statusIcon.textContent = '📥';
          statusText.textContent = 'Update Available';
          break;
        case 'downloading':
          badge.classList.add('status-downloading');
          statusIcon.textContent = '⬇️';
          statusText.textContent = `Downloading (${this.state.downloadProgress.percent}%)`;
          break;
        case 'installing':
          badge.classList.add('status-up-to-date');
          statusIcon.textContent = '⚙️';
          statusText.textContent = 'Installing...';
          break;
        case 'error':
          badge.classList.add('status-error');
          statusIcon.textContent = '⚠️';
          statusText.textContent = 'Check Failed';
          break;
        case 'up_to_date':
        default:
          badge.classList.add('status-up-to-date');
          statusIcon.textContent = '✓';
          statusText.textContent = "You're up to date";
          break;
      }
    }

    // Update Details Card
    const cardUpdate = document.getElementById('version-update-details-card');
    if (cardUpdate) {
      if (this.state.updateStatus === 'update_available' && this.state.manifest) {
        cardUpdate.style.display = 'flex';
        const meta = document.getElementById('version-update-meta');
        if (meta) {
          meta.textContent = `Version ${this.state.manifest.latestVersion} • ${this.state.manifest.fileSize || '18 MB'}${this.state.manifest.releaseDate ? ' • ' + this.state.manifest.releaseDate : ''}`;
        }
        const summary = document.getElementById('version-update-summary');
        if (summary) {
          summary.textContent = this.state.manifest.releaseNotes || 'A new approved version of Taskly is ready for you.';
        }
        const highlightsList = document.getElementById('version-update-highlights');
        if (highlightsList) {
          highlightsList.innerHTML = '';
          const features = (this.state.manifest.history && this.state.manifest.history[0]?.features) || [
            'Performance optimizations and stability improvements',
            'Enhanced data protection and synchronization'
          ];
          features.slice(0, 4).forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            highlightsList.appendChild(li);
          });
        }
        const mandatoryNotice = document.getElementById('version-mandatory-notice');
        if (mandatoryNotice) {
          mandatoryNotice.style.display = this.state.manifest.mandatoryUpdate ? 'block' : 'none';
        }
      } else {
        cardUpdate.style.display = 'none';
      }
    }

    // Download Progress Card
    const cardProgress = document.getElementById('version-progress-card');
    if (cardProgress) {
      if (this.state.updateStatus === 'downloading') {
        cardProgress.style.display = 'flex';
        const percent = this.state.downloadProgress.percent;
        const fill = document.getElementById('version-progress-fill');
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        const percentText = document.getElementById('version-progress-percent');
        if (percentText) percentText.textContent = `${percent}%`;
        const bytesText = document.getElementById('version-progress-bytes');
        if (bytesText) {
          bytesText.textContent = `${this.formatBytes(this.state.downloadProgress.downloadedBytes)} / ${this.formatBytes(this.state.downloadProgress.totalBytes)}`;
        }
      } else {
        cardProgress.style.display = 'none';
      }
    }

    // Install Card
    const cardInstall = document.getElementById('version-install-card');
    if (cardInstall) {
      cardInstall.style.display = this.state.updateStatus === 'installing' ? 'flex' : 'none';
    }

    // Error Banner
    const bannerError = document.getElementById('version-error-banner');
    if (bannerError) {
      if (this.state.updateStatus === 'error' && this.state.errorMessage) {
        bannerError.style.display = 'flex';
        const msg = document.getElementById('version-error-msg');
        if (msg) msg.textContent = this.state.errorMessage;
      } else {
        bannerError.style.display = 'none';
      }
    }

    // Action Buttons
    const btnUpdate = document.getElementById('btn-update-now');
    if (btnUpdate) {
      btnUpdate.style.display = this.state.updateStatus === 'update_available' ? 'inline-flex' : 'none';
    }
    const labelCheck = document.getElementById('label-check-updates');
    if (labelCheck) {
      labelCheck.textContent = this.state.updateStatus === 'checking'
        ? 'Checking...'
        : (this.state.updateStatus === 'error' ? 'Retry Check' : 'Check for Updates');
    }

    // Update What's New banner subtitle in Version Modal
    const whatsNewBannerSub = document.getElementById('whats-new-banner-subtitle');
    if (whatsNewBannerSub) {
      const installedRel = this.getReleaseByVersion(this.state.installedVersionCode);
      const latestRel = this.getLatestApprovedRelease();
      const displayRel = installedRel || latestRel;
      whatsNewBannerSub.textContent = displayRel
        ? `v${displayRel.versionName || displayRel.version} • ${displayRel.title || 'Latest features & updates'}`
        : 'Explore everything introduced in recent updates.';
    }

    // Render History Timeline
    const historyBody = document.getElementById('version-history-body');
    const chevron = document.getElementById('history-toggle-chevron');
    if (historyBody) {
      historyBody.style.display = this.state.historyExpanded ? 'block' : 'none';
    }
    if (chevron) {
      chevron.textContent = this.state.historyExpanded ? '▲' : '▼';
    }

    const historyList = document.getElementById('version-history-list');
    const history = this.getReleaseHistory();
    const latestApproved = this.getLatestApprovedRelease();
    const latestApprovedCode = parseInt(latestApproved.versionCode, 10);
    const installedCode = parseInt(this.state.installedVersionCode, 10);

    if (historyList && history.length > 0) {
      historyList.innerHTML = '';
      history.forEach((rel) => {
        const relCode = parseInt(rel.versionCode, 10);
        const isCurrentInstalled = (relCode === installedCode && relCode > latestApprovedCode);
        const isApprovedLatest = (relCode === latestApprovedCode);
        const isInstalled = (relCode === installedCode);

        const item = document.createElement('div');
        item.className = 'history-item';
        if (isApprovedLatest) {
          item.classList.add('history-item-latest');
        }
        if (isCurrentInstalled) {
          item.classList.add('history-item-current-installed');
        }

        const head = document.createElement('div');
        head.className = 'history-item-head';

        const verWrap = document.createElement('div');
        verWrap.className = 'history-head-ver-wrap';

        const ver = document.createElement('span');
        ver.className = 'history-version-tag';
        ver.textContent = `v${rel.versionName || rel.version} (Build ${this.formatBuildNumber(rel.versionCode, rel)})`;
        verWrap.appendChild(ver);

        if (isCurrentInstalled) {
          const curBadge = document.createElement('span');
          curBadge.className = 'badge-installed-release badge-current-installed';
          curBadge.textContent = '✓ CURRENT INSTALLED';
          verWrap.appendChild(curBadge);
        } else if (isApprovedLatest && isInstalled) {
          const latestBadge = document.createElement('span');
          latestBadge.className = 'badge-latest-release';
          latestBadge.textContent = '🌟 Latest & Installed';
          verWrap.appendChild(latestBadge);
        } else if (isApprovedLatest) {
          const latestBadge = document.createElement('span');
          latestBadge.className = 'badge-latest-release';
          latestBadge.textContent = '🌟 Latest Approved';
          verWrap.appendChild(latestBadge);
        } else if (isInstalled) {
          const installedBadge = document.createElement('span');
          installedBadge.className = 'badge-installed-release';
          installedBadge.textContent = '✓ Installed';
          verWrap.appendChild(installedBadge);
        }

        const date = document.createElement('span');
        date.className = 'history-date-tag';
        date.textContent = rel.releaseDate || '';

        head.appendChild(verWrap);
        head.appendChild(date);
        item.appendChild(head);

        if (rel.title) {
          const title = document.createElement('div');
          title.className = 'history-item-title';
          title.textContent = rel.title;
          item.appendChild(title);
        }

        if (rel.summary) {
          const summary = document.createElement('div');
          summary.className = 'history-summary';
          summary.textContent = rel.summary;
          item.appendChild(summary);
        }

        if (rel.features && rel.features.length > 0) {
          const ul = document.createElement('ul');
          ul.className = 'history-features-list';
          rel.features.slice(0, 3).forEach(feat => {
            const li = document.createElement('li');
            li.textContent = typeof feat === 'string' ? feat : (feat.title || feat.description || '');
            ul.appendChild(li);
          });
          item.appendChild(ul);
        }

        // Dedicated What's New trigger for this historical version
        const whatsNewBtnRow = document.createElement('div');
        whatsNewBtnRow.className = 'history-actions-row';
        const btnViewWhatsNew = document.createElement('button');
        btnViewWhatsNew.type = 'button';
        btnViewWhatsNew.className = 'btn-history-whats-new';
        btnViewWhatsNew.textContent = "✨ What's New in this version";
        btnViewWhatsNew.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openWhatsNew(rel.versionCode);
        });
        whatsNewBtnRow.appendChild(btnViewWhatsNew);
        item.appendChild(whatsNewBtnRow);

        historyList.appendChild(item);
      });
    }
  },

  showUpdateAnnouncement(release = null, isPreview = false) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-update-announcement');
    if (!modal) return;

    let targetRelease = release;
    if (!targetRelease) {
      const latestApproved = this.getLatestApprovedRelease();
      const installedCode = parseInt(this.state.installedVersionCode, 10) || 0;
      const latestCode = parseInt(latestApproved.versionCode, 10) || 0;
      if (latestCode > installedCode) {
        targetRelease = latestApproved;
      } else if (this.localInstalledRelease) {
        targetRelease = this.localInstalledRelease;
      } else {
        targetRelease = latestApproved;
      }
    }

    this._currentAnnouncedRelease = targetRelease;
    this._isAnnouncementPreview = isPreview;

    const elInstalled = document.getElementById('announcement-installed-version');
    if (elInstalled) {
      const instBuild = this.formatBuildNumber(this.state.installedVersionCode || 12);
      elInstalled.textContent = `v${this.state.installedVersionName || '2.1.0'} (Build ${instBuild})`;
    }

    const elAvailable = document.getElementById('announcement-available-version');
    if (elAvailable) {
      const verName = targetRelease.versionName || targetRelease.version || '2.1.1';
      const verCode = targetRelease.versionCode || 121;
      const targetBuild = this.formatBuildNumber(verCode, targetRelease);
      elAvailable.textContent = `v${verName} (Build ${targetBuild})`;
    }

    const list = document.getElementById('announcement-highlights-list');
    if (list) {
      list.innerHTML = '';
      const feats = Array.isArray(targetRelease.features) && targetRelease.features.length > 0
        ? targetRelease.features
        : (targetRelease.summary ? [targetRelease.summary] : ['New features and performance improvements']);

      feats.slice(0, 4).forEach(feat => {
        const li = document.createElement('li');
        li.textContent = typeof feat === 'string' ? feat : (feat.title || feat.description || '');
        list.appendChild(li);
      });
    }

    modal.classList.add('active');
    modal.style.display = 'flex';
  },

  dismissUpdateAnnouncement() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-update-announcement');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }

    if (!this._isAnnouncementPreview && this._currentAnnouncedRelease) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('taskly_dismissed_update_announcement', String(this._currentAnnouncedRelease.versionCode));
        }
      } catch (_) {}
    }
  },

  handleInstallNowFromAnnouncement() {
    this.dismissUpdateAnnouncement();
    this.openModal();
    if (this.state.updateStatus === 'update_available' || this.state.updateStatus === 'ready') {
      this.startUpdate();
    }
  },

  checkUpdateAnnouncementOnStartup() {
    try {
      const latestApproved = this.getLatestApprovedRelease();
      const installedCode = parseInt(this.state.installedVersionCode, 10) || 0;
      const latestCode = parseInt(latestApproved.versionCode, 10) || 0;

      // Only prompt when an approved production release has higher versionCode than installed
      if (latestCode > installedCode) {
        let dismissedCode = null;
        if (typeof localStorage !== 'undefined') {
          dismissedCode = localStorage.getItem('taskly_dismissed_update_announcement');
        }
        if (dismissedCode !== String(latestCode)) {
          this.showUpdateAnnouncement(latestApproved, false);
          this.scheduleUpdateNotification(latestApproved);
        }
      }
    } catch (e) {
      console.warn('[TasklyUpdateManager] checkUpdateAnnouncementOnStartup error:', e);
    }
  },

  async scheduleUpdateNotification(release) {
    if (!release) return;
    try {
      if (typeof localStorage !== 'undefined') {
        const lastNotified = localStorage.getItem('taskly_last_notified_update_code');
        if (lastNotified === String(release.versionCode)) {
          return;
        }
      }
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.LocalNotifications) {
        // Guard: Never send update notification for debug/internal builds or non-production releases
        const isDebug = Boolean(
          window.location?.hostname === 'localhost' ||
          window.location?.hostname === '127.0.0.1' ||
          release.isLocalInstalled
        );
        if (isDebug) return;

        const perm = await window.Capacitor.Plugins.LocalNotifications.checkPermissions();
        if (perm && perm.display !== 'granted') {
          const req = await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
          if (req && req.display !== 'granted') return;
        }

        await window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [
            {
              title: 'Taskly Update Ready',
              body: `Taskly v${release.versionName || release.version} is now available. Tap to install.`,
              id: 990002,
              channelId: 'taskly-reminders-v3',
              smallIcon: 'ic_stat_paw',
              schedule: { at: new Date(Date.now() + 5000) }
            }
          ]
        });

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('taskly_last_notified_update_code', String(release.versionCode));
        }
      }
    } catch (e) {
      console.warn('[TasklyUpdateManager] scheduleUpdateNotification failed:', e);
    }
  }
};

if (typeof window !== 'undefined') {
  window.TasklyUpdateManager = TasklyUpdateManager;
}

// ==========================================================================
// Smart Lists Manager (v1.9.0 Build 10)
// ==========================================================================
const SmartListsManager = {
  NOTIFICATION_ID: 990001,
  STORAGE_KEY_ROUTINES: 'taskly_smart_routines',
  STORAGE_KEY_COMPLETIONS: 'taskly_smart_completions',
  STORAGE_KEY_REPORTS: 'taskly_smart_reports',
  STORAGE_KEY_SETTINGS: 'taskly_smart_settings',

  state: {
    routines: [],
    completions: {}, // map of `${routineId}_${date}` -> { status, completed, carriedForward, postponedToDate, cancellationReason }
    reports: [],
    settings: {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00'
    },
    streaks: {
      currentStreak: 0,
      longestStreak: 0,
      qualifyingDaysCount: 0
    },
    consistency: {
      weekly: { totalDays: 0, qualifyingDays: 0, percentage: 0 },
      monthly: { totalDays: 0, qualifyingDays: 0, percentage: 0 }
    },
    dailyStats: {
      date: null,
      totalCount: 0,
      eligibleCount: 0,
      completedCount: 0,
      pendingCount: 0,
      postponedCount: 0,
      cancelledCount: 0,
      completionRate: 0,
      isQualified: false
    },
    activeDate: (typeof toYmdString === 'function') ? toYmdString(new Date()) : new Date().toISOString().slice(0, 10),
    activeReportDate: null,
    pendingDeleteType: null,
    pendingDeleteId: null,
    pendingStatusRoutineId: null,
    pendingStatusDate: null,
    pendingStatusSelection: null,
    tomorrowRoutines: [],
    tomorrowDate: null,
    pendingRemoveTomorrowId: null,
    pendingRemoveTomorrowTitle: '',
    pendingEditTomorrowId: null,
    isUpdatingStatus: false,
    isLoadingStats: false,
    isInitialized: false
  },

  async init() {
    this.state.activeDate = (typeof toYmdString === 'function') ? toYmdString(new Date()) : new Date().toISOString().slice(0, 10);
    this.loadFromStorage();
    this.computeLocalStreaksAndStats(this.state.activeDate);
    if (isAuthenticated()) {
      await this.syncAll().catch(err => console.warn('[SmartLists] Sync error:', err));
    }
    await this.fetchTomorrowRoutines().catch(() => {});
    await this.scheduleDailySummaryReminder().catch(err => console.warn('[SmartLists] Reminder schedule error:', err));
    this.state.isInitialized = true;
  },

  loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const r = localStorage.getItem(this.STORAGE_KEY_ROUTINES);
      if (r) this.state.routines = JSON.parse(r);

      const c = localStorage.getItem(this.STORAGE_KEY_COMPLETIONS);
      if (c) this.state.completions = JSON.parse(c);

      const rep = localStorage.getItem(this.STORAGE_KEY_REPORTS);
      if (rep) {
        const parsed = JSON.parse(rep);
        if (Array.isArray(parsed)) {
          this.state.reports = parsed.map(r => this.normalizeReport(r)).filter(Boolean);
        }
      }

      const s = localStorage.getItem(this.STORAGE_KEY_SETTINGS);
      if (s) this.state.settings = JSON.parse(s);
    } catch (e) {
      console.warn('[SmartLists] Storage load error:', e);
    }
  },

  saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.STORAGE_KEY_ROUTINES, JSON.stringify(this.state.routines));
      localStorage.setItem(this.STORAGE_KEY_COMPLETIONS, JSON.stringify(this.state.completions));
      localStorage.setItem(this.STORAGE_KEY_REPORTS, JSON.stringify(this.state.reports));
      localStorage.setItem(this.STORAGE_KEY_SETTINGS, JSON.stringify(this.state.settings));
    } catch (e) {
      console.warn('[SmartLists] Storage save error:', e);
    }
  },

  clearLocalState() {
    this.state.routines = [];
    this.state.completions = {};
    this.state.reports = [];
    this.state.streaks = { currentStreak: 0, longestStreak: 0, qualifyingDaysCount: 0 };
    this.state.consistency = {
      weekly: { totalDays: 0, qualifyingDays: 0, percentage: 0 },
      monthly: { totalDays: 0, qualifyingDays: 0, percentage: 0 }
    };
    this.state.dailyStats = {
      date: null,
      totalCount: 0,
      eligibleCount: 0,
      completedCount: 0,
      pendingCount: 0,
      postponedCount: 0,
      cancelledCount: 0,
      completionRate: 0,
      isQualified: false
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.STORAGE_KEY_ROUTINES);
        localStorage.removeItem(this.STORAGE_KEY_COMPLETIONS);
        localStorage.removeItem(this.STORAGE_KEY_REPORTS);
        localStorage.removeItem(this.STORAGE_KEY_SETTINGS);
      }
    } catch (_) {}
  },

  async syncAll() {
    await Promise.all([
      this.fetchRoutines(),
      this.fetchCompletions(this.state.activeDate),
      this.fetchReports(),
      this.fetchSettings(),
      this.fetchStreaksAndStats(this.state.activeDate)
    ]);
  },

  // --- Routines CRUD ---
  async fetchRoutines() {
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data, error } = await supabaseClient
          .from('smart_routines')
          .select('*')
          .eq('user_id', state.user.id)
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: true });
        if (!error && Array.isArray(data)) {
          const existingMap = new Map((this.state.routines || []).map(r => [r.id, r]));
          this.state.routines = data.map(r => {
            const existing = existingMap.get(r.id);
            let inferredStartDate = existing?.startDate || null;
            let inferredEndDate = existing?.endDate || null;
            let inferredRecurrence = existing?.recurrence || (inferredEndDate ? 'once' : 'daily');
            if (!inferredStartDate || (inferredEndDate === undefined)) {
              Object.entries(this.state.completions || {}).forEach(([k, c]) => {
                if (k.startsWith(`${r.id}_`)) {
                  const cDate = k.slice(r.id.length + 1);
                  const reason = c?.cancellationReason || c?.cancellation_reason;
                  if (reason === 'tomorrow_only' || reason === 'one_day_assignment') {
                    const nextDay = SmartListsManager.getNextDayYmd(cDate);
                    inferredStartDate = nextDay;
                    inferredEndDate = nextDay;
                    inferredRecurrence = 'once';
                  } else if (reason === 'created_for_future') {
                    const nextDay = SmartListsManager.getNextDayYmd(cDate);
                    inferredStartDate = nextDay;
                    inferredEndDate = null;
                    inferredRecurrence = 'daily';
                  }
                }
              });
            }
            return {
              id: r.id,
              title: r.title,
              orderIndex: r.order_index !== undefined ? r.order_index : (r.orderIndex || 0),
              startDate: inferredStartDate,
              endDate: inferredEndDate,
              recurrence: inferredRecurrence,
              createdAt: r.created_at || r.createdAt,
              updatedAt: r.updated_at || r.updatedAt || null
            };
          });
          this.saveToStorage();
          return this.state.routines;
        }
      } catch (_) {}
    }

    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/smart-lists/routines', { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const existingMap = new Map((this.state.routines || []).map(r => [r.id, r]));
          this.state.routines = data.map(r => {
            const existing = existingMap.get(r.id);
            return {
              id: r.id,
              title: r.title,
              orderIndex: r.orderIndex !== undefined ? r.orderIndex : (r.order_index || 0),
              startDate: r.startDate || existing?.startDate || null,
              endDate: r.endDate || existing?.endDate || null,
              recurrence: r.recurrence || existing?.recurrence || (r.endDate ? 'once' : 'daily'),
              createdAt: r.createdAt || r.created_at,
              updatedAt: r.updatedAt || r.updated_at || null
            };
          });
          this.saveToStorage();
          return this.state.routines;
        }
      }
    } catch (_) {}

    return this.state.routines;
  },

  async addRoutine(title) {
    if (!title || typeof title !== 'string' || !title.trim()) {
      return null;
    }
    const trimmed = title.trim().slice(0, 150);
    // Prevent duplicate submission (case-insensitive)
    if (this.state.routines.some(r => r.title.toLowerCase() === trimmed.toLowerCase())) {
      if (typeof alert !== 'undefined') alert('A routine with this name already exists.');
      return null;
    }

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'routine_' + Date.now();
    const newRoutine = {
      id: newId,
      title: trimmed,
      orderIndex: this.state.routines.length,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    // Optimistic local add
    this.state.routines.push(newRoutine);
    this.saveToStorage();
    this.renderRoutines();

    // Supabase direct sync
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data, error } = await supabaseClient
          .from('smart_routines')
          .insert({
            id: newId,
            user_id: state.user.id,
            title: trimmed,
            order_index: newRoutine.orderIndex
          })
          .select()
          .single();
        if (!error && data) {
          newRoutine.id = data.id;
          this.saveToStorage();
          return newRoutine;
        }
      } catch (_) {}
    }

    // Backend API fallback
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch('/api/smart-lists/routines', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: trimmed, orderIndex: newRoutine.orderIndex })
      });
      if (res.ok) {
        const serverData = await res.json();
        newRoutine.id = serverData.id;
        this.saveToStorage();
      }
    } catch (_) {}

    return newRoutine;
  },

  async updateRoutine(id, newTitle) {
    if (!newTitle || typeof newTitle !== 'string' || !newTitle.trim()) {
      return null;
    }
    const trimmed = newTitle.trim().slice(0, 150);
    const routine = this.state.routines.find(r => r.id === id);
    if (!routine) return null;

    routine.title = trimmed;
    routine.updatedAt = new Date().toISOString();
    this.saveToStorage();
    this.renderRoutines();

    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routines')
          .update({ title: trimmed, updated_at: routine.updatedAt })
          .eq('id', id)
          .eq('user_id', state.user.id);
      } catch (_) {}
    } else {
      try {
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        await fetch(`/api/smart-lists/routines/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: trimmed })
        });
      } catch (_) {}
    }

    return routine;
  },

  async deleteRoutine(id) {
    const idx = this.state.routines.findIndex(r => r.id === id);
    if (idx === -1) {
      // Idempotent cleanup even if routine was already deleted from routines
      this.state.tomorrowRoutines = (this.state.tomorrowRoutines || []).filter(r => (r.routineId || r.id) !== id);
      Object.keys(this.state.completions).forEach(key => {
        if (key.startsWith(`${id}_`)) {
          delete this.state.completions[key];
        }
      });
      this.saveToStorage();
      this.renderRoutines();
      this.renderTomorrowRoutines();
      return true;
    }

    // Save rollback snapshot
    const rollbackRoutines = JSON.parse(JSON.stringify(this.state.routines || []));
    const rollbackTomorrow = JSON.parse(JSON.stringify(this.state.tomorrowRoutines || []));
    const rollbackCompletions = JSON.parse(JSON.stringify(this.state.completions || {}));

    // 1. Remove from today's active routines
    this.state.routines.splice(idx, 1);

    // 2. Remove from tomorrow's routines immediately
    this.state.tomorrowRoutines = (this.state.tomorrowRoutines || []).filter(r => (r.routineId || r.id) !== id);

    // 3. Clear any pending modal states for this routine
    if (this.state.pendingDeleteId === id) this.state.pendingDeleteId = null;
    if (this.state.pendingRemoveTomorrowId === id) this.state.pendingRemoveTomorrowId = null;
    if (this.state.pendingEditTomorrowId === id) this.state.pendingEditTomorrowId = null;

    // 4. Remove completions for this routine
    Object.keys(this.state.completions).forEach(key => {
      if (key.startsWith(`${id}_`)) {
        delete this.state.completions[key];
      }
    });

    // 5. Persist to storage and refresh UI immediately
    this.saveToStorage();
    this.renderRoutines();
    this.renderTomorrowRoutines();
    this.computeLocalStreaksAndStats(this.state.activeDate);
    this.renderStreakWidget();

    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);

    // 6. ASYNC PERSISTENCE (Supabase / Backend)
    try {
      if (isSupabaseAuth) {
        // First delete any completion records for this routine to avoid foreign key errors or orphans
        await supabaseClient
          .from('smart_routine_completions')
          .delete()
          .eq('user_id', state.user.id)
          .eq('routine_id', id);

        // Delete parent routine definition
        const { error: delErr } = await supabaseClient
          .from('smart_routines')
          .delete()
          .eq('id', id)
          .eq('user_id', state.user.id);

        if (delErr) {
          console.warn('[SmartLists] Supabase deleteRoutine error:', delErr);
        }
      } else {
        const headers = getAuthHeaders();
        const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';
        const res = await fetch(`${baseUrl}/api/smart-lists/routines/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers
        });
        if (!res.ok && res.status !== 404) {
          throw new Error('Failed to delete routine from server');
        }
      }
    } catch (err) {
      const isInvalidUrlInNode = (err.code === 'ERR_INVALID_URL' || (typeof err.message === 'string' && err.message.includes('Failed to parse URL')));
      if (isInvalidUrlInNode) {
        return true;
      }
      console.error('[SmartLists] deleteRoutine persistence failed, rolling back:', err);
      this.state.routines = rollbackRoutines;
      this.state.tomorrowRoutines = rollbackTomorrow;
      this.state.completions = rollbackCompletions;
      this.saveToStorage();
      this.renderRoutines();
      this.renderTomorrowRoutines();
      this.computeLocalStreaksAndStats(this.state.activeDate);
      this.renderStreakWidget();
      if (typeof alert !== 'undefined') alert('Could not remove routine: ' + err.message);
      return false;
    }

    return true;
  },

  // --- Daily Completions ---
  async fetchCompletions(date) {
    const d = date || this.state.activeDate;
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data, error } = await supabaseClient
          .from('smart_routine_completions')
          .select('*')
          .eq('user_id', state.user.id)
          .eq('date', d);
        if (!error && Array.isArray(data)) {
          data.forEach(item => {
            const key = `${item.routine_id}_${d}`;
            const status = item.status || (item.completed ? 'completed' : 'pending');
            const isRemoved = status === 'removed' || (status === 'cancelled' && (item.cancellation_reason === 'removed_from_tomorrow' || item.cancellation_reason === 'created_for_future'));
            const existingTitleOverride = this.state.completions[key]?.titleOverride || item.title_override || item.titleOverride || null;
            this.state.completions[key] = {
              status: isRemoved ? 'removed' : status,
              removed: isRemoved,
              completed: status === 'completed',
              carriedForward: Boolean(item.carried_forward),
              postponedToDate: item.postponed_to || item.postponed_to_date || null,
              originalDate: item.original_date || item.originalDate || null,
              cancellationReason: item.cancellation_reason || null,
              titleOverride: existingTitleOverride
            };
          });
          this.saveToStorage();
          return this.state.completions;
        }
      } catch (_) {}
    }

    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/smart-lists/completions?date=${d}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach(item => {
            const key = `${item.routineId}_${d}`;
            const status = item.status || (item.completed ? 'completed' : 'pending');
            const isRemoved = status === 'removed' || (status === 'cancelled' && (item.cancellationReason === 'removed_from_tomorrow' || item.cancellationReason === 'created_for_future'));
            const existingTitleOverride = this.state.completions[key]?.titleOverride || item.titleOverride || item.title_override || null;
            this.state.completions[key] = {
              status: isRemoved ? 'removed' : status,
              removed: isRemoved,
              completed: status === 'completed',
              carriedForward: Boolean(item.carriedForward),
              postponedToDate: item.postponedToDate || null,
              cancellationReason: item.cancellationReason || null,
              titleOverride: existingTitleOverride
            };
          });
          this.saveToStorage();
        }
      }
    } catch (_) {}

    return this.state.completions;
  },

  getCompletion(routineId, date) {
    const d = date || this.state.activeDate;
    const key = `${routineId}_${d}`;
    const raw = this.state.completions[key];
    if (!raw) {
      return {
        routineId,
        date: d,
        status: 'pending',
        completed: false,
        carriedForward: false,
        postponedToDate: null,
        cancellationReason: null,
        titleOverride: null,
        removed: false
      };
    }
    const isRemoved = Boolean(raw.removed) || 
      raw.status === 'removed' || 
      (raw.status === 'cancelled' && (
        raw.cancellationReason === 'removed_from_tomorrow' || 
        raw.cancellation_reason === 'removed_from_tomorrow' || 
        raw.cancellationReason === 'created_for_future' || 
        raw.cancellation_reason === 'created_for_future'
      ));

    let status = isRemoved ? 'removed' : raw.status;
    if (!status || !['completed', 'pending', 'postponed', 'cancelled', 'removed'].includes(status)) {
      status = raw.completed ? 'completed' : 'pending';
    }
    return {
      routineId,
      date: d,
      status,
      removed: isRemoved,
      completed: status === 'completed',
      carriedForward: Boolean(raw.carriedForward || raw.carried_forward),
      postponedToDate: raw.postponedToDate || raw.postponed_to || null,
      cancellationReason: raw.cancellationReason || raw.cancellation_reason || null,
      titleOverride: raw.titleOverride || raw.title_override || null
    };
  },

  isRoutineCompleted(routineId, date) {
    return Boolean(this.getCompletion(routineId, date).completed);
  },

  calculateDayProgress(date) {
    const d = date || this.state.activeDate;
    let total = 0;
    let completed = 0;
    (this.state.routines || []).forEach(r => {
      if (r.startDate && d < r.startDate) return;
      if (r.endDate && d > r.endDate) return;
      const comp = this.getCompletion(r.id, d);
      if (comp && (comp.status === 'removed' || comp.removed === true || (comp.status === 'cancelled' && (comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only' || comp.cancellationReason === 'removed_from_tomorrow')))) {
        return;
      }
      total++;
      if (comp.completed) completed++;
    });
    const incomplete = total - completed;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, incomplete, rate };
  },

  getNextDayYmd(ymd) {
    const parts = ymd.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 1);
    return (typeof toYmdString === 'function') ? toYmdString(d) : d.toISOString().slice(0, 10);
  },

  async toggleCompletion(routineId, date) {
    const d = date || this.state.activeDate;
    const current = this.getCompletion(routineId, d);
    const newStatus = (current.status === 'completed') ? 'pending' : 'completed';
    return await this.setRoutineStatus(routineId, d, newStatus);
  },

  async setRoutineStatus(routineId, date, status, options = {}) {
    const d = date || this.state.activeDate;
    if (!['completed', 'pending', 'postponed', 'cancelled'].includes(status)) {
      return false;
    }
    const key = `${routineId}_${d}`;
    const current = this.getCompletion(routineId, d);

    const postponedToDate = (status === 'postponed') 
      ? (options.postponedToDate || this.getNextDayYmd(d)) 
      : null;
    const cancellationReason = (status === 'cancelled') 
      ? (options.cancellationReason || null) 
      : null;

    // Optimistic local update
    this.state.completions[key] = {
      status,
      completed: status === 'completed',
      carriedForward: current.carriedForward,
      postponedToDate,
      cancellationReason
    };

    // If postponed, also schedule occurrence on postponedToDate
    if (status === 'postponed' && postponedToDate) {
      const nextKey = `${routineId}_${postponedToDate}`;
      if (!this.state.completions[nextKey]) {
        this.state.completions[nextKey] = {
          status: 'pending',
          completed: false,
          carriedForward: true,
          postponedToDate: null,
          cancellationReason: null
        };
      }
    }

    this.saveToStorage();
    this.renderRoutines();
    this.computeLocalStreaksAndStats(d);
    this.renderStreakWidget();

    // Auto-update today's summary snapshot in background
    this.generateDailyReport(d).catch(() => {});

    // Backend API sync
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      if (status === 'postponed') {
        await fetch(`/api/smart-lists/routines/${encodeURIComponent(routineId)}/postpone`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            originalDate: d,
            postponedDate: postponedToDate
          })
        });
      } else if (status === 'cancelled') {
        await fetch(`/api/smart-lists/routines/${encodeURIComponent(routineId)}/cancel`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            date: d,
            cancellationReason
          })
        });
      } else {
        await fetch('/api/smart-lists/completions/status', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            routineId,
            date: d,
            status
          })
        });
      }
    } catch (_) {}

    // Direct Supabase upsert fallback
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_completions')
          .upsert({
            user_id: state.user.id,
            routine_id: routineId,
            date: d,
            status,
            completed: status === 'completed',
            completed_at: status === 'completed' ? new Date().toISOString() : null,
            carried_forward: current.carriedForward,
            postponed_to: postponedToDate,
            cancellation_reason: cancellationReason,
            title_override: current.titleOverride || null
          }, { onConflict: 'user_id,routine_id,date' });

        if (status === 'postponed' && postponedToDate) {
          await supabaseClient
            .from('smart_routine_completions')
            .upsert({
              user_id: state.user.id,
              routine_id: routineId,
              date: postponedToDate,
              status: 'pending',
              completed: false,
              carried_forward: true,
              original_date: d,
              title_override: current.titleOverride || null
            }, { onConflict: 'user_id,routine_id,date' });
        }
      } catch (_) {}
    }

    // Refresh official streaks and stats from backend
    await this.fetchStreaksAndStats(d).catch(() => {});
    return true;
  },

  async fetchStreaksAndStats(date) {
    const d = date || this.state.activeDate;
    this.state.isLoadingStats = true;
    try {
      const headers = getAuthHeaders();
      const [resStreaks, resDaily, resConsistency] = await Promise.all([
        fetch(`/api/smart-lists/streaks?date=${d}`, { headers }),
        fetch(`/api/smart-lists/statistics/daily?date=${d}`, { headers }),
        fetch(`/api/smart-lists/statistics/consistency?date=${d}`, { headers })
      ]);

      let gotData = false;
      if (resStreaks.ok) {
        const streaksData = await resStreaks.json();
        if (streaksData && typeof streaksData.currentStreak === 'number') {
          this.state.streaks = streaksData;
          gotData = true;
        }
      }
      if (resDaily.ok) {
        const dailyData = await resDaily.json();
        if (dailyData && typeof dailyData.completionRate === 'number') {
          this.state.dailyStats = dailyData;
          gotData = true;
        }
      }
      if (resConsistency.ok) {
        const consistencyData = await resConsistency.json();
        if (consistencyData && consistencyData.weekly && consistencyData.monthly) {
          this.state.consistency = consistencyData;
          gotData = true;
        }
      }

      if (!gotData) {
        this.computeLocalStreaksAndStats(d);
      }
    } catch (_) {
      this.computeLocalStreaksAndStats(d);
    } finally {
      this.state.isLoadingStats = false;
      this.renderStreakWidget();
    }
  },

  computeLocalStreaksAndStats(date) {
    const d = date || this.state.activeDate;
    const routines = this.state.routines || [];

    const completionsList = [];
    Object.keys(this.state.completions).forEach(key => {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const routineId = parts[0];
        const cDate = parts.slice(1).join('_');
        const c = this.getCompletion(routineId, cDate);
        completionsList.push(c);
      }
    });

    let completedCount = 0;
    let pendingCount = 0;
    let postponedCount = 0;
    let cancelledCount = 0;

    routines.forEach(r => {
      if (r.startDate && d < r.startDate) return;
      if (r.endDate && d > r.endDate) return;
      const c = this.getCompletion(r.id, d);
      if (c && (c.status === 'removed' || c.removed === true || (c.status === 'cancelled' && (c.cancellationReason === 'created_for_future' || c.cancellation_reason === 'created_for_future' || c.cancellationReason === 'tomorrow_only' || c.cancellation_reason === 'tomorrow_only' || c.cancellationReason === 'removed_from_tomorrow' || c.cancellation_reason === 'removed_from_tomorrow')))) return;
      if (c.status === 'completed') completedCount++;
      else if (c.status === 'postponed') postponedCount++;
      else if (c.status === 'cancelled') cancelledCount++;
      else pendingCount++;
    });

    const totalCount = completedCount + pendingCount + postponedCount + cancelledCount;
    const eligibleCount = totalCount - cancelledCount;
    const completionRate = eligibleCount > 0 ? Math.round((completedCount / eligibleCount) * 100) : 0;
    const isQualified = eligibleCount > 0 && completionRate >= 80;

    this.state.dailyStats = {
      date: d,
      totalCount,
      completedCount,
      pendingCount,
      postponedCount,
      cancelledCount,
      eligibleCount,
      completionRate,
      isQualified
    };

    const resetAt = this.state.settings?.streakResetAt;
    const resetDateStr = resetAt ? (typeof toYmdString === 'function' ? toYmdString(resetAt) : String(resetAt).slice(0, 10)) : null;

    const isDateQualified = (dateStr) => {
      if (resetDateStr && dateStr < resetDateStr) return false;
      let compC = 0;
      let cancC = 0;
      let activeCount = 0;
      routines.forEach(r => {
        if (r.startDate && dateStr < r.startDate) return;
        if (r.endDate && dateStr > r.endDate) return;
        const comp = this.getCompletion(r.id, dateStr);
        if (comp && (comp.status === 'removed' || comp.removed === true || (comp.status === 'cancelled' && (comp.cancellationReason === 'created_for_future' || comp.cancellation_reason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only' || comp.cancellation_reason === 'tomorrow_only' || comp.cancellationReason === 'removed_from_tomorrow' || comp.cancellation_reason === 'removed_from_tomorrow')))) return;
        activeCount++;
        if (comp.status === 'completed') compC++;
        else if (comp.status === 'cancelled') cancC++;
      });
      if (activeCount === 0) return false;
      const eligible = activeCount - cancC;
      if (eligible <= 0) return false;
      return Math.round((compC / eligible) * 100) >= 80;
    };

    const parts = d.split('-').map(Number);
    const dObj = new Date(parts[0], parts[1] - 1, parts[2]);

    const getPrevDay = (curYmd) => {
      const p = curYmd.split('-').map(Number);
      const dt = new Date(p[0], p[1] - 1, p[2]);
      dt.setDate(dt.getDate() - 1);
      return (typeof toYmdString === 'function') ? toYmdString(dt) : dt.toISOString().slice(0, 10);
    };

    let currentStreak = 0;
    const yesterdayStr = getPrevDay(d);

    if (isDateQualified(d)) {
      let check = d;
      while (isDateQualified(check) && (!resetDateStr || check >= resetDateStr)) {
        currentStreak++;
        check = getPrevDay(check);
      }
    } else if (isDateQualified(yesterdayStr)) {
      let check = yesterdayStr;
      while (isDateQualified(check) && (!resetDateStr || check >= resetDateStr)) {
        currentStreak++;
        check = getPrevDay(check);
      }
    }

    const allDates = new Set();
    completionsList.forEach(c => allDates.add(c.date));
    allDates.add(d);
    allDates.add(yesterdayStr);

    let sortedDates = Array.from(allDates).sort();
    if (resetDateStr) {
      sortedDates = sortedDates.filter(dt => dt >= resetDateStr);
    }
    let longestStreak = currentStreak;
    let run = 0;
    let prevQual = null;

    sortedDates.forEach(dt => {
      if (isDateQualified(dt)) {
        if (!prevQual) {
          run = 1;
        } else {
          const p1 = prevQual.split('-').map(Number);
          const p2 = dt.split('-').map(Number);
          const t1 = new Date(p1[0], p1[1] - 1, p1[2]).getTime();
          const t2 = new Date(p2[0], p2[1] - 1, p2[2]).getTime();
          const diffD = Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
          if (diffD === 1) run++;
          else run = 1;
        }
        prevQual = dt;
        if (run > longestStreak) longestStreak = run;
      } else {
        run = 0;
        prevQual = null;
      }
    });

    this.state.streaks = {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak)
    };

    const dayOfWeek = dObj.getDay();
    const monOffset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    const monDt = new Date(dObj);
    monDt.setDate(monDt.getDate() - monOffset);

    let weekTotal = 0;
    let weekQual = 0;
    for (let i = 0; i <= monOffset; i++) {
      const cur = new Date(monDt);
      cur.setDate(cur.getDate() + i);
      const ymd = (typeof toYmdString === 'function') ? toYmdString(cur) : cur.toISOString().slice(0, 10);
      if (!resetDateStr || ymd >= resetDateStr) {
        weekTotal++;
        if (isDateQualified(ymd)) weekQual++;
      }
    }

    const dayOfMonth = dObj.getDate();
    let monthTotal = 0;
    let monthQual = 0;
    for (let dayNum = 1; dayNum <= dayOfMonth; dayNum++) {
      const cur = new Date(parts[0], parts[1] - 1, dayNum);
      const ymd = (typeof toYmdString === 'function') ? toYmdString(cur) : cur.toISOString().slice(0, 10);
      if (!resetDateStr || ymd >= resetDateStr) {
        monthTotal++;
        if (isDateQualified(ymd)) monthQual++;
      }
    }

    this.state.consistency = {
      weekly: {
        totalDays: weekTotal,
        qualifyingDays: weekQual,
        percentage: weekTotal > 0 ? Math.round((weekQual / weekTotal) * 100) : 0
      },
      monthly: {
        totalDays: monthTotal,
        qualifyingDays: monthQual,
        percentage: monthTotal > 0 ? Math.round((monthQual / monthTotal) * 100) : 0
      }
    };
  },

  renderStreakWidget() {
    if (typeof document === 'undefined') return;

    const streakCard = document.getElementById('smart-habit-streak-card');
    if (!streakCard) return;

    const currentStreakVal = this.state.streaks?.currentStreak || 0;
    const longestStreakVal = this.state.streaks?.longestStreak || 0;
    const dailyRateVal = this.state.dailyStats?.completionRate || 0;
    const weeklyPct = this.state.consistency?.weekly?.percentage || 0;
    const weeklyQual = this.state.consistency?.weekly?.qualifyingDays || 0;
    const weeklyTot = this.state.consistency?.weekly?.totalDays || 0;
    const monthlyPct = this.state.consistency?.monthly?.percentage || 0;
    const monthlyQual = this.state.consistency?.monthly?.qualifyingDays || 0;
    const monthlyTot = this.state.consistency?.monthly?.totalDays || 0;

    const completedC = this.state.dailyStats?.completedCount || 0;
    const pendingC = this.state.dailyStats?.pendingCount || 0;
    const postponedC = this.state.dailyStats?.postponedCount || 0;
    const cancelledC = this.state.dailyStats?.cancelledCount || 0;

    const currEl = document.getElementById('habit-current-streak-count');
    const longestEl = document.getElementById('habit-longest-streak-count');
    const dailyEl = document.getElementById('habit-daily-rate');
    const weeklyEl = document.getElementById('habit-weekly-consistency');
    const weeklyDaysEl = document.getElementById('habit-weekly-days');
    const monthlyEl = document.getElementById('habit-monthly-consistency');
    const monthlyDaysEl = document.getElementById('habit-monthly-days');

    const chipComp = document.getElementById('chip-count-completed');
    const chipPend = document.getElementById('chip-count-pending');

    if (currEl) currEl.textContent = `${currentStreakVal} ${currentStreakVal === 1 ? 'Day' : 'Days'}`;
    if (longestEl) longestEl.textContent = `${longestStreakVal} ${longestStreakVal === 1 ? 'Day' : 'Days'}`;
    if (dailyEl) dailyEl.textContent = `${dailyRateVal}%`;
    if (weeklyEl) weeklyEl.textContent = `${weeklyPct}%`;
    if (weeklyDaysEl) weeklyDaysEl.textContent = `${weeklyQual}/${weeklyTot} days`;
    if (monthlyEl) monthlyEl.textContent = `${monthlyPct}%`;
    if (monthlyDaysEl) monthlyDaysEl.textContent = `${monthlyQual}/${monthlyTot} days`;

    if (chipComp) chipComp.textContent = `✓ ${completedC} Done`;
    if (chipPend) chipPend.textContent = `○ ${pendingC} Pending`;
  },

  // --- Reports & Summary ---
  normalizeReport(rawReport) {
    if (!rawReport) return null;

    // Helper to safely extract an array of strings from various representations
    const extractTitles = (field) => {
      if (!field) return [];
      let list = field;
      if (typeof field === 'string') {
        try {
          const parsed = JSON.parse(field);
          if (Array.isArray(parsed)) list = parsed;
        } catch (_) {
          return [field.trim()].filter(Boolean);
        }
      }
      if (!Array.isArray(list)) return [];
      return list.map(item => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.title || item.name || '').trim();
        return '';
      }).filter(Boolean);
    };

    let completed = [];
    if (rawReport.completedRoutines) completed = extractTitles(rawReport.completedRoutines);
    if (completed.length === 0 && rawReport.completed_routines) completed = extractTitles(rawReport.completed_routines);
    if (completed.length === 0 && rawReport.completedList) completed = extractTitles(rawReport.completedList);
    if (completed.length === 0 && Array.isArray(rawReport.routinesSnapshot)) {
      completed = rawReport.routinesSnapshot.filter(r => r && r.completed).map(r => String(r.title || '').trim()).filter(Boolean);
    }

    let incomplete = [];
    if (rawReport.incompleteRoutines) incomplete = extractTitles(rawReport.incompleteRoutines);
    if (incomplete.length === 0 && rawReport.incomplete_routines) incomplete = extractTitles(rawReport.incomplete_routines);
    if (incomplete.length === 0 && rawReport.incompleteList) incomplete = extractTitles(rawReport.incompleteList);
    if (incomplete.length === 0 && Array.isArray(rawReport.routinesSnapshot)) {
      incomplete = rawReport.routinesSnapshot.filter(r => r && !r.completed).map(r => String(r.title || '').trim()).filter(Boolean);
    }

    // Fallback ONLY for activeDate if both lists are empty and routines exist in state
    if (completed.length === 0 && incomplete.length === 0 && rawReport.date === this.state.activeDate && this.state.routines && this.state.routines.length > 0) {
      this.state.routines.forEach(r => {
        const comp = this.getCompletion(r.id, rawReport.date);
        if (comp.completed) {
          completed.push(r.title);
        } else {
          incomplete.push(r.title);
        }
      });
    }

    // Strict mathematical consistency guarantees:
    const completedCount = completed.length;
    const incompleteCount = incomplete.length;
    const totalRoutines = completedCount + incompleteCount;
    const completionRate = totalRoutines > 0 ? Math.round((completedCount / totalRoutines) * 100) : 0;

    let status = 'Not Started';
    let statusBadge = 'Not Started';
    if (totalRoutines === 0) {
      status = 'Not Started';
      statusBadge = 'No Routines';
    } else if (completedCount === totalRoutines) {
      status = 'Fully Completed';
      statusBadge = 'Exceptional';
    } else if (completionRate >= 80) {
      status = 'Partially Completed';
      statusBadge = 'Great Job';
    } else if (completionRate >= 50) {
      status = 'Partially Completed';
      statusBadge = 'Good Progress';
    } else if (completedCount > 0) {
      status = 'Partially Completed';
      statusBadge = 'Needs Focus';
    }

    let closingStatement = rawReport.closingStatement;
    if (!closingStatement || (totalRoutines > 0 && closingStatement === 'No routines scheduled for this date.')) {
      if (totalRoutines === 0) {
        closingStatement = 'No routines scheduled for this date.';
      } else if (completedCount === totalRoutines) {
        closingStatement = 'Outstanding work! You completed 100% of your daily routines today. All objectives achieved!';
      } else if (completionRate >= 80) {
        closingStatement = `Great job! You achieved ${completionRate}% routine completion today. Keep up the strong consistency tomorrow!`;
      } else if (completionRate >= 50) {
        closingStatement = `Good progress! You reached ${completionRate}% routine completion today. Stay focused to close out the remaining routines!`;
      } else if (completedCount > 0) {
        closingStatement = `Some routines completed today (${completionRate}%). Keep pushing forward tomorrow to build momentum!`;
      } else {
        closingStatement = 'No routines were completed today. Tomorrow is a fresh opportunity to start strong!';
      }
    }

    return {
      id: rawReport.id || ('rep_' + (rawReport.date || Date.now())),
      date: rawReport.date,
      totalRoutines,
      completedCount,
      incompleteCount,
      completionRate,
      status,
      statusBadge,
      closingStatement,
      completedRoutines: completed,
      incompleteRoutines: incomplete,
      postponedRoutines: rawReport.postponedRoutines || rawReport.postponed_routines || [],
      cancelledRoutines: rawReport.cancelledRoutines || rawReport.cancelled_routines || [],
      postponedCount: rawReport.postponedCount !== undefined ? rawReport.postponedCount : (rawReport.postponed_count || 0),
      cancelledCount: rawReport.cancelledCount !== undefined ? rawReport.cancelledCount : (rawReport.cancelled_count || 0),
      eligibleCount: rawReport.eligibleCount !== undefined ? rawReport.eligibleCount : (rawReport.eligible_count || totalRoutines),
      completedList: completed,
      incompleteList: incomplete,
      routinesSnapshot: Array.isArray(rawReport.routinesSnapshot) && rawReport.routinesSnapshot.length > 0
        ? rawReport.routinesSnapshot
        : [
            ...completed.map(t => ({ title: t, completed: true })),
            ...incomplete.map(t => ({ title: t, completed: false }))
          ],
      carryForwardDecision: rawReport.carryForwardDecision || rawReport.carry_forward_decision || 'pending',
      createdAt: rawReport.createdAt || rawReport.created_at || new Date().toISOString(),
      updatedAt: rawReport.updatedAt || rawReport.updated_at || new Date().toISOString()
    };
  },

  async generateDailyReport(date) {
    const d = date || this.state.activeDate;
    const routines = this.state.routines || [];
    const total = routines.length;

    const completedRoutineTitles = [];
    const incompleteRoutineTitles = [];

    routines.forEach(r => {
      const comp = this.getCompletion(r.id, d);
      if (comp.completed) {
        completedRoutineTitles.push(r.title);
      } else {
        incompleteRoutineTitles.push(r.title);
      }
    });

    const completedCount = completedRoutineTitles.length;
    const incompleteCount = incompleteRoutineTitles.length;
    const rate = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    let status = 'Not Started';
    let statusBadge = 'Not Started';
    if (total > 0 && completedCount === total) {
      status = 'Fully Completed';
      statusBadge = 'Exceptional';
    } else if (rate >= 80) {
      status = 'Partially Completed';
      statusBadge = 'Great Job';
    } else if (rate >= 50) {
      status = 'Partially Completed';
      statusBadge = 'Good Progress';
    } else if (completedCount > 0) {
      status = 'Partially Completed';
      statusBadge = 'Needs Focus';
    }

    let closingStatement = 'No routines scheduled for this date.';
    if (total > 0) {
      if (completedCount === total) {
        closingStatement = 'Outstanding work! You completed 100% of your daily routines today. All objectives achieved!';
      } else if (rate >= 80) {
        closingStatement = `Great job! You achieved ${rate}% routine completion today. Keep up the strong consistency tomorrow!`;
      } else if (rate >= 50) {
        closingStatement = `Good progress! You reached ${rate}% routine completion today. Stay focused to close out the remaining routines!`;
      } else if (completedCount > 0) {
        closingStatement = `Some routines completed today (${rate}%). Keep pushing forward tomorrow to build momentum!`;
      } else {
        closingStatement = 'No routines were completed today. Tomorrow is a fresh opportunity to start strong!';
      }
    }

    const existingReport = this.state.reports.find(rep => rep.date === d);
    const carryForwardDecision = existingReport ? existingReport.carryForwardDecision : 'pending';

    const report = {
      id: existingReport?.id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'rep_' + Date.now()),
      date: d,
      totalRoutines: total,
      completedRoutines: completedRoutineTitles,
      completedCount,
      incompleteRoutines: incompleteRoutineTitles,
      incompleteCount,
      completionRate: rate,
      status,
      statusBadge,
      closingStatement,
      completedList: completedRoutineTitles,
      incompleteList: incompleteRoutineTitles,
      routinesSnapshot: routines.map(r => ({
        id: r.id,
        title: r.title,
        completed: this.getCompletion(r.id, d).completed
      })),
      carryForwardDecision: carryForwardDecision || 'pending',
      createdAt: existingReport?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update in-memory & storage
    const idx = this.state.reports.findIndex(rep => rep.date === d);
    if (idx !== -1) {
      this.state.reports[idx] = report;
    } else {
      this.state.reports.unshift(report);
    }
    this.saveToStorage();

    // Persist to Supabase / API
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_reports')
          .upsert({
            id: report.id,
            user_id: state.user.id,
            date: d,
            total_routines: total,
            completed_count: completedCount,
            incomplete_count: incompleteCount,
            completion_rate: rate,
            status,
            completed_routines: completedRoutineTitles,
            incomplete_routines: incompleteRoutineTitles,
            carry_forward_decision: report.carryForwardDecision,
            updated_at: report.updatedAt
          }, { onConflict: 'user_id,date' });
      } catch (_) {}
    } else {
      try {
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        await fetch('/api/smart-lists/reports', {
          method: 'POST',
          headers,
          body: JSON.stringify(report)
        });
      } catch (_) {}
    }

    return report;
  },

  async fetchReports() {
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data, error } = await supabaseClient
          .from('smart_routine_reports')
          .select('*')
          .eq('user_id', state.user.id)
          .order('date', { ascending: false });
        if (!error && Array.isArray(data)) {
          this.state.reports = data.map(r => this.normalizeReport({
            id: r.id,
            date: r.date,
            totalRoutines: r.total_routines,
            completedCount: r.completed_count,
            incompleteCount: r.incomplete_count,
            completionRate: r.completion_rate,
            status: r.status,
            completedRoutines: r.completed_routines || [],
            incompleteRoutines: r.incomplete_routines || [],
            carryForwardDecision: r.carry_forward_decision || 'pending',
            createdAt: r.created_at,
            updatedAt: r.updated_at
          })).filter(Boolean);
          this.saveToStorage();
          return this.state.reports;
        }
      } catch (_) {}
    }

    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/smart-lists/reports', { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          this.state.reports = data.map(r => this.normalizeReport(r)).filter(Boolean);
          this.saveToStorage();
          return this.state.reports;
        }
      }
    } catch (_) {}

    return this.state.reports;
  },

  async deleteReport(idOrDate) {
    const idx = this.state.reports.findIndex(r => r.id === idOrDate || r.date === idOrDate);
    if (idx === -1) return false;
    const report = this.state.reports[idx];

    this.state.reports.splice(idx, 1);
    this.saveToStorage();

    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_reports')
          .delete()
          .eq('id', report.id)
          .eq('user_id', state.user.id);
      } catch (_) {}
    } else {
      try {
        const headers = getAuthHeaders();
        await fetch(`/api/smart-lists/reports/${report.id}`, { method: 'DELETE', headers });
      } catch (_) {}
    }

    this.renderHistoryList();
    return true;
  },

  // --- Carry Forward ---
  async setCarryForwardDecision(date, decision) {
    const d = date || this.state.activeReportDate || this.state.activeDate;
    if (!['yes', 'no'].includes(decision)) return;
    if (this.state.isProcessingCarryForward) return;
    this.state.isProcessingCarryForward = true;

    // Snapshot pre-mutation state for rollback in case of error
    const rollbackCompletions = JSON.parse(JSON.stringify(this.state.completions || {}));
    const rollbackReports = JSON.parse(JSON.stringify(this.state.reports || []));
    const rollbackTomorrow = JSON.parse(JSON.stringify(this.state.tomorrowRoutines || []));
    const rollbackDailyStats = JSON.parse(JSON.stringify(this.state.dailyStats || {}));

    const btnYes = (typeof document !== 'undefined') ? document.getElementById('btn-carry-forward-yes') : null;
    const btnNo = (typeof document !== 'undefined') ? document.getElementById('btn-carry-forward-no') : null;
    if (btnYes) { btnYes.disabled = true; btnYes.classList.add('loading'); }
    if (btnNo) { btnNo.disabled = true; }

    const curParts = d.split('-').map(Number);
    const nextDay = new Date(curParts[0], curParts[1] - 1, curParts[2]);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = (typeof toYmdString === 'function') ? toYmdString(nextDay) : nextDay.toISOString().slice(0, 10);

    const routines = this.state.routines || [];
    let postponedCount = 0;
    const carriedRoutineIds = [];

    // 1. OPTIMISTIC IN-MEMORY STATE UPDATE
    if (decision === 'yes') {
      routines.forEach(r => {
        // Exclude routines with start dates after today or end dates before today
        if (r.startDate && d < r.startDate) return;
        if (r.endDate && d > r.endDate) return;

        const comp = this.getCompletion(r.id, d);
        if (comp && (comp.status === 'removed' || comp.removed || (comp.status === 'cancelled' && (comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only' || comp.cancellationReason === 'removed_from_tomorrow')))) {
          return;
        }

        if (comp.status !== 'completed' && comp.status !== 'cancelled') {
          // Mark original occurrence as postponed
          this.state.completions[`${r.id}_${d}`] = {
            ...comp,
            status: 'postponed',
            completed: false,
            postponedToDate: nextDayStr,
            carriedForward: false
          };
          postponedCount++;
          carriedRoutineIds.push(r.id);

          // Schedule next-day occurrence as pending (prevent duplicate if already completed)
          const tomKey = `${r.id}_${nextDayStr}`;
          const existingTomComp = this.state.completions[tomKey];
          if (!existingTomComp || existingTomComp.status !== 'completed') {
            this.state.completions[tomKey] = {
              status: 'pending',
              completed: false,
              carriedForward: true,
              originalDate: d,
              titleOverride: existingTomComp?.titleOverride || null
            };
          }
        }
      });
    }

    // Update report in memory
    let report = this.state.reports.find(r => r.date === d);
    if (!report) {
      report = await this.generateDailyReport(d);
    }
    report.carryForwardDecision = decision;
    if (decision === 'yes') {
      report.postponedCount = postponedCount;
      report.incompleteCount = Math.max(0, (report.incompleteCount || 0) - postponedCount);
      report.closingStatement = postponedCount > 0
        ? `${postponedCount} incomplete routine${postponedCount === 1 ? '' : 's'} were carried forward to tomorrow (${nextDayStr}).`
        : 'All routines were already completed or excused; no routines carried forward.';
    } else {
      report.closingStatement = "Today's checklist was closed without carrying forward routines.";
    }
    report.updatedAt = new Date().toISOString();

    // Compute updated streaks & stats immediately
    this.saveToStorage();
    this.computeLocalStreaksAndStats(d);

    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);
    const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';

    // 2. ASYNC PERSISTENCE (Authoritative Supabase on mobile, Express fallback on web)
    try {
      if (isSupabaseAuth) {
        const operations = [];

        if (decision === 'yes') {
          carriedRoutineIds.forEach(routineId => {
            // Postpone today
            operations.push(
              supabaseClient.from('smart_routine_completions').upsert({
                user_id: state.user.id,
                routine_id: routineId,
                date: d,
                status: 'postponed',
                completed: false,
                postponed_to: nextDayStr,
                carried_forward: false,
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,routine_id,date' })
            );

            // Carry forward to tomorrow (if not completed)
            const tomKey = `${routineId}_${nextDayStr}`;
            const tomComp = this.state.completions[tomKey];
            if (!tomComp || tomComp.status !== 'completed') {
              operations.push(
                supabaseClient.from('smart_routine_completions').upsert({
                  user_id: state.user.id,
                  routine_id: routineId,
                  date: nextDayStr,
                  status: 'pending',
                  completed: false,
                  carried_forward: true,
                  original_date: d,
                  title_override: tomComp?.titleOverride || null,
                  updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,routine_id,date' })
              );
            }
          });
        }

        // Persist report
        operations.push(
          supabaseClient.from('smart_routine_reports').upsert({
            id: report.id,
            user_id: state.user.id,
            date: d,
            total_routines: report.totalRoutines,
            completed_count: report.completedCount,
            incomplete_count: report.incompleteCount,
            postponed_count: report.postponedCount || 0,
            cancelled_count: report.cancelledCount || 0,
            eligible_count: report.eligibleCount || (report.totalRoutines - (report.cancelledCount || 0)),
            completion_rate: report.completionRate,
            status: report.status,
            completed_routines: report.completedRoutines || [],
            incomplete_routines: report.incompleteRoutines || [],
            postponed_routines: report.postponedRoutines || [],
            cancelled_routines: report.cancelledRoutines || [],
            carry_forward_decision: decision,
            updated_at: report.updatedAt
          }, { onConflict: 'user_id,date' })
        );

        const results = await Promise.all(operations);
        for (const res of results) {
          if (res?.error) throw res.error;
        }
      } else {
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        const response = await fetch(`${baseUrl}/api/smart-lists/carry-forward`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ date: d, decision })
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save carry-forward decision');
        }
        const payload = await response.json().catch(() => null);
        if (payload?.report) {
          const norm = this.normalizeReport(payload.report);
          const repIdx = this.state.reports.findIndex(r => r.date === d);
          if (repIdx !== -1) this.state.reports[repIdx] = norm;
          else this.state.reports.push(norm);
          report = norm;
        }
      }
    } catch (err) {
      const isInvalidUrlInNode = (err.code === 'ERR_INVALID_URL' || (typeof err.message === 'string' && err.message.includes('Failed to parse URL')));
      if (!isInvalidUrlInNode) {
        console.error('[SmartLists] Carry-forward persistence failed, rolling back:', err);
        // Rollback on failure so no false success state is displayed
        this.state.completions = rollbackCompletions;
        this.state.reports = rollbackReports;
        this.state.tomorrowRoutines = rollbackTomorrow;
        this.state.dailyStats = rollbackDailyStats;
        this.saveToStorage();
        this.renderRoutines();
        this.renderTomorrowRoutines();
        this.renderSummaryModal(report);
        const descEl = (typeof document !== 'undefined') ? document.getElementById('smart-carry-status-text') : null;
        if (descEl) {
          descEl.textContent = `Carry-forward failed: ${err.message || 'Network error'}. Changes rolled back.`;
          descEl.style.color = '#EF4444';
        }
        return false;
      }
    } finally {
      this.state.isProcessingCarryForward = false;
      if (btnYes) { btnYes.disabled = false; btnYes.classList.remove('loading'); }
      if (btnNo) { btnNo.disabled = false; }
    }

    // 3. IMMEDIATE UI REFRESH ON SUCCESS
    this.saveToStorage();
    this.computeLocalStreaksAndStats(d);
    await this.fetchTomorrowRoutines(d);
    this.renderRoutines();
    this.renderTomorrowRoutines();
    this.renderStreakWidget();
    this.renderSummaryModal(report);
    if (typeof renderAnalytics === 'function') {
      try { renderAnalytics(); } catch (_) {}
    }
    return report;
  },

  async resetCarryForwardDecision(date) {
    const d = date || this.state.activeReportDate || this.state.activeDate;
    const report = this.state.reports.find(r => r.date === d);
    if (!report) return null;

    report.carryForwardDecision = 'pending';
    this.saveToStorage();

    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);
    const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';

    if (isSupabaseAuth) {
      try {
        await supabaseClient
          .from('smart_routine_reports')
          .update({
            carry_forward_decision: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('user_id', state.user.id)
          .eq('date', d);
      } catch (err) {
        console.warn('[SmartLists] Supabase reset carry-forward warning:', err);
      }
    } else {
      try {
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        await fetch(`${baseUrl}/api/smart-lists/reports/${report.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ carryForwardDecision: 'pending' })
        });
      } catch (_) {}
    }

    this.renderSummaryModal(report);
    return report;
  },

  logPerformance(op, startT, localT, endT, details = {}) {
    const localMs = (localT - startT).toFixed(1);
    const cloudMs = endT ? (endT - localT).toFixed(1) : 'N/A';
    const totalMs = endT ? (endT - startT).toFixed(1) : localMs;
    console.log(`[SmartLists Perf] ${op} | Local UI: ${localMs}ms | Cloud Sync: ${cloudMs}ms | Total: ${totalMs}ms`, details);
  },

  // --- Next-Day Routine Management (v2.0.0 Build 11 & v2.1.0) ---
  async fetchTomorrowRoutines(targetDate) {
    const baseDate = targetDate || this.state.activeDate;
    const curParts = baseDate.split('-').map(Number);
    const nextDay = new Date(curParts[0], curParts[1] - 1, curParts[2]);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = (typeof toYmdString === 'function') ? toYmdString(nextDay) : nextDay.toISOString().slice(0, 10);

    let items = null;
    const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';
    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);

    // 1. Try fetching from backend API (Web / non-Supabase environments only)
    if (!isSupabaseAuth) {
      try {
        const headers = { ...getAuthHeaders() };
        const res = await fetch(`${baseUrl}/api/smart-lists/next-day?date=${nextDayStr}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.routines)) {
            items = data.routines;
            // Sync completion state into this.state.completions
            data.routines.forEach(r => {
              const key = `${r.routineId}_${nextDayStr}`;
              if (!this.state.completions[key] || r.carriedForward) {
                this.state.completions[key] = {
                  ...(this.state.completions[key] || {}),
                  status: r.status || 'pending',
                  completed: Boolean(r.completed),
                  carriedForward: Boolean(r.carriedForward),
                  originalDate: r.originalDate || null
                };
              }
            });
            this.saveToStorage();
          }
        }
      } catch (e) {
        // Backend not available
      }
    }

    // 2. Direct Supabase query if client is authenticated
    if (isSupabaseAuth) {
      try {
        const { data: compRows, error: compErr } = await supabaseClient
          .from('smart_routine_completions')
          .select('*')
          .eq('user_id', state.user.id)
          .eq('date', nextDayStr);

        if (!compErr && Array.isArray(compRows)) {
          compRows.forEach(item => {
            const key = `${item.routine_id}_${nextDayStr}`;
            const status = item.status || (item.completed ? 'completed' : 'pending');
            const isRemoved = status === 'removed' || (status === 'cancelled' && (item.cancellation_reason === 'removed_from_tomorrow' || item.cancellation_reason === 'created_for_future'));
            const existingTitleOverride = this.state.completions[key]?.titleOverride || item.title_override || item.titleOverride || null;

            this.state.completions[key] = {
              status: isRemoved ? 'removed' : status,
              removed: isRemoved,
              completed: status === 'completed',
              carriedForward: Boolean(item.carried_forward),
              postponedToDate: item.postponed_to || null,
              originalDate: item.original_date || null,
              cancellationReason: item.cancellation_reason || null,
              titleOverride: existingTitleOverride
            };
          });
          this.saveToStorage();
        }
      } catch (e) {
        console.warn('[SmartLists] Supabase tomorrow completions fetch error:', e);
      }
    }

    // 3. Fallback / direct construction from routines & completions
    if (!items) {
      items = [];
    }
    const routines = this.state.routines || [];
    routines.forEach(routine => {
      // Skip routines with start dates strictly after tomorrow
      if (routine.startDate && nextDayStr < routine.startDate) return;
      const comp = this.getCompletion(routine.id, nextDayStr);
      const isCarried = Boolean(comp?.carriedForward);
      // Skip routines with end dates before tomorrow unless explicitly carried forward
      if (routine.endDate && nextDayStr > routine.endDate && !isCarried) return;
      if (items.some(it => it.routineId === routine.id)) return;

      if (comp && (comp.status === 'removed' || comp.removed || (comp.status === 'cancelled' && (comp.cancellationReason === 'removed_from_tomorrow' || comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only')))) {
        return;
      }
      const displayTitle = comp.titleOverride || routine.title;
      items.push({
        routineId: routine.id,
        title: displayTitle,
        date: nextDayStr,
        status: comp.status || 'pending',
        completed: comp.status === 'completed',
        carriedForward: isCarried,
        originalDate: comp.originalDate || null,
        source: isCarried ? 'carried_forward' : 'scheduled'
      });
    });

    // Re-filter items against the latest completions (e.g. if Supabase or local state removed an item)
    items = items.filter(it => {
      // Must have an active parent routine in routines list
      if (!routines.some(r => r.id === (it.routineId || it.id))) {
        return false;
      }
      const comp = this.getCompletion(it.routineId, nextDayStr);
      if (comp && (comp.status === 'removed' || comp.removed || (comp.status === 'cancelled' && (comp.cancellationReason === 'removed_from_tomorrow' || comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only')))) {
        return false;
      }
      if (comp && comp.titleOverride) {
        it.title = comp.titleOverride;
      }
      return true;
    });

    this.state.tomorrowRoutines = items;
    this.state.tomorrowDate = nextDayStr;
    this.renderTomorrowRoutines();
    return items;
  },

  renderTomorrowRoutines() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('smart-tomorrow-routines-list');
    const emptyState = document.getElementById('smart-tomorrow-empty');
    const badge = document.getElementById('smart-tomorrow-count-badge');
    const dateLabel = document.getElementById('smart-tomorrow-date-label');

    if (!list) return;
    list.innerHTML = '';

    const items = this.state.tomorrowRoutines || [];
    const tomDate = this.state.tomorrowDate || this.getNextDayYmd(this.state.activeDate);

    if (badge) {
      badge.textContent = `${items.length} routine${items.length === 1 ? '' : 's'}`;
    }
    if (dateLabel) {
      dateLabel.textContent = tomDate;
    }

    if (items.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = `next-day-routine-card ${item.carriedForward ? 'origin-carried' : 'origin-scheduled'}`;
      card.setAttribute('data-routine-id', item.routineId);

      const left = document.createElement('div');
      left.className = 'next-day-routine-left';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'next-day-title';
      titleSpan.textContent = item.title;

      const meta = document.createElement('div');
      meta.className = 'next-day-meta';

      const originBadge = document.createElement('span');
      originBadge.className = `routine-origin-badge ${item.carriedForward ? 'badge-carried' : 'badge-scheduled'}`;
      if (item.carriedForward) {
        originBadge.textContent = '↳ Carried Forward';
        if (item.originalDate) {
          originBadge.title = `Carried forward from ${item.originalDate}`;
        }
      } else {
        originBadge.textContent = 'Scheduled';
      }
      meta.appendChild(originBadge);

      const statusBadge = document.createElement('span');
      statusBadge.className = `routine-tomorrow-status status-${item.status || 'pending'}`;
      statusBadge.textContent = item.status === 'completed' ? 'Done' : 'Pending';
      meta.appendChild(statusBadge);

      left.appendChild(titleSpan);
      left.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'next-day-card-actions next-day-routine-actions';

      // Edit Button (Pencil Icon) - Touch-friendly, accessible
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-tomorrow-action btn-tomorrow-edit';
      btnEdit.setAttribute('aria-label', `Edit tomorrow occurrence of ${item.title}`);
      btnEdit.title = 'Edit for tomorrow';
      btnEdit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditTomorrowModal(item.routineId, item.title);
      });

      // Delete Button (Trash Icon) - Touch-friendly, accessible
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-tomorrow-action btn-tomorrow-delete btn-tomorrow-remove';
      btnRemove.setAttribute('aria-label', `Delete ${item.title} from tomorrow`);
      btnRemove.title = 'Delete from tomorrow';
      btnRemove.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openRemoveTomorrowConfirm(item.routineId, item.title);
      });

      actions.appendChild(btnEdit);
      actions.appendChild(btnRemove);

      card.appendChild(left);
      card.appendChild(actions);
      list.appendChild(card);
    });
  },

  showTomorrowError(context, message) {
    if (typeof document === 'undefined') return;
    if (context === 'edit') {
      const errEl = document.getElementById('edit-tomorrow-error-msg');
      if (errEl) {
        errEl.textContent = message;
        errEl.style.display = 'block';
      }
    } else if (context === 'add') {
      const errEl = document.getElementById('add-tomorrow-error-msg');
      if (errEl) {
        errEl.textContent = message;
        errEl.style.display = 'block';
      }
    }
    if (typeof alert !== 'undefined') {
      alert(message);
    }
  },

  async addRoutineForTomorrow(title) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (!title || typeof title !== 'string' || !title.trim()) {
      this.showTomorrowError('add', 'Routine title cannot be empty.');
      return false;
    }
    const cleanTitle = title.trim().slice(0, 150);
    const tomDate = this.state.tomorrowDate || this.getNextDayYmd(this.state.activeDate);
    const todayDate = this.state.activeDate;

    // 1. Duplicate check on tomorrow's list (case-insensitive)
    const existing = this.state.tomorrowRoutines || [];
    if (existing.some(r => r.title.toLowerCase() === cleanTitle.toLowerCase())) {
      const msg = 'A routine with this name already exists for tomorrow.';
      this.showTomorrowError('add', msg);
      return false;
    }

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));

    const newRoutine = {
      id: newId,
      title: cleanTitle,
      orderIndex: (this.state.routines || []).length,
      startDate: tomDate,
      endDate: tomDate, // One-day assignment for tomorrow
      recurrence: 'once',
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    // Save pre-mutation snapshot for rollback
    const rollbackRoutines = JSON.parse(JSON.stringify(this.state.routines || []));
    const rollbackCompletions = JSON.parse(JSON.stringify(this.state.completions || {}));
    const rollbackTomorrow = JSON.parse(JSON.stringify(this.state.tomorrowRoutines || []));

    // Disable button to prevent duplicate clicks
    const btnSave = (typeof document !== 'undefined') ? document.getElementById('btn-save-tomorrow-routine') : null;
    if (btnSave) btnSave.disabled = true;

    // OPTIMISTIC LOCAL UI UPDATE (< 10ms)
    if (!this.state.routines) this.state.routines = [];
    this.state.routines.push(newRoutine);

    // Exclude from today
    this.state.completions[`${newId}_${todayDate}`] = {
      status: 'removed',
      removed: true,
      cancellationReason: 'created_for_future',
      completed: false
    };

    // Schedule for tomorrow
    this.state.completions[`${newId}_${tomDate}`] = {
      status: 'pending',
      completed: false,
      carriedForward: false
    };

    // Push into tomorrowRoutines list immediately
    this.state.tomorrowRoutines = [
      ...(this.state.tomorrowRoutines || []),
      {
        routineId: newId,
        title: cleanTitle,
        date: tomDate,
        status: 'pending',
        completed: false,
        carriedForward: false,
        originalDate: null,
        source: 'scheduled'
      }
    ];

    this.saveToStorage();
    this.renderTomorrowRoutines();
    this.renderRoutines();

    // Reset and hide form immediately
    if (typeof document !== 'undefined') {
      const box = document.getElementById('next-day-add-box');
      if (box) box.style.display = 'none';
      const form = document.getElementById('form-next-day-add');
      if (form) form.reset();
    }

    const tLocal = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);
    let supabaseRequests = 0;
    let expressRequests = 0;

    // ASYNC PERSISTENCE
    try {
      if (isSupabaseAuth) {
        supabaseRequests = 3;
        const [rRes, exRes, schRes] = await Promise.all([
          supabaseClient.from('smart_routines').insert({
            id: newId,
            user_id: state.user.id,
            title: cleanTitle,
            order_index: newRoutine.orderIndex
          }),
          supabaseClient.from('smart_routine_completions').upsert({
            user_id: state.user.id,
            routine_id: newId,
            date: todayDate,
            status: 'cancelled',
            cancellation_reason: 'created_for_future',
            completed: false
          }, { onConflict: 'user_id,routine_id,date' }),
          supabaseClient.from('smart_routine_completions').upsert({
            user_id: state.user.id,
            routine_id: newId,
            date: tomDate,
            status: 'pending',
            completed: false
          }, { onConflict: 'user_id,routine_id,date' })
        ]);
        if (rRes?.error) throw rRes.error;
      } else {
        expressRequests = 1;
        const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        const res = await fetch(`${baseUrl}/api/smart-lists/next-day/assign`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ routineId: newId, title: cleanTitle, date: tomDate, isOneDay: true })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save routine for tomorrow');
        }
      }
    } catch (err) {
      const isInvalidUrlInNode = (err.code === 'ERR_INVALID_URL' || (typeof err.message === 'string' && err.message.includes('Failed to parse URL')));
      if (isInvalidUrlInNode) {
        if (btnSave) btnSave.disabled = false;
        return true;
      }
      console.error('[SmartLists] Add tomorrow routine persistence failed, rolling back:', err);
      // Rollback
      this.state.routines = rollbackRoutines;
      this.state.completions = rollbackCompletions;
      this.state.tomorrowRoutines = rollbackTomorrow;
      this.saveToStorage();
      this.renderTomorrowRoutines();
      this.renderRoutines();
      this.showTomorrowError('add', err.message || 'Failed to save routine. Changes rolled back.');
      if (btnSave) btnSave.disabled = false;
      return false;
    } finally {
      if (btnSave) btnSave.disabled = false;
    }

    const tCloud = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    this.logPerformance('Add Tomorrow Routine', t0, tLocal, tCloud, {
      routineId: newId,
      title: cleanTitle,
      supabaseRequests,
      expressRequests
    });
    return true;
  },

  openEditTomorrowModal(routineId, currentTitle) {
    this.state.pendingEditTomorrowId = routineId;
    const idInput = document.getElementById('edit-tomorrow-routine-id');
    const titleInput = document.getElementById('input-edit-tomorrow-title');
    const modal = document.getElementById('modal-smart-edit-tomorrow');
    const errEl = document.getElementById('edit-tomorrow-error-msg');

    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
    if (idInput) idInput.value = routineId;
    if (titleInput) {
      titleInput.value = currentTitle || '';
      setTimeout(() => titleInput.focus(), 60);
    }
    if (modal) modal.classList.add('active');
  },

  closeEditTomorrowModal() {
    this.state.pendingEditTomorrowId = null;
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-smart-edit-tomorrow');
    if (modal) modal.classList.remove('active');
    const errEl = document.getElementById('edit-tomorrow-error-msg');
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
  },

  async updateTomorrowRoutine(routineId, newTitle) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    console.log('[SmartLists Diagnostic] updateTomorrowRoutine called:', { routineId, newTitle });
    if (!newTitle || typeof newTitle !== 'string' || !newTitle.trim()) {
      this.showTomorrowError('edit', 'Routine title cannot be empty.');
      return false;
    }
    const cleanTitle = newTitle.trim().slice(0, 150);
    const tomDate = this.state.tomorrowDate || this.getNextDayYmd(this.state.activeDate);

    // 1. Duplicate check on tomorrow (case-insensitive, excluding this routine)
    const existing = this.state.tomorrowRoutines || [];
    if (existing.some(r => r.routineId !== routineId && r.title.toLowerCase() === cleanTitle.toLowerCase())) {
      const msg = 'A routine with this name already exists for tomorrow.';
      this.showTomorrowError('edit', msg);
      return false;
    }

    // Verify parent routine exists before allowing edit
    const parentRoutine = (this.state.routines || []).find(r => r.id === routineId);
    if (!parentRoutine) {
      this.showTomorrowError('edit', 'Routine not found or has been deleted.');
      return false;
    }

    // Save snapshot for rollback
    const rollbackRoutines = JSON.parse(JSON.stringify(this.state.routines || []));
    const rollbackCompletions = JSON.parse(JSON.stringify(this.state.completions || {}));
    const rollbackTomorrow = JSON.parse(JSON.stringify(this.state.tomorrowRoutines || []));

    // Disable button to prevent double-tap
    const btnSave = (typeof document !== 'undefined') ? document.getElementById('btn-save-edit-tomorrow') : null;
    if (btnSave) btnSave.disabled = true;

    // OPTIMISTIC LOCAL UI UPDATE (< 10ms)
    // Updates only the selected tomorrow routine's name
    const tomKey = `${routineId}_${tomDate}`;
    if (!this.state.completions[tomKey]) {
      this.state.completions[tomKey] = { status: 'pending', completed: false };
    }
    this.state.completions[tomKey].titleOverride = cleanTitle;

    // Update item in tomorrowRoutines array directly
    const tomItem = (this.state.tomorrowRoutines || []).find(it => it.routineId === routineId);
    if (tomItem) {
      tomItem.title = cleanTitle;
    }

    this.saveToStorage();
    this.closeEditTomorrowModal();
    this.renderTomorrowRoutines();
    this.renderRoutines();

    const tLocal = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);
    let supabaseRequests = 0;
    let expressRequests = 0;

    // ASYNC PERSISTENCE (Authoritative Supabase on mobile, Express fallback on web)
    try {
      if (isSupabaseAuth) {
        supabaseRequests = 1;
        const { error: cErr } = await supabaseClient
          .from('smart_routine_completions')
          .upsert({
            user_id: state.user.id,
            routine_id: routineId,
            date: tomDate,
            status: this.state.completions[`${routineId}_${tomDate}`]?.status || 'pending',
            title_override: cleanTitle
          }, { onConflict: 'user_id,routine_id,date' });
        if (cErr) {
          if (cErr.message && cErr.message.includes('title_override')) {
            console.error('[SmartLists] Supabase schema cache error: title_override column missing or not refreshed on smart_routine_completions. Run scripts/005_smart_routine_title_override.sql.');
          }
          throw cErr;
        }
      } else {
        expressRequests = 1;
        const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        const res = await fetch(`${baseUrl}/api/smart-lists/next-day/occurrences/${encodeURIComponent(routineId)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            date: tomDate,
            title: cleanTitle
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to update routine for tomorrow');
        }
      }
    } catch (err) {
      const isInvalidUrlInNode = (err.code === 'ERR_INVALID_URL' || (typeof err.message === 'string' && err.message.includes('Failed to parse URL')));
      if (isInvalidUrlInNode) {
        if (btnSave) btnSave.disabled = false;
        return true;
      }
      console.error('[SmartLists] Update tomorrow routine persistence failed, rolling back:', err);
      // Rollback
      this.state.routines = rollbackRoutines;
      this.state.completions = rollbackCompletions;
      this.state.tomorrowRoutines = rollbackTomorrow;
      this.saveToStorage();
      this.renderTomorrowRoutines();
      this.renderRoutines();
      this.showTomorrowError('edit', err.message || 'Failed to update routine. Changes rolled back.');
      if (btnSave) btnSave.disabled = false;
      return false;
    } finally {
      if (btnSave) btnSave.disabled = false;
    }

    const tCloud = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    this.logPerformance('Edit Tomorrow Routine', t0, tLocal, tCloud, {
      routineId,
      newTitle: cleanTitle,
      supabaseRequests,
      expressRequests
    });
    return true;
  },

  openRemoveTomorrowConfirm(routineId, title) {
    this.state.pendingRemoveTomorrowId = routineId;
    this.state.pendingRemoveTomorrowTitle = title || 'this routine';
    const msgEl = document.getElementById('remove-tomorrow-confirm-message');
    if (msgEl) {
      msgEl.textContent = `Remove "${this.state.pendingRemoveTomorrowTitle}" from tomorrow only? The routine definition remains for all other days.`;
    }
    const modal = document.getElementById('modal-smart-remove-tomorrow-confirm');
    if (modal) modal.classList.add('active');
  },

  closeRemoveTomorrowConfirm() {
    this.state.pendingRemoveTomorrowId = null;
    this.state.pendingRemoveTomorrowTitle = '';
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-smart-remove-tomorrow-confirm');
    if (modal) modal.classList.remove('active');
  },

  async executeRemoveTomorrow() {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const routineId = this.state.pendingRemoveTomorrowId;
    const tomDate = this.state.tomorrowDate || this.getNextDayYmd(this.state.activeDate);
    if (!routineId) return false;
    console.log('[SmartLists Diagnostic] executeRemoveTomorrow started for routineId:', routineId, 'date:', tomDate);

    // Save rollback snapshot
    const rollbackCompletions = JSON.parse(JSON.stringify(this.state.completions || {}));
    const rollbackTomorrow = JSON.parse(JSON.stringify(this.state.tomorrowRoutines || []));

    // Disable button to prevent double-tap
    const btnProceed = (typeof document !== 'undefined') ? document.getElementById('btn-proceed-remove-tomorrow') : null;
    if (btnProceed) btnProceed.disabled = true;

    // OPTIMISTIC LOCAL UI UPDATE (< 10ms)
    this.state.completions[`${routineId}_${tomDate}`] = {
      status: 'removed',
      removed: true,
      cancellationReason: 'removed_from_tomorrow',
      completed: false
    };

    // Remove from tomorrowRoutines list immediately
    this.state.tomorrowRoutines = (this.state.tomorrowRoutines || []).filter(it => it.routineId !== routineId);

    this.saveToStorage();
    this.closeRemoveTomorrowConfirm();
    this.renderTomorrowRoutines();
    this.renderRoutines();

    const tLocal = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const isSupabaseAuth = Boolean(supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id);
    let supabaseRequests = 0;
    let expressRequests = 0;

    // ASYNC PERSISTENCE (Authoritative Supabase on mobile, Express fallback on web)
    try {
      if (isSupabaseAuth) {
        supabaseRequests = 1;

        // Check whether parent routine exists in smart_routines
        let parentExists = false;
        try {
          const { data: parentRoutine, error: parentErr } = await supabaseClient
            .from('smart_routines')
            .select('id')
            .eq('id', routineId)
            .eq('user_id', state.user.id)
            .maybeSingle();
          if (!parentErr && parentRoutine) {
            parentExists = true;
          }
        } catch (_) {
          parentExists = (this.state.routines || []).some(r => r.id === routineId);
        }

        if (!parentExists) {
          // Parent routine does NOT exist in smart_routines!
          // NEVER attempt to insert or upsert a completion record for a nonexistent parent.
          // Safely clean up any orphaned completion record for this routine ID.
          console.warn('[SmartLists] Parent routine missing during remove tomorrow; safely cleaning up orphaned completion without upsert:', routineId);
          try {
            await supabaseClient
              .from('smart_routine_completions')
              .delete()
              .eq('user_id', state.user.id)
              .eq('routine_id', routineId);
          } catch (_) {}
        } else {
          // Parent routine exists: safe to upsert cancellation for tomorrow
          const { error } = await supabaseClient
            .from('smart_routine_completions')
            .upsert({
              user_id: state.user.id,
              routine_id: routineId,
              date: tomDate,
              status: 'cancelled',
              cancellation_reason: 'removed_from_tomorrow',
              completed: false
            }, { onConflict: 'user_id,routine_id,date' });

          if (error) {
            // Check for foreign key constraint violation (e.g. concurrent routine deletion)
            if (error.message && (error.message.includes('foreign key constraint') || error.message.includes('smart_routine_completions_routine_id_fkey'))) {
              console.warn('[SmartLists] FK violation during remove tomorrow; cleaning up orphaned record:', error.message);
              try {
                await supabaseClient
                  .from('smart_routine_completions')
                  .delete()
                  .eq('user_id', state.user.id)
                  .eq('routine_id', routineId);
              } catch (_) {}
            } else {
              throw error;
            }
          }
        }
      } else {
        expressRequests = 1;
        const baseUrl = (typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : '') || '';
        const headers = { ...getAuthHeaders() };
        const res = await fetch(`${baseUrl}/api/smart-lists/next-day/occurrences/${encodeURIComponent(routineId)}?date=${tomDate}`, {
          method: 'DELETE',
          headers
        });
        if (!res.ok && res.status !== 404) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to remove routine from tomorrow');
        }
      }
    } catch (err) {
      const isInvalidUrlInNode = (err.code === 'ERR_INVALID_URL' || (typeof err.message === 'string' && err.message.includes('Failed to parse URL')));
      if (isInvalidUrlInNode) {
        if (btnProceed) btnProceed.disabled = false;
        return true;
      }

      // Check if error is foreign key violation: treat gracefully by cleaning up
      if (err.message && (err.message.includes('foreign key constraint') || err.message.includes('smart_routine_completions_routine_id_fkey'))) {
        console.warn('[SmartLists] Handled FK error in catch block for routine:', routineId);
        if (isSupabaseAuth) {
          try {
            await supabaseClient
              .from('smart_routine_completions')
              .delete()
              .eq('user_id', state.user.id)
              .eq('routine_id', routineId);
          } catch (_) {}
        }
        this.state.tomorrowRoutines = (this.state.tomorrowRoutines || []).filter(it => (it.routineId || it.id) !== routineId);
        this.saveToStorage();
        this.renderTomorrowRoutines();
        this.renderRoutines();
        if (btnProceed) btnProceed.disabled = false;
        return true;
      }

      console.error('[SmartLists] Remove tomorrow routine persistence failed, rolling back:', err);
      // Rollback
      this.state.completions = rollbackCompletions;
      this.state.tomorrowRoutines = rollbackTomorrow;
      this.saveToStorage();
      this.renderTomorrowRoutines();
      this.renderRoutines();
      if (typeof alert !== 'undefined') alert('Could not remove routine: ' + err.message);
      if (btnProceed) btnProceed.disabled = false;
      return false;
    } finally {
      if (btnProceed) btnProceed.disabled = false;
    }

    const tCloud = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    this.logPerformance('Delete Tomorrow Routine', t0, tLocal, tCloud, {
      routineId,
      date: tomDate,
      supabaseRequests,
      expressRequests
    });
    return true;
  },

  // --- Streak Reset & Cancellation Reversal (v2.0.0 Build 11) ---
  openResetStreakModal() {
    const modal = document.getElementById('modal-smart-reset-streak-confirm');
    if (modal) modal.classList.add('active');
  },

  closeResetStreakModal() {
    const modal = document.getElementById('modal-smart-reset-streak-confirm');
    if (modal) modal.classList.remove('active');
  },

  async executeStreakReset() {
    const resetTimestamp = new Date().toISOString();
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch('/api/smart-lists/streaks/reset', {
        method: 'POST',
        headers,
        body: JSON.stringify({ resetAt: resetTimestamp })
      });
    } catch (e) {
      console.warn('[SmartLists] executeStreakReset backend warning:', e);
    }

    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_settings')
          .upsert({
            user_id: state.user.id,
            streak_reset_at: resetTimestamp
          }, { onConflict: 'user_id' });
      } catch (_) {}
    }

    if (!this.state.settings) this.state.settings = {};
    this.state.settings.streakResetAt = resetTimestamp;
    this.saveToStorage();

    this.computeLocalStreaksAndStats(this.state.activeDate);
    this.renderStreakWidget();
    this.closeResetStreakModal();
  },

  async undoCancelRoutine(routineId, date) {
    const d = date || this.state.activeDate;
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch(`/api/smart-lists/routines/${routineId}/undo-cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ date: d })
      });
    } catch (e) {
      console.warn('[SmartLists] undoCancelRoutine backend warning:', e);
    }

    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_completions')
          .update({
            status: 'pending',
            completed: false,
            cancellation_reason: null
          })
          .eq('user_id', state.user.id)
          .eq('routine_id', routineId)
          .eq('date', d);
      } catch (_) {}
    }

    const key = `${routineId}_${d}`;
    if (this.state.completions[key]) {
      this.state.completions[key].status = 'pending';
      this.state.completions[key].completed = false;
      this.state.completions[key].cancellationReason = null;
    }
    this.saveToStorage();
    this.computeLocalStreaksAndStats(d);
    await this.generateDailyReport(d);
    this.renderRoutines();
  },

  // --- Settings & Notifications ---
  async fetchSettings() {
    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        const { data, error } = await supabaseClient
          .from('smart_routine_settings')
          .select('*')
          .eq('user_id', state.user.id)
          .single();
        if (!error && data) {
          this.state.settings = {
            dailySummaryEnabled: Boolean(data.daily_summary_enabled),
            dailySummaryTime: data.daily_summary_time || '22:00',
            streakResetAt: data.streak_reset_at || null
          };
          this.saveToStorage();
          return this.state.settings;
        }
      } catch (_) {}
    }

    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/smart-lists/settings', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.dailySummaryEnabled === 'boolean') {
          this.state.settings = data;
          this.saveToStorage();
          return this.state.settings;
        }
      }
    } catch (_) {}

    return this.state.settings;
  },

  async saveSettings(settings) {
    this.state.settings = {
      dailySummaryEnabled: typeof settings.dailySummaryEnabled === 'boolean'
        ? settings.dailySummaryEnabled
        : this.state.settings.dailySummaryEnabled,
      dailySummaryTime: typeof settings.dailySummaryTime === 'string' && settings.dailySummaryTime.trim()
        ? settings.dailySummaryTime.trim()
        : this.state.settings.dailySummaryTime
    };
    this.saveToStorage();

    if (supabaseClient && typeof supabaseClient.from === 'function' && state.user?.id) {
      try {
        await supabaseClient
          .from('smart_routine_settings')
          .upsert({
            user_id: state.user.id,
            daily_summary_enabled: this.state.settings.dailySummaryEnabled,
            daily_summary_time: this.state.settings.dailySummaryTime,
            updated_at: new Date().toISOString()
          });
      } catch (_) {}
    } else {
      try {
        const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
        await fetch('/api/smart-lists/settings', {
          method: 'POST',
          headers,
          body: JSON.stringify(this.state.settings)
        });
      } catch (_) {}
    }

    await this.scheduleDailySummaryReminder();
    return this.state.settings;
  },

  async saveSettingsFromUI() {
    const toggle = document.getElementById('toggle-smart-reminder');
    const timeInput = document.getElementById('input-smart-reminder-time');

    const enabled = toggle ? Boolean(toggle.checked) : true;
    const time = (timeInput && timeInput.value) ? timeInput.value : '22:00';

    await this.saveSettings({ dailySummaryEnabled: enabled, dailySummaryTime: time });
    this.closeSettingsModal();
  },

  async scheduleDailySummaryReminder() {
    const plugin = (typeof TasklyNotifications !== 'undefined') ? TasklyNotifications.getPlugin() : null;
    if (!plugin || typeof plugin.schedule !== 'function') return;

    // Check master notification setting
    const masterEnabled = (typeof TasklyNotifications !== 'undefined') ? TasklyNotifications.areNotificationsEnabled() : true;
    const featureEnabled = Boolean(this.state.settings.dailySummaryEnabled);

    // Cancel existing reminder to avoid duplicate scheduling
    try {
      if (typeof plugin.cancel === 'function') {
        await plugin.cancel({ notifications: [{ id: this.NOTIFICATION_ID }] });
      }
    } catch (_) {}

    if (!masterEnabled || !featureEnabled) {
      return;
    }

    const timeStr = this.state.settings.dailySummaryTime || '22:00';
    const parts = timeStr.split(':');
    const hour = parseInt(parts[0], 10) || 22;
    const minute = parseInt(parts[1], 10) || 0;

    const channelConfig = (typeof TasklyNotifications !== 'undefined') 
      ? TasklyNotifications.getActiveChannelConfig() 
      : { channelId: 'taskly-reminders-v3', sound: 'taskly_meow.wav' };

    try {
      await plugin.schedule({
        notifications: [
          {
            id: this.NOTIFICATION_ID,
            title: 'Daily Routine Summary',
            body: 'Review your daily routines and check today\'s completion report.',
            schedule: {
              on: { hour, minute },
              repeats: true,
              allowWhileIdle: true
            },
            channelId: channelConfig.channelId,
            sound: channelConfig.sound,
            smallIcon: 'ic_stat_paw',
            iconColor: '#38BDF8',
            extra: {
              type: 'smart_lists_summary'
            }
          }
        ]
      });
    } catch (e) {
      console.warn('[SmartLists] Native schedule warning:', e);
    }
  },

  // --- UI Operations & Rendering ---
  async openScreen() {
    this.state.activeDate = (typeof toYmdString === 'function') ? toYmdString(new Date()) : new Date().toISOString().slice(0, 10);
    showMainFlow('smart-lists');
    this.updateDateDisplay();
    this.computeLocalStreaksAndStats(this.state.activeDate);
    this.renderStreakWidget();
    this.renderRoutines();
    await this.fetchStreaksAndStats(this.state.activeDate).catch(() => {});
    await this.fetchTomorrowRoutines().catch(() => {});
  },

  updateDateDisplay() {
    if (typeof document === 'undefined') return;
    const dateEl = document.getElementById('smart-lists-date-display');
    if (dateEl) {
      const now = new Date();
      const options = { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' };
      dateEl.textContent = now.toLocaleDateString('en-US', options);
    }
  },

  renderRoutines() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('smart-routines-list');
    const emptyState = document.getElementById('smart-empty-state');
    const progressText = document.getElementById('smart-progress-text');
    const footerSub = document.getElementById('footer-summary-sub');

    if (!list) return;
    list.innerHTML = '';

    const routines = this.state.routines || [];
    const date = this.state.activeDate;

    if (routines.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (progressText) progressText.textContent = '0 / 0 completed';
      if (footerSub) footerSub.textContent = 'Add your routines to generate reports';
      this.renderStreakWidget();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    let completedCount = 0;
    let visibleCount = 0;

    routines.forEach(routine => {
      // Exclude routines with future start dates or past end dates
      if (routine.startDate && date < routine.startDate) {
        return;
      }
      if (routine.endDate && date > routine.endDate) {
        return;
      }

      const comp = this.getCompletion(routine.id, date);
      // Skip routines explicitly removed from this date or created for future
      if (comp && (comp.status === 'removed' || comp.removed === true || (comp.status === 'cancelled' && (comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only' || comp.cancellationReason === 'removed_from_tomorrow')))) {
        return;
      }

      visibleCount++;
      if (comp.completed) completedCount++;

      const displayTitle = comp.titleOverride || routine.title;

      const card = document.createElement('div');
      card.className = `smart-routine-card ${comp.completed ? 'completed' : ''} status-${comp.status || 'pending'}`;
      card.setAttribute('data-routine-id', routine.id);

      const left = document.createElement('div');
      left.className = 'smart-routine-left';

      // Checkbox wrap (1-tap quick toggle)
      const checkWrap = document.createElement('label');
      checkWrap.className = 'smart-checkbox-wrap';
      checkWrap.setAttribute('aria-label', `Mark ${displayTitle} as ${comp.completed ? 'incomplete' : 'complete'}`);

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = comp.completed;
      chk.addEventListener('change', () => {
        this.toggleCompletion(routine.id, date);
      });

      const customCheck = document.createElement('span');
      customCheck.className = 'smart-custom-check';
      customCheck.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>';

      checkWrap.appendChild(chk);
      checkWrap.appendChild(customCheck);

      // Info
      const info = document.createElement('div');
      info.className = 'smart-routine-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'routine-title';
      titleSpan.textContent = displayTitle;
      info.appendChild(titleSpan);

      // Status badges (postponed, cancelled, carried forward)
      const badgesContainer = document.createElement('div');
      badgesContainer.className = 'routine-badges-wrap';

      if (comp.status === 'postponed') {
        const postBadge = document.createElement('span');
        postBadge.className = 'badge-postponed';
        postBadge.textContent = comp.postponedToDate ? `↳ Postponed to ${comp.postponedToDate}` : '↳ Postponed';
        badgesContainer.appendChild(postBadge);
      } else if (comp.status === 'cancelled') {
        const cancBadge = document.createElement('span');
        cancBadge.className = 'badge-cancelled';
        cancBadge.textContent = comp.cancellationReason ? `✕ Cancelled: ${comp.cancellationReason}` : '✕ Cancelled';
        badgesContainer.appendChild(cancBadge);
      }

      if (comp.carriedForward) {
        const carryBadge = document.createElement('span');
        carryBadge.className = 'badge-carried-forward';
        carryBadge.textContent = '↳ Carried forward';
        badgesContainer.appendChild(carryBadge);
      }

      if (badgesContainer.children.length > 0) {
        info.appendChild(badgesContainer);
      }

      left.appendChild(checkWrap);
      left.appendChild(info);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'smart-routine-actions';

      // 4-state status selector pill button (touch target >= 44px)
      const btnStatusPill = document.createElement('button');
      btnStatusPill.type = 'button';
      btnStatusPill.className = `btn-routine-status-pill status-${comp.status || 'pending'}`;
      btnStatusPill.setAttribute('data-routine-id', routine.id);
      btnStatusPill.setAttribute('aria-label', `Change status for ${routine.title}. Current status: ${comp.status}`);

      let pillIcon = '○';
      let pillText = 'Pending';
      if (comp.status === 'completed') { pillIcon = '✓'; pillText = 'Done'; }
      else if (comp.status === 'postponed') { pillIcon = '↳'; pillText = 'Postponed'; }
      else if (comp.status === 'cancelled') { pillIcon = '✕'; pillText = 'Cancelled'; }

      btnStatusPill.innerHTML = `<span class="status-pill-icon">${pillIcon}</span><span class="status-pill-text">${pillText}</span>`;
      btnStatusPill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openStatusPicker(routine.id, date);
      });

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-routine-action btn-routine-edit';
      btnEdit.setAttribute('aria-label', `Edit ${routine.title}`);
      btnEdit.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditRoutine(routine.id);
      });

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn-routine-action btn-routine-delete';
      btnDelete.setAttribute('aria-label', `Delete ${routine.title}`);
      btnDelete.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDeleteConfirm('routine', routine.id, routine.title);
      });

      actions.appendChild(btnStatusPill);
      if (comp.status === 'cancelled') {
        const btnUndo = document.createElement('button');
        btnUndo.type = 'button';
        btnUndo.className = 'btn-routine-action btn-routine-undo-cancel';
        btnUndo.setAttribute('aria-label', `Undo cancellation for ${routine.title}`);
        btnUndo.setAttribute('title', 'Undo cancellation');
        btnUndo.textContent = 'Undo';
        btnUndo.addEventListener('click', (e) => {
          e.stopPropagation();
          this.undoCancelRoutine(routine.id, date);
        });
        actions.appendChild(btnUndo);
      }
      actions.appendChild(btnEdit);
      actions.appendChild(btnDelete);

      card.appendChild(left);
      card.appendChild(actions);
      list.appendChild(card);
    });

    if (visibleCount === 0) {
      if (emptyState) emptyState.style.display = 'flex';
    } else {
      if (emptyState) emptyState.style.display = 'none';
    }

    const total = visibleCount;
    const rate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    if (progressText) {
      progressText.textContent = `${completedCount} / ${total} completed • ${rate}%`;
    }
    if (footerSub) {
      footerSub.textContent = `${completedCount} of ${total} routines completed today (${rate}%)`;
    }
    this.renderStreakWidget();
    this.renderTomorrowRoutines();
  },

  // --- Routine Status Picker Modal (v2.0.0 Build 11) ---
  openStatusPicker(routineId, date) {
    const d = date || this.state.activeDate;
    const routine = this.state.routines.find(r => r.id === routineId);
    if (!routine) return;

    this.state.pendingStatusRoutineId = routineId;
    this.state.pendingStatusDate = d;

    const comp = this.getCompletion(routineId, d);
    this.state.pendingStatusSelection = comp.status || 'pending';

    const titleEl = document.getElementById('status-picker-routine-title');
    if (titleEl) titleEl.textContent = routine.title;

    // Prefill subform inputs
    const postponeInput = document.getElementById('input-postpone-date');
    const cancelInput = document.getElementById('input-cancel-reason');
    const tomorrow = this.getNextDayYmd(d);

    if (postponeInput) {
      postponeInput.value = comp.postponedToDate || tomorrow;
      postponeInput.min = tomorrow;
    }
    if (cancelInput) {
      cancelInput.value = comp.cancellationReason || '';
    }

    this.updateStatusPickerUI(this.state.pendingStatusSelection);

    const modal = document.getElementById('modal-smart-status-picker');
    if (modal) modal.classList.add('active');
  },

  updateStatusPickerUI(selectedStatus) {
    this.state.pendingStatusSelection = selectedStatus;
    const options = ['completed', 'pending', 'postponed', 'cancelled'];
    options.forEach(status => {
      const btn = document.getElementById(`opt-status-${status}`);
      if (btn) {
        if (status === selectedStatus) {
          btn.classList.add('selected');
        } else {
          btn.classList.remove('selected');
        }
      }
    });

    const postponeSubform = document.getElementById('status-subform-postpone');
    const cancelSubform = document.getElementById('status-subform-cancel');

    if (postponeSubform) {
      postponeSubform.style.display = (selectedStatus === 'postponed') ? 'block' : 'none';
    }
    if (cancelSubform) {
      cancelSubform.style.display = (selectedStatus === 'cancelled') ? 'block' : 'none';
    }
  },

  closeStatusPicker() {
    this.state.pendingStatusRoutineId = null;
    this.state.pendingStatusDate = null;
    this.state.pendingStatusSelection = null;
    const modal = document.getElementById('modal-smart-status-picker');
    if (modal) modal.classList.remove('active');
  },

  async confirmStatusPicker() {
    if (this.state.isUpdatingStatus) return; // Prevent duplicate clicks
    const routineId = this.state.pendingStatusRoutineId;
    const date = this.state.pendingStatusDate || this.state.activeDate;
    const status = this.state.pendingStatusSelection || 'pending';

    if (!routineId) {
      this.closeStatusPicker();
      return;
    }

    const postponeInput = document.getElementById('input-postpone-date');
    const cancelInput = document.getElementById('input-cancel-reason');
    const postponedToDate = postponeInput ? postponeInput.value : null;
    const cancellationReason = cancelInput ? cancelInput.value.trim() : null;

    const confirmBtn = document.getElementById('btn-confirm-status-picker');
    this.state.isUpdatingStatus = true;
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';
    }

    try {
      await this.setRoutineStatus(routineId, date, status, {
        postponedToDate,
        cancellationReason
      });
    } catch (e) {
      console.warn('[SmartLists] confirmStatusPicker error:', e);
    } finally {
      this.state.isUpdatingStatus = false;
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save Status';
      }
      this.closeStatusPicker();
    }
  },

  openEditRoutine(id) {
    const routine = this.state.routines.find(r => r.id === id);
    if (!routine) return;

    const editBox = document.getElementById('smart-edit-routine-box');
    const idInput = document.getElementById('edit-smart-routine-id');
    const titleInput = document.getElementById('input-smart-edit-title');

    if (idInput) idInput.value = routine.id;
    if (titleInput) {
      titleInput.value = routine.title;
      setTimeout(() => titleInput.focus(), 50);
    }
    if (editBox) editBox.style.display = 'block';
  },

  // --- Modals Management ---
  async openSummaryModal(targetDate) {
    const d = targetDate || this.state.activeDate;
    this.state.activeReportDate = d;

    // Generate or fetch report for date
    let rawReport = this.state.reports.find(r => r.date === d);
    if (!rawReport || d === this.state.activeDate) {
      rawReport = await this.generateDailyReport(d);
    }
    const report = this.normalizeReport(rawReport);
    this.renderSummaryModal(report);

    const modal = document.getElementById('modal-smart-summary');
    if (modal) modal.classList.add('active');
  },

  renderSummaryModal(report) {
    if (!report || typeof document === 'undefined') return;

    const d = report.date || this.state.activeReportDate || this.state.activeDate;

    // Format human date
    const dateParts = d.split('-').map(Number);
    const dObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const humanDate = dObj.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });

    const dateEl = document.getElementById('smart-summary-date');
    if (dateEl) dateEl.textContent = humanDate;

    const badgeEl = document.getElementById('smart-summary-status-badge');
    if (badgeEl) {
      badgeEl.textContent = report.statusBadge || report.status;
      badgeEl.className = 'report-status-badge ' + (
        (report.statusBadge === 'Exceptional' || report.status === 'Fully Completed') ? 'status-completed' :
        (report.statusBadge === 'Great Job' || report.statusBadge === 'Good Progress') ? 'status-partial' : 'status-not-started'
      );
    }

    // Metrics
    const totalEl = document.getElementById('summary-metric-total');
    const compEl = document.getElementById('summary-metric-completed');
    const incompEl = document.getElementById('summary-metric-incomplete');
    const postEl = document.getElementById('summary-metric-postponed');
    const cancEl = document.getElementById('summary-metric-cancelled');
    const rateEl = document.getElementById('summary-metric-rate');
    const barEl = document.getElementById('smart-summary-progress-bar');
    const compCountEl = document.getElementById('summary-completed-count');
    const incompCountEl = document.getElementById('summary-incomplete-count');

    if (totalEl) totalEl.textContent = String(report.totalRoutines);
    if (compEl) compEl.textContent = String(report.completedCount);
    if (incompEl) incompEl.textContent = String(report.incompleteCount);
    if (postEl) postEl.textContent = String(report.postponedCount || 0);
    if (cancEl) cancEl.textContent = String(report.cancelledCount || 0);
    if (rateEl) rateEl.textContent = `${report.completionRate}%`;
    if (barEl) barEl.style.width = `${report.completionRate}%`;
    if (compCountEl) compCountEl.textContent = String(report.completedCount);
    if (incompCountEl) incompCountEl.textContent = String(report.incompleteCount);

    // Section 1 - Completed List
    const compList = document.getElementById('smart-summary-completed-list');
    if (compList) {
      compList.innerHTML = '';
      if (report.completedRoutines && report.completedRoutines.length > 0) {
        report.completedRoutines.forEach(title => {
          const li = document.createElement('li');
          li.className = 'paper-list-item item-completed';
          li.innerHTML = `<span class="paper-check">✓</span> <span class="paper-routine-title">${title}</span>`;
          compList.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.className = 'empty-list-notice';
        li.textContent = 'No routines were completed on this date.';
        compList.appendChild(li);
      }
    }

    // Section 2 - Incomplete List
    const incompList = document.getElementById('smart-summary-incomplete-list');
    if (incompList) {
      incompList.innerHTML = '';
      if (report.incompleteRoutines && report.incompleteRoutines.length > 0) {
        report.incompleteRoutines.forEach(title => {
          const li = document.createElement('li');
          li.className = 'paper-list-item item-incomplete';
          li.innerHTML = `<span class="paper-bullet">○</span> <span class="paper-routine-title">${title}</span>`;
          incompList.appendChild(li);
        });
      } else if (report.totalRoutines === 0) {
        const li = document.createElement('li');
        li.className = 'empty-list-notice';
        li.textContent = 'No routines were scheduled on this date.';
        incompList.appendChild(li);
      } else {
        const li = document.createElement('li');
        li.className = 'empty-list-notice';
        li.textContent = 'All routines were completed successfully.';
        incompList.appendChild(li);
      }
    }

    // Section 3 - Carry Forward Section
    const carryCard = document.getElementById('smart-carry-forward-card');
    const carryActions = document.getElementById('smart-carry-actions-group');
    const carryBanner = document.getElementById('smart-carry-status-banner');
    const carryText = document.getElementById('smart-carry-status-text');
    const carryTag = document.getElementById('smart-carry-decision-tag');
    const btnViewTomorrow = document.getElementById('btn-summary-view-tomorrow');

    if (carryCard) {
      const decision = report.carryForwardDecision || 'pending';
      if (report.totalRoutines === 0 || (report.incompleteCount === 0 && (!report.postponedCount || report.postponedCount === 0))) {
        if (carryTag) carryTag.textContent = 'Carry Forward: NOT REQUIRED';
        if (carryText) carryText.textContent = 'All routines for this date were completed. No items need to be carried forward.';
        if (carryActions) carryActions.style.display = 'none';
        if (carryBanner) carryBanner.style.display = 'none';
        if (btnViewTomorrow) btnViewTomorrow.style.display = 'none';
      } else if (decision === 'yes') {
        if (carryTag) carryTag.textContent = 'Carry Forward: YES (Carried into tomorrow)';
        if (carryText) {
          carryText.textContent = report.closingStatement || 'Incomplete routines were scheduled into tomorrow\'s routine checklist.';
        }
        if (carryActions) carryActions.style.display = 'none';
        if (carryBanner) carryBanner.style.display = 'flex';
        if (btnViewTomorrow) btnViewTomorrow.style.display = 'inline-flex';
      } else if (decision === 'no') {
        if (carryTag) carryTag.textContent = 'Carry Forward: NO (Closed for today)';
        if (carryText) {
          carryText.textContent = report.closingStatement || 'These incomplete routines were closed and will not be carried into tomorrow.';
        }
        if (carryActions) carryActions.style.display = 'none';
        if (carryBanner) carryBanner.style.display = 'flex';
        if (btnViewTomorrow) btnViewTomorrow.style.display = 'none';
      } else {
        if (carryTag) carryTag.textContent = 'Carry Forward: PENDING';
        if (carryText) carryText.textContent = 'Would you like to carry forward today\'s incomplete routines into tomorrow?';
        if (carryActions) carryActions.style.display = 'flex';
        if (carryBanner) carryBanner.style.display = 'none';
        if (btnViewTomorrow) btnViewTomorrow.style.display = 'none';
      }
    }

    // Section 4 - Overall Result / Closing Statement
    const closingEl = document.getElementById('smart-summary-closing-statement');
    if (closingEl) {
      closingEl.textContent = report.closingStatement || 'Keep consistency going tomorrow!';
    }
  },

  closeSummaryModal() {
    const modal = document.getElementById('modal-smart-summary');
    if (modal) modal.classList.remove('active');
  },

  async openHistoryModal() {
    await this.fetchReports();
    this.renderHistoryList();
    const modal = document.getElementById('modal-smart-history');
    if (modal) modal.classList.add('active');
  },

  closeHistoryModal() {
    const modal = document.getElementById('modal-smart-history');
    if (modal) modal.classList.remove('active');
  },

  renderHistoryList() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('smart-history-list');
    const empty = document.getElementById('smart-history-empty');
    if (!list) return;

    list.innerHTML = '';
    const reports = this.state.reports || [];

    if (reports.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    reports.forEach(rawRep => {
      const rep = this.normalizeReport(rawRep);
      const parts = rep.date.split('-').map(Number);
      const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const human = dObj.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

      const item = document.createElement('div');
      item.className = 'smart-history-item';
      item.setAttribute('data-report-date', rep.date);

      const left = document.createElement('div');
      left.className = 'history-item-left';
      left.addEventListener('click', () => {
        this.closeHistoryModal();
        this.openSummaryModal(rep.date);
      });

      const rowHead = document.createElement('div');
      rowHead.className = 'history-row-header';

      const dateHeading = document.createElement('span');
      dateHeading.className = 'history-item-date';
      dateHeading.textContent = human;

      const badge = document.createElement('span');
      badge.className = 'history-status-badge ' + (
        (rep.statusBadge === 'Exceptional' || rep.status === 'Fully Completed') ? 'status-completed' :
        (rep.statusBadge === 'Great Job' || rep.statusBadge === 'Good Progress') ? 'status-partial' : 'status-not-started'
      );
      badge.textContent = rep.statusBadge || rep.status;

      rowHead.appendChild(dateHeading);
      rowHead.appendChild(badge);

      const statsRow = document.createElement('div');
      statsRow.className = 'history-row-stats';
      statsRow.innerHTML = `<span class="history-stats-count">${rep.completedCount} / ${rep.totalRoutines} completed</span> <span class="history-stats-rate">(${rep.completionRate}%)</span>`;

      left.appendChild(rowHead);
      left.appendChild(statsRow);

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';

      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn-history-view';
      btnView.textContent = 'View Report';
      btnView.addEventListener('click', () => {
        this.closeHistoryModal();
        this.openSummaryModal(rep.date);
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-history-delete';
      btnDel.setAttribute('aria-label', `Delete report for ${human}`);
      btnDel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      btnDel.addEventListener('click', () => {
        this.openDeleteConfirm('report', rep.date, human);
      });

      actions.appendChild(btnView);
      actions.appendChild(btnDel);

      item.appendChild(left);
      item.appendChild(actions);
      list.appendChild(item);
    });
  },

  openSettingsModal() {
    const toggle = document.getElementById('toggle-smart-reminder');
    const timeInput = document.getElementById('input-smart-reminder-time');

    if (toggle) toggle.checked = Boolean(this.state.settings.dailySummaryEnabled);
    if (timeInput) timeInput.value = this.state.settings.dailySummaryTime || '22:00';

    const modal = document.getElementById('modal-smart-settings');
    if (modal) modal.classList.add('active');
  },

  closeSettingsModal() {
    const modal = document.getElementById('modal-smart-settings');
    if (modal) modal.classList.remove('active');
  },

  openDeleteConfirm(type, id, label) {
    this.state.pendingDeleteType = type;
    this.state.pendingDeleteId = id;

    const msgEl = document.getElementById('smart-delete-confirm-message');
    if (msgEl) {
      if (type === 'routine') {
        msgEl.textContent = `Are you sure you want to delete "${label}"? It will be removed from future daily lists. Past historical reports will be preserved.`;
      } else {
        msgEl.textContent = `Are you sure you want to delete the daily summary report for ${label}? Saved routines will remain safe.`;
      }
    }

    const modal = document.getElementById('modal-smart-delete-confirm');
    if (modal) modal.classList.add('active');
  },

  closeDeleteConfirm() {
    this.state.pendingDeleteType = null;
    this.state.pendingDeleteId = null;
    const modal = document.getElementById('modal-smart-delete-confirm');
    if (modal) modal.classList.remove('active');
  },

  async executePendingDelete() {
    const type = this.state.pendingDeleteType;
    const id = this.state.pendingDeleteId;
    this.closeDeleteConfirm();

    if (type === 'routine' && id) {
      await this.deleteRoutine(id);
    } else if (type === 'report' && id) {
      await this.deleteReport(id);
    }
  }
};

if (typeof window !== 'undefined') {
  window.SmartListsManager = SmartListsManager;
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================
function setupEventListeners() {
  // Screen 2: Carousel Navigation (Back to previous slide)
  const btnBackToLaunch = document.getElementById('btn-back-to-launch');
  if (btnBackToLaunch) {
    btnBackToLaunch.addEventListener('click', () => {
      if (state.carouselIndex > 0) {
        updateCarouselSlide(state.carouselIndex - 1);
      }
    });
  }

  const btnNextSlide = document.getElementById('btn-next-slide');
  if (btnNextSlide) {
    btnNextSlide.addEventListener('click', () => {
      updateCarouselSlide(state.carouselIndex + 1);
    });
  }

  const btnGetStarted = document.getElementById('btn-get-started');
  if (btnGetStarted) {
    btnGetStarted.addEventListener('click', () => {
      handleFinishOnboarding();
    });
  }

  const btnSkip = document.getElementById('btn-skip-onboarding');
  if (btnSkip) {
    btnSkip.addEventListener('click', () => {
      handleSkipOnboarding();
    });
  }

  // Stepper dots click
  document.querySelectorAll('.carousel-dots .dot').forEach((dot, i) => {
    dot.addEventListener('click', () => updateCarouselSlide(i));
  });

  // Screen 3: Back to Carousel
  const btnBackToCarousel = document.getElementById('btn-back-to-carousel');
  if (btnBackToCarousel) {
    btnBackToCarousel.addEventListener('click', () => {
      showOnboardingStep('carousel');
    });
  }

  // Auth Mode Toggles (Sign In vs Create Account)
  const btnToggleLogin = document.getElementById('btn-toggle-login');
  const btnToggleSignup = document.getElementById('btn-toggle-signup');

  if (btnToggleLogin) btnToggleLogin.addEventListener('click', () => setAuthMode('login'));
  if (btnToggleSignup) btnToggleSignup.addEventListener('click', () => setAuthMode('signup'));

  // Password Visibility Toggle Listeners
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  if (btnTogglePassword) {
    btnTogglePassword.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePasswordVisibility();
    });
  }
  const btnToggleSigninPass = document.getElementById('btn-toggle-signin-pass');
  if (btnToggleSigninPass) {
    btnToggleSigninPass.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePasswordVisibility('input-signin-pass', btnToggleSigninPass);
    });
  }
  const btnToggleSignupPass = document.getElementById('btn-toggle-signup-pass');
  if (btnToggleSignupPass) {
    btnToggleSignupPass.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePasswordVisibility('input-signup-pass', btnToggleSignupPass);
    });
  }

  // Screen 3: Profile Setup Form / Supabase Auth
  const formProfileSetup = document.getElementById('form-profile-setup');
  if (formProfileSetup) {
    formProfileSetup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('setup-email');
      const passwordInput = document.getElementById('setup-password');
      const nameInput = document.getElementById('setup-name');
      const ageInput = document.getElementById('setup-age');
      const submitBtn = document.getElementById('btn-auth-submit');
      const authErrorMsg = document.getElementById('auth-error-msg');

      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      const name = nameInput?.value.trim() || 'User';
      const age = parseInt(ageInput?.value, 10) || 18;

      if (!email || !password) {
        if (authErrorMsg) {
          authErrorMsg.textContent = 'Please provide both email and password.';
          authErrorMsg.style.display = 'flex';
          authErrorMsg.style.borderColor = '#fecaca';
          authErrorMsg.style.background = '#fef2f2';
          authErrorMsg.style.color = '#dc2626';
        }
        return;
      }

      if (state.authMode === 'signup' && password.length < 6) {
        if (authErrorMsg) {
          authErrorMsg.textContent = 'Password must be at least 6 characters long.';
          authErrorMsg.style.display = 'flex';
          authErrorMsg.style.borderColor = '#fecaca';
          authErrorMsg.style.background = '#fef2f2';
          authErrorMsg.style.color = '#dc2626';
        }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (authErrorMsg) authErrorMsg.style.display = 'none';

      try {
        if (!supabaseClient) {
          // If supabaseClient isn't initialized yet, try to initialize it once
          await initSupabaseAuth();
        }

        if (supabaseClient) {
          if (state.authMode === 'signup') {
            const redirectUrl = getAuthRedirectUrl();
            const isNative = Boolean(
              (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) ||
              (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android') ||
              (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'ios') ||
              (typeof window !== 'undefined' && window.location?.protocol === 'capacitor:') ||
              (typeof window !== 'undefined' && window.location?.protocol === 'ionic:') ||
              (typeof window !== 'undefined' && window.location?.hostname === 'localhost' && window.location?.port === '' && !window.location?.origin?.includes(':3000'))
            );
            const isLocalWeb = typeof window !== 'undefined' && window.location?.origin &&
              (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')) &&
              !isNative;

            // In deployed web or Capacitor, require a valid redirect URL; never silently omit emailRedirectTo
            if (!isLocalWeb && !redirectUrl) {
              if (authErrorMsg) {
                authErrorMsg.style.display = 'flex';
                authErrorMsg.style.borderColor = '#fecaca';
                authErrorMsg.style.background = '#fef2f2';
                authErrorMsg.style.color = '#dc2626';
                authErrorMsg.textContent = 'Registration service is temporarily unavailable. Missing redirect configuration.';
              }
              if (submitBtn) submitBtn.disabled = false;
              return;
            }

            const signUpOptions = {
              data: { name, age }
            };
            if (redirectUrl) {
              signUpOptions.emailRedirectTo = redirectUrl;
            }

            const { data, error } = await supabaseClient.auth.signUp({
              email,
              password,
              options: signUpOptions
            });
            if (error) throw error;

            state.user.name = name;
            state.user.age = age;
            state.user.email = email;
            saveUserPreferences();

            const isConfirmed = Boolean(
              data.user?.email_confirmed_at ||
              data.user?.confirmed_at ||
              data.session?.user?.email_confirmed_at ||
              data.session?.user?.confirmed_at
            );

            if (data.session && isConfirmed) {
              syncAuthSession(data.session);
              showOnboardingStep('welcome');
            } else {
              if (supabaseClient && data.session) {
                try { await supabaseClient.auth.signOut(); } catch (_) {}
              }
              syncAuthSignOut();
              if (authErrorMsg) {
                authErrorMsg.style.display = 'flex';
                authErrorMsg.style.borderColor = '#93c5fd';
                authErrorMsg.style.background = '#eff6ff';
                authErrorMsg.style.color = '#1d4ed8';
                authErrorMsg.textContent = 'Account created! Please check your email to confirm registration.';
              }
            }
          } else {
            // Sign In
            const { data, error } = await supabaseClient.auth.signInWithPassword({
              email,
              password
            });
            if (error) throw error;

            const isEmailVerified = Boolean(
              data.user?.email_confirmed_at ||
              data.user?.confirmed_at ||
              data.session?.user?.email_confirmed_at ||
              data.session?.user?.confirmed_at ||
              (data.user?.app_metadata && data.user.app_metadata.provider && data.user.app_metadata.provider !== 'email')
            );

            if (!isEmailVerified) {
              if (supabaseClient) {
                try { await supabaseClient.auth.signOut(); } catch (_) {}
              }
              syncAuthSignOut();
              throw new Error('Please verify your email address before signing in. Check your inbox for the confirmation link.');
            }

            if (data.session) {
              syncAuthSession(data.session);
              setOnboardingCompleted(true);
              showMainFlow('home');
            }
          }
        } else {
          // Authentication requires active Supabase service - never fallback to mock authentication
          throw new Error('Authentication service is currently unavailable. Please check your connection and configuration.');
        }
      } catch (err) {
        console.error('Auth error:', err);
        if (authErrorMsg) {
          authErrorMsg.style.display = 'flex';
          authErrorMsg.style.borderColor = '#fecaca';
          authErrorMsg.style.background = '#fef2f2';
          authErrorMsg.style.color = '#dc2626';
          authErrorMsg.textContent = err.message || 'Authentication failed. Please verify credentials.';
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Screen 4: Back to Profile Setup
  const btnBackToSetup = document.getElementById('btn-back-to-setup');
  if (btnBackToSetup) {
    btnBackToSetup.addEventListener('click', () => {
      showOnboardingStep('profile-setup');
    });
  }

  // Screen 4: Welcome & Enter Home
  const btnEnterHome = document.getElementById('btn-enter-home');
  if (btnEnterHome) {
    btnEnterHome.addEventListener('click', () => {
      if (!isAuthenticated() && !(isLocalPreview() && state.isPreviewSession)) {
        console.warn('[Auth Guard]: Blocked unauthenticated attempt to enter home.');
        showOnboardingStep('profile-setup');
        return;
      }
      setOnboardingCompleted(true);
      if (isLocalPreview() && state.isPreviewSession) {
        initPreviewData();
      }
      showMainFlow('home');
    });
  }

  // Local Preview: Helper button to skip straight to dashboard with sample data
  const btnPreviewSkip = document.getElementById('btn-preview-skip-to-app');
  if (btnPreviewSkip) {
    btnPreviewSkip.addEventListener('click', () => {
      if (!isLocalPreview()) return;
      initPreviewData();
      showMainFlow('home');
    });
  }

  // Local Preview: Exit preview banner button
  const btnExitPreview = document.getElementById('btn-exit-preview');
  if (btnExitPreview) {
    btnExitPreview.addEventListener('click', () => {
      state.isPreviewSession = false;
      state.todos = [];
      updatePreviewUI();
      showOnboardingStep('profile-setup');
    });
  }

  // Bottom Navigation Tabs
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      showMainFlow(tabBtn.dataset.tab);
    });
  });

  // Desktop Navigation Header Links
  document.querySelectorAll('.desktop-nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      showMainFlow(btn.dataset.tab);
    });
  });

  // Desktop Brand Click -> Home Dashboard
  const brandEl = document.querySelector('.desktop-brand');
  if (brandEl) {
    brandEl.style.cursor = 'pointer';
    brandEl.addEventListener('click', () => showMainFlow('home'));
  }

  // Browser Back/Forward Navigation Support
  window.addEventListener('hashchange', () => {
    restoreActiveRoute();
  });
  window.addEventListener('popstate', () => {
    restoreActiveRoute();
  });

  // Desktop Header Actions
  const btnDeskAdd = document.getElementById('btn-desktop-add-task');
  if (btnDeskAdd) {
    btnDeskAdd.addEventListener('click', () => showMainFlow('add'));
  }

  const btnDeskTheme = document.getElementById('btn-desktop-theme');
  if (btnDeskTheme) {
    btnDeskTheme.addEventListener('click', () => {
      const cycle = { light: 'dark', dark: 'pet', pet: 'pastel', pastel: 'light', day: 'dark' };
      const nextTheme = cycle[state.theme] || 'light';
      applyTheme(nextTheme);
    });
  }

  // Quick Capture in Home Dashboard
  const btnQcSave = document.getElementById('btn-qc-save');
  const qcInput = document.getElementById('qc-input-text');
  if (btnQcSave) {
    btnQcSave.addEventListener('click', saveQuickNote);
  }
  if (qcInput) {
    qcInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveQuickNote();
      }
    });
  }

  const btnDeskUser = document.getElementById('btn-desktop-user-profile');
  if (btnDeskUser) {
    btnDeskUser.addEventListener('click', () => showMainFlow('profile'));
  }

  // Dashboard Filter Pills (All / Today / Pending / Completed)
  document.querySelectorAll('#home-filter-pills .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.dashboardFilter = btn.dataset.filter;
      renderHome();
    });
  });

  // Stat Card Quick Clicks (Filter Tasks)
  const cardStatTotal = document.getElementById('card-stat-total');
  const cardStatCompleted = document.getElementById('card-stat-completed');
  const cardStatPending = document.getElementById('card-stat-pending');
  if (cardStatTotal) cardStatTotal.addEventListener('click', () => {
    state.dashboardFilter = 'all';
    renderHome();
  });
  if (cardStatCompleted) cardStatCompleted.addEventListener('click', () => {
    state.dashboardFilter = 'completed';
    renderHome();
  });
  if (cardStatPending) cardStatPending.addEventListener('click', () => {
    state.dashboardFilter = 'pending';
    renderHome();
  });

  // Desktop Sidebar Quick Actions
  const btnQuickNew = document.getElementById('btn-quick-new-task');
  const btnQuickCal = document.getElementById('btn-quick-calendar');
  const btnQuickClear = document.getElementById('btn-quick-clear-completed');
  if (btnQuickNew) btnQuickNew.addEventListener('click', () => showMainFlow('add'));
  if (btnQuickCal) btnQuickCal.addEventListener('click', () => showMainFlow('calendar'));
  if (btnQuickClear) btnQuickClear.addEventListener('click', handleClearCompleted);

  // FAB Add Task
  const navBtnAdd = document.getElementById('nav-btn-add');
  if (navBtnAdd) {
    navBtnAdd.addEventListener('click', () => {
      showMainFlow('add');
    });
  }

  // Dashboard Header Avatar Click -> Profile
  const btnAvatar = document.getElementById('btn-header-avatar');
  if (btnAvatar) {
    btnAvatar.addEventListener('click', () => {
      showMainFlow('profile');
    });
  }

  // Dashboard "View All" -> Calendar
  const btnViewAll = document.getElementById('btn-view-all-tasks');
  if (btnViewAll) {
    btnViewAll.addEventListener('click', () => {
      showMainFlow('calendar');
    });
  }

  // Calendar Month Navigation
  const btnCalPrev = document.getElementById('btn-cal-prev');
  const btnCalNext = document.getElementById('btn-cal-next');
  if (btnCalPrev) btnCalPrev.addEventListener('click', () => changeCalendarMonth(-1));
  if (btnCalNext) btnCalNext.addEventListener('click', () => changeCalendarMonth(1));

  // Calendar View Toggle (Month Grid vs 7-Day Strip)
  const btnToggleMonthView = document.getElementById('btn-toggle-month-view');
  if (btnToggleMonthView) {
    btnToggleMonthView.addEventListener('click', toggleCalendarViewMode);
  }

  // Calendar Floating Add Task FAB
  const btnCalAddFab = document.getElementById('btn-cal-add-fab');
  if (btnCalAddFab) {
    btnCalAddFab.addEventListener('click', () => {
      state.previousTab = 'calendar';
      const dateInput = document.getElementById('add-due-date');
      if (dateInput && state.selectedDateStr) {
        dateInput.value = state.selectedDateStr;
      }
      showMainFlow('add');
    });
  }

  // Calendar Undated Tasks Toggle
  const btnToggleUndated = document.getElementById('btn-toggle-undated');
  const undatedList = document.getElementById('calendar-undated-list');
  const undatedChevron = document.getElementById('undated-chevron');
  if (btnToggleUndated && undatedList) {
    btnToggleUndated.addEventListener('click', () => {
      const isHidden = undatedList.style.display === 'none';
      undatedList.style.display = isHidden ? 'flex' : 'none';
      if (undatedChevron) undatedChevron.textContent = isHidden ? '▾' : '›';
    });
  }

  // Profile Drawer Menu Items
  const menuTrack = document.getElementById('menu-track-tasks');
  const menuAppt = document.getElementById('menu-appointments');
  const menuProg = document.getElementById('menu-progress');
  const menuFaq = document.getElementById('menu-faq');
  const btnProfileNotif = document.getElementById('btn-profile-notifications');

  if (menuTrack) menuTrack.addEventListener('click', () => showMainFlow('home'));
  if (menuAppt) menuAppt.addEventListener('click', () => showMainFlow('calendar'));
  if (menuProg) menuProg.addEventListener('click', () => showMainFlow('progress'));

  if (btnProfileNotif) {
    btnProfileNotif.addEventListener('click', () => {
      TasklyNotifications.openModal();
    });
  }
  const btnHomeNotif = document.getElementById('btn-home-notifications');
  if (btnHomeNotif) {
    btnHomeNotif.addEventListener('click', () => {
      TasklyNotifications.openModal();
    });
  }
  const btnDesktopNotif = document.getElementById('btn-desktop-notifications');
  if (btnDesktopNotif) {
    btnDesktopNotif.addEventListener('click', () => {
      TasklyNotifications.openModal();
    });
  }
  const btnCloseNotif = document.getElementById('btn-close-notifications');
  if (btnCloseNotif) {
    btnCloseNotif.addEventListener('click', () => {
      TasklyNotifications.closeModal();
    });
  }
  const modalNotifs = document.getElementById('modal-notifications');
  if (modalNotifs) {
    modalNotifs.addEventListener('click', (e) => {
      if (e.target === modalNotifs) TasklyNotifications.closeModal();
    });
  }
  const btnNotifMarkAll = document.getElementById('btn-notif-mark-all');
  if (btnNotifMarkAll) {
    btnNotifMarkAll.addEventListener('click', () => {
      TasklyNotifications.markAllAsRead();
    });
  }
  const btnNotifClearAll = document.getElementById('btn-notif-clear-all');
  if (btnNotifClearAll) {
    btnNotifClearAll.addEventListener('click', () => {
      TasklyNotifications.clearHistory();
    });
  }

  // Quick Reminder Prompt & Picker Listeners (Part 5)
  const btnPromptReminderNo = document.getElementById('btn-prompt-reminder-no');
  if (btnPromptReminderNo) {
    btnPromptReminderNo.addEventListener('click', closeQuickReminderPromptModal);
  }
  const btnPromptReminderYes = document.getElementById('btn-prompt-reminder-yes');
  if (btnPromptReminderYes) {
    btnPromptReminderYes.addEventListener('click', () => {
      const noteId = state.pendingReminderNoteId;
      closeQuickReminderPromptModal();
      openQuickReminderPicker(noteId);
    });
  }
  const modalPrompt = document.getElementById('modal-quick-reminder-prompt');
  if (modalPrompt) {
    modalPrompt.addEventListener('click', (e) => {
      if (e.target === modalPrompt) closeQuickReminderPromptModal();
    });
  }

  const btnClosePicker = document.getElementById('btn-close-reminder-picker');
  const btnCancelPicker = document.getElementById('btn-cancel-reminder-picker');
  if (btnClosePicker) btnClosePicker.addEventListener('click', closeQuickReminderPicker);
  if (btnCancelPicker) btnCancelPicker.addEventListener('click', closeQuickReminderPicker);
  const modalPicker = document.getElementById('modal-quick-reminder-picker');
  if (modalPicker) {
    modalPicker.addEventListener('click', (e) => {
      if (e.target === modalPicker) closeQuickReminderPicker();
    });
  }
  const formPicker = document.getElementById('form-quick-reminder-picker');
  if (formPicker) {
    formPicker.addEventListener('submit', handleConfirmQuickReminder);
  }

  // Edit Quick Note Modal Listeners
  const btnCloseEditQn = document.getElementById('btn-close-edit-quick-note');
  const btnCancelEditQn = document.getElementById('btn-cancel-edit-quick-note');
  if (btnCloseEditQn) btnCloseEditQn.addEventListener('click', closeEditQuickNoteModal);
  if (btnCancelEditQn) btnCancelEditQn.addEventListener('click', closeEditQuickNoteModal);
  const modalEditQn = document.getElementById('modal-edit-quick-note');
  if (modalEditQn) {
    modalEditQn.addEventListener('click', (e) => {
      if (e.target === modalEditQn) closeEditQuickNoteModal();
    });
  }
  const formEditQn = document.getElementById('form-edit-quick-note');
  if (formEditQn) {
    formEditQn.addEventListener('submit', handleSaveEditQuickNote);
  }
  const btnRemoveNoteReminder = document.getElementById('btn-remove-note-reminder');
  if (btnRemoveNoteReminder) {
    btnRemoveNoteReminder.addEventListener('click', handleRemoveNoteReminder);
  }

  // FAQ Modal Navigation & Real-time Search
  const modalFaq = document.getElementById('modal-faq');
  const btnCloseFaqModal = document.getElementById('btn-close-faq-modal');
  const btnCloseFaqOk = document.getElementById('btn-close-faq-ok');
  const faqSearchInput = document.getElementById('faq-search-input');
  const btnClearFaqSearch = document.getElementById('btn-clear-faq-search');

  if (menuFaq) {
    menuFaq.addEventListener('click', () => {
      if (modalFaq) {
        modalFaq.classList.add('active');
        if (faqSearchInput) {
          faqSearchInput.value = '';
          filterFaqItems('');
        }
      }
    });
  }
  if (btnCloseFaqModal) {
    btnCloseFaqModal.addEventListener('click', () => {
      if (modalFaq) modalFaq.classList.remove('active');
    });
  }
  if (btnCloseFaqOk) {
    btnCloseFaqOk.addEventListener('click', () => {
      if (modalFaq) modalFaq.classList.remove('active');
    });
  }
  if (modalFaq) {
    modalFaq.addEventListener('click', (e) => {
      if (e.target === modalFaq) {
        modalFaq.classList.remove('active');
      }
    });
  }

  if (faqSearchInput) {
    faqSearchInput.addEventListener('input', (e) => {
      filterFaqItems(e.target.value);
    });
  }
  if (btnClearFaqSearch) {
    btnClearFaqSearch.addEventListener('click', () => {
      if (faqSearchInput) {
        faqSearchInput.value = '';
        faqSearchInput.focus();
        filterFaqItems('');
      }
    });
  }

  // Add Task Back Button
  const btnBackFromAdd = document.getElementById('btn-back-from-add');
  if (btnBackFromAdd) {
    btnBackFromAdd.addEventListener('click', () => {
      showMainFlow('home');
    });
  }

  // Add Task Form Submit
  const formAdd = document.getElementById('form-add-task');
  if (formAdd) {
    formAdd.addEventListener('submit', handleAddTask);
  }

  // Add Task Priority Selectors
  document.querySelectorAll('#add-priority-selector .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#add-priority-selector .pill-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Add Task Category Selectors
  document.querySelectorAll('#add-category-selector .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#add-category-selector .pill-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const addCatSel = document.getElementById('add-task-category');
      if (addCatSel && btn.dataset && btn.dataset.val) {
        const targetVal = btn.dataset.val;
        let found = false;
        if (addCatSel.options) {
          for (let i = 0; i < addCatSel.options.length; i++) {
            if (addCatSel.options[i] && addCatSel.options[i].value.toLowerCase() === targetVal.toLowerCase()) {
              addCatSel.selectedIndex = i;
              found = true;
              break;
            }
          }
        }
        if (!found && !['project', 'work', 'study', 'personal'].includes(targetVal.toLowerCase())) {
          try {
            const opt = new Option(`${targetVal} (Custom)`, targetVal, true, true);
            addCatSel.add(opt);
          } catch (_) {}
        }
        addCatSel.value = targetVal;
      }
    });
  });

  // Add Task Category Select Dropdown sync with pills
  const addCatSelect = document.getElementById('add-task-category');
  if (addCatSelect) {
    addCatSelect.addEventListener('change', () => {
      const val = addCatSelect.value;
      if (val === '__new_custom__') {
        const inputRow = document.getElementById('add-custom-category-input-row');
        if (inputRow) {
          inputRow.style.display = 'flex';
          const inputField = document.getElementById('input-new-custom-category');
          if (inputField) inputField.focus();
        }
        return;
      }
      const selector = document.getElementById('add-category-selector');
      if (selector) {
        selector.querySelectorAll('.pill-opt').forEach(b => {
          b.classList.remove('active');
          if (b.classList.contains('opt-cat-custom')) {
            b.style.backgroundColor = 'transparent';
            b.style.color = 'inherit';
          }
          if (b.dataset && b.dataset.val && b.dataset.val.toLowerCase() === val.toLowerCase()) {
            b.classList.add('active');
            if (b.classList.contains('opt-cat-custom')) {
              b.style.backgroundColor = '#FACC15';
              b.style.color = '#422006';
            }
          }
        });
      }
    });
  }

  // Live Time Display Synchronizers (Add Task & Edit Task)
  const addTimeInput = document.getElementById('add-time');
  const addTimeDisplay = document.getElementById('add-time-display');
  if (addTimeInput && addTimeDisplay) {
    const syncAddTime = () => {
      if (addTimeInput.value) {
        addTimeDisplay.textContent = formatTime24To12(addTimeInput.value);
      }
    };
    addTimeInput.addEventListener('input', syncAddTime);
    addTimeInput.addEventListener('change', syncAddTime);
  }

  const editTimeInput = document.getElementById('edit-task-time');
  const editTimeDisplay = document.getElementById('edit-task-time-display');
  if (editTimeInput && editTimeDisplay) {
    const syncEditTime = () => {
      if (editTimeInput.value) {
        editTimeDisplay.textContent = formatTime24To12(editTimeInput.value);
      }
    };
    editTimeInput.addEventListener('input', syncEditTime);
    editTimeInput.addEventListener('change', syncEditTime);
  }

  // Custom Category Listeners (Add Task & Edit Task)
  const btnSaveNewCustom = document.getElementById('btn-save-new-custom-category');
  const btnCancelNewCustom = document.getElementById('btn-cancel-new-custom-category');
  const inputNewCustom = document.getElementById('input-new-custom-category');
  const addCustomRow = document.getElementById('add-custom-category-input-row');

  if (btnSaveNewCustom && inputNewCustom) {
    btnSaveNewCustom.addEventListener('click', () => {
      try {
        const saved = saveCustomCategory(inputNewCustom.value);
        syncCustomCategoriesToDOM(saved);
        inputNewCustom.value = '';
        if (addCustomRow) addCustomRow.style.display = 'none';
      } catch (err) {
        alert(err.message || 'Could not save category.');
      }
    });
  }

  if (btnCancelNewCustom && addCustomRow) {
    btnCancelNewCustom.addEventListener('click', () => {
      addCustomRow.style.display = 'none';
    });
  }

  const editCatSelect = document.getElementById('edit-task-category');
  const editCustomRow = document.getElementById('edit-custom-category-input-row');
  const editCustomInput = document.getElementById('input-edit-new-custom-category');
  const btnSaveEditCustom = document.getElementById('btn-save-edit-custom-category');
  const btnCancelEditCustom = document.getElementById('btn-cancel-edit-custom-category');

  if (editCatSelect) {
    editCatSelect.addEventListener('change', () => {
      if (editCatSelect.value === '__new_custom__') {
        if (editCustomRow) {
          editCustomRow.style.display = 'flex';
          if (editCustomInput) {
            editCustomInput.value = '';
            editCustomInput.focus();
          }
        }
      } else if (editCustomRow) {
        editCustomRow.style.display = 'none';
      }
    });
  }

  if (btnSaveEditCustom && editCustomInput && editCatSelect) {
    btnSaveEditCustom.addEventListener('click', () => {
      try {
        const saved = saveCustomCategory(editCustomInput.value);
        syncCustomCategoriesToDOM(saved);
        if (editCustomRow) editCustomRow.style.display = 'none';
      } catch (err) {
        alert(err.message || 'Could not save category.');
      }
    });
  }

  if (btnCancelEditCustom && editCustomRow && editCatSelect) {
    btnCancelEditCustom.addEventListener('click', () => {
      editCustomRow.style.display = 'none';
      editCatSelect.value = 'Personal';
    });
  }

  // Initial Custom Categories DOM Sync
  syncCustomCategoriesToDOM();

  // Progress Timeframe Segmented Control
  document.querySelectorAll('#progress-timeframe-filter .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#progress-timeframe-filter .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.analyticsTimeframe = btn.dataset.timeframe;
      renderAnalytics();
    });
  });

  // Profile Edit Modal
  const btnOpenEdit = document.getElementById('btn-open-edit-modal');
  const btnEditAvatar = document.getElementById('btn-edit-avatar');
  const modalEdit = document.getElementById('modal-edit-profile');
  const btnCloseEdit = document.getElementById('btn-close-edit-modal');
  const btnCancelEdit = document.getElementById('btn-cancel-edit');
  const formEditProfile = document.getElementById('form-edit-profile');

  function openEditModal() {
    const editName = document.getElementById('edit-name');
    const editAge = document.getElementById('edit-age');
    const editEmail = document.getElementById('edit-email');
    if (editEmail) {
      const isPreview = Boolean(state.isPreviewSession && isLocalPreview());
      editEmail.value = isPreview ? 'preview@local.test' : (state.user.email || '');
    }
    if (editName) editName.value = state.user.name || 'User';
    if (editAge) editAge.value = state.user.age || 18;
    if (modalEdit) modalEdit.classList.add('active');
  }

  function closeEditModal() {
    if (modalEdit) modalEdit.classList.remove('active');
  }

  if (btnOpenEdit) btnOpenEdit.addEventListener('click', openEditModal);
  if (btnEditAvatar) btnEditAvatar.addEventListener('click', openEditModal);
  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  if (formEditProfile) {
    formEditProfile.addEventListener('submit', (e) => {
      e.preventDefault();
      const editName = document.getElementById('edit-name');
      const editAge = document.getElementById('edit-age');
      state.user.name = editName.value.trim() || state.user.name;
      state.user.age = parseInt(editAge.value, 10) || state.user.age;
      saveUserPreferences();
      closeEditModal();
      renderAll();
    });
  }

  // Task Edit Modal Event Handlers
  const btnCloseEditTask = document.getElementById('btn-close-edit-task');
  const btnCancelEditTask = document.getElementById('btn-cancel-edit-task');
  const formEditTask = document.getElementById('form-edit-task');
  const modalEditTask = document.getElementById('modal-edit-task');

  if (btnCloseEditTask) btnCloseEditTask.addEventListener('click', closeEditTaskModal);
  if (btnCancelEditTask) btnCancelEditTask.addEventListener('click', closeEditTaskModal);
  if (modalEditTask) {
    modalEditTask.addEventListener('click', (e) => {
      if (e.target === modalEditTask) closeEditTaskModal();
    });
  }
  if (formEditTask) {
    formEditTask.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (formEditTask.dataset.saving === 'true') {
        return; // Guard against duplicate submissions
      }

      const saveBtn = document.getElementById('btn-save-edit-task') || formEditTask.querySelector('button[type="submit"]');
      const errBanner = document.getElementById('edit-task-error-banner');
      const errMsg = document.getElementById('edit-task-error-msg');
      if (errBanner) errBanner.style.display = 'none';

      const idInput = document.getElementById('edit-task-id');
      const titleInput = document.getElementById('edit-task-title');
      const descInput = document.getElementById('edit-task-desc');
      const dateInput = document.getElementById('edit-task-date');
      const priorityInput = document.getElementById('edit-task-priority');
      const catInput = document.getElementById('edit-task-category');

      const id = idInput ? idInput.value : null;
      const title = titleInput ? titleInput.value.trim() : '';
      if (!id || !title) {
        if (errBanner && errMsg) {
          errMsg.textContent = 'Please provide a valid task title.';
          errBanner.style.display = 'flex';
        }
        return;
      }

      let selectedCat = catInput ? catInput.value : 'Personal';
      if (selectedCat === '__new_custom__') {
        const customPrompt = typeof prompt === 'function' ? prompt('Enter new category name:') : null;
        if (customPrompt && customPrompt.trim()) {
          try {
            selectedCat = saveCustomCategory(customPrompt.trim());
          } catch (cErr) {
            alert(cErr.message || 'Invalid category name');
            return;
          }
        } else {
          return;
        }
      }

      formEditTask.dataset.saving = 'true';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';
      }

      try {
        const timeInput = document.getElementById('edit-task-time');
        const timeVal = (timeInput && timeInput.value) ? formatTime24To12(timeInput.value) : null;
        const reminderInput = document.getElementById('edit-task-reminder');
        const reminderVal = Boolean(reminderInput ? reminderInput.checked : false);

        const updates = {
          title,
          description: descInput ? descInput.value.trim() : '',
          dueDate: dateInput && dateInput.value ? dateInput.value : null,
          time: timeVal,
          priority: priorityInput ? priorityInput.value : 'Medium',
          category: selectedCat,
          reminder: reminderVal
        };

        await updateTask(id, updates);
        closeEditTaskModal();
      } catch (err) {
        console.error('Failed to update task:', err);
        if (errBanner && errMsg) {
          errMsg.textContent = err.message || 'Failed to save changes. Please try again.';
          errBanner.style.display = 'flex';
        } else if (typeof alert === 'function') {
          alert(err.message || 'Failed to save changes.');
        }
        // Retain user input in the form, do not close the modal
      } finally {
        formEditTask.dataset.saving = 'false';
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = saveBtn.dataset.originalText || 'Save Changes';
        }
      }
    });
  }

  // Theme Selection Modal in Profile
  const modalTheme = document.getElementById('modal-theme');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const btnCloseThemeModal = document.getElementById('btn-close-theme-modal');
  const btnExploreModes = document.getElementById('btn-explore-modes');
  const themeMoreSection = document.getElementById('theme-more-section');
  const optLight = document.getElementById('theme-choice-light');
  const optDay = document.getElementById('theme-choice-day');
  const optDark = document.getElementById('theme-choice-dark');
  const optPet = document.getElementById('theme-choice-pet');
  const optPastel = document.getElementById('theme-choice-pastel');

  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      if (modalTheme) modalTheme.classList.add('active');
      // If user currently has an additional theme active, ensure it is visible in expanded section
      if (state.theme === 'pet' || state.theme === 'pastel') {
        if (themeMoreSection && btnExploreModes) {
          btnExploreModes.setAttribute('aria-expanded', 'true');
          btnExploreModes.classList.add('expanded');
          themeMoreSection.style.display = 'block';
          const iconEl = btnExploreModes.querySelector('.explore-btn-icon');
          if (iconEl) iconEl.textContent = '▴';
        }
      }
    });
  }
  if (btnCloseThemeModal) {
    btnCloseThemeModal.addEventListener('click', () => {
      if (modalTheme) modalTheme.classList.remove('active');
    });
  }
  if (modalTheme) {
    modalTheme.addEventListener('click', (e) => {
      if (e.target === modalTheme) {
        modalTheme.classList.remove('active');
      }
    });
  }

  // Explore More Modes toggle button
  if (btnExploreModes && themeMoreSection) {
    btnExploreModes.addEventListener('click', () => {
      const isExpanded = btnExploreModes.getAttribute('aria-expanded') === 'true';
      const willExpand = !isExpanded;
      btnExploreModes.setAttribute('aria-expanded', String(willExpand));
      btnExploreModes.classList.toggle('expanded', willExpand);
      themeMoreSection.style.display = willExpand ? 'block' : 'none';
      const iconEl = btnExploreModes.querySelector('.explore-btn-icon');
      if (iconEl) iconEl.textContent = willExpand ? '▴' : '▾';
    });
  }

  const selectThemeOption = (themeName) => {
    applyTheme(themeName);
    if (modalTheme) modalTheme.classList.remove('active');
  };

  if (optLight) optLight.addEventListener('click', () => selectThemeOption('light'));
  if (optDay && optDay !== optLight) optDay.addEventListener('click', () => selectThemeOption('day'));
  if (optDark) optDark.addEventListener('click', () => selectThemeOption('dark'));
  if (optPet) optPet.addEventListener('click', () => selectThemeOption('pet'));
  if (optPastel) optPastel.addEventListener('click', () => selectThemeOption('pastel'));

  // Onboarding Tour in Profile
  const btnOpenTour = document.getElementById('btn-open-tour');
  if (btnOpenTour) {
    btnOpenTour.addEventListener('click', () => {
      state.carouselIndex = 0;
      showOnboardingStep('carousel');
    });
  }

  // About Taskly Modal
  const menuAbout = document.getElementById('menu-about');
  const btnOpenAbout = document.getElementById('btn-open-about');
  const modalAbout = document.getElementById('modal-about');
  const btnCloseAbout = document.getElementById('btn-close-about-modal');
  const btnCloseAboutOk = document.getElementById('btn-close-about-ok');

  function openAboutModal() {
    if (modalAbout) modalAbout.classList.add('active');
  }
  function closeAboutModal() {
    if (modalAbout) modalAbout.classList.remove('active');
  }

  if (menuAbout) menuAbout.addEventListener('click', openAboutModal);
  if (btnOpenAbout) btnOpenAbout.addEventListener('click', openAboutModal);
  if (btnCloseAbout) btnCloseAbout.addEventListener('click', closeAboutModal);
  if (btnCloseAboutOk) btnCloseAboutOk.addEventListener('click', closeAboutModal);
  if (modalAbout) {
    modalAbout.addEventListener('click', (e) => {
      if (e.target === modalAbout) closeAboutModal();
    });
  }

  // Version & Updates Modal
  const menuVersion = document.getElementById('menu-version');
  const btnOpenVersion = document.getElementById('btn-open-version');
  const modalVersion = document.getElementById('modal-version');
  const btnCloseVersion = document.getElementById('btn-close-version-modal');
  const btnCloseVersionOk = document.getElementById('btn-close-version-ok');
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnUpdateNow = document.getElementById('btn-update-now');
  const btnCancelDownload = document.getElementById('btn-cancel-download');
  const btnToggleVersionHistory = document.getElementById('btn-toggle-version-history');

  if (menuVersion) menuVersion.addEventListener('click', () => TasklyUpdateManager.openModal());
  if (btnOpenVersion) btnOpenVersion.addEventListener('click', () => TasklyUpdateManager.openModal());
  if (btnCloseVersion) btnCloseVersion.addEventListener('click', () => TasklyUpdateManager.closeModal());
  if (btnCloseVersionOk) btnCloseVersionOk.addEventListener('click', () => TasklyUpdateManager.closeModal());
  if (btnCheckUpdates) btnCheckUpdates.addEventListener('click', () => TasklyUpdateManager.checkForUpdates(true));
  if (btnUpdateNow) btnUpdateNow.addEventListener('click', () => TasklyUpdateManager.startUpdate());
  if (btnCancelDownload) btnCancelDownload.addEventListener('click', () => TasklyUpdateManager.cancelDownload());
  if (btnToggleVersionHistory) btnToggleVersionHistory.addEventListener('click', () => TasklyUpdateManager.toggleHistory());
  if (modalVersion) {
    modalVersion.addEventListener('click', (e) => {
      if (e.target === modalVersion) TasklyUpdateManager.closeModal();
    });
  }

  // What's New Modal Event Listeners
  const btnOpenWhatsNew = document.getElementById('btn-open-whats-new-modal');
  const modalWhatsNew = document.getElementById('modal-whats-new');
  const btnCloseWhatsNew = document.getElementById('btn-close-whats-new-modal');
  const btnWhatsNewBackVersion = document.getElementById('btn-whats-new-back-version');
  const btnWhatsNewDismiss = document.getElementById('btn-whats-new-dismiss');
  const selectWhatsNewVersion = document.getElementById('select-whats-new-version');

  if (btnOpenWhatsNew) {
    btnOpenWhatsNew.addEventListener('click', () => TasklyUpdateManager.openWhatsNew());
  }
  if (btnCloseWhatsNew) {
    btnCloseWhatsNew.addEventListener('click', () => TasklyUpdateManager.closeWhatsNew());
  }
  if (btnWhatsNewBackVersion) {
    btnWhatsNewBackVersion.addEventListener('click', () => {
      TasklyUpdateManager.closeWhatsNew();
      TasklyUpdateManager.openModal();
    });
  }
  if (btnWhatsNewDismiss) {
    btnWhatsNewDismiss.addEventListener('click', () => TasklyUpdateManager.dismissWhatsNew());
  }
  if (selectWhatsNewVersion) {
    selectWhatsNewVersion.addEventListener('change', (e) => {
      TasklyUpdateManager.renderWhatsNew(e.target.value);
    });
  }
  if (modalWhatsNew) {
    modalWhatsNew.addEventListener('click', (e) => {
      if (e.target === modalWhatsNew) TasklyUpdateManager.closeWhatsNew();
    });
  }

  // Update Announcement Modal Event Listeners
  const modalUpdateAnnouncement = document.getElementById('modal-update-announcement');
  const btnCloseUpdateAnnouncement = document.getElementById('btn-close-update-announcement');
  const btnAnnouncementLater = document.getElementById('btn-announcement-later');
  const btnAnnouncementInstall = document.getElementById('btn-announcement-install');

  if (btnCloseUpdateAnnouncement) {
    btnCloseUpdateAnnouncement.addEventListener('click', () => TasklyUpdateManager.dismissUpdateAnnouncement());
  }
  if (btnAnnouncementLater) {
    btnAnnouncementLater.addEventListener('click', () => TasklyUpdateManager.dismissUpdateAnnouncement());
  }
  if (btnAnnouncementInstall) {
    btnAnnouncementInstall.addEventListener('click', () => TasklyUpdateManager.handleInstallNowFromAnnouncement());
  }
  if (modalUpdateAnnouncement) {
    modalUpdateAnnouncement.addEventListener('click', (e) => {
      if (e.target === modalUpdateAnnouncement) TasklyUpdateManager.dismissUpdateAnnouncement();
    });
  }

  // Change Password Modal
  const menuChangePassword = document.getElementById('menu-change-password');
  const modalChangePassword = document.getElementById('modal-change-password');
  const btnCloseChangePassword = document.getElementById('btn-close-change-password-modal');
  const btnCancelChangePassword = document.getElementById('btn-cancel-change-password');
  const formChangePassword = document.getElementById('form-change-password');

  if (menuChangePassword) menuChangePassword.addEventListener('click', openChangePasswordModal);
  if (btnCloseChangePassword) btnCloseChangePassword.addEventListener('click', closeChangePasswordModal);
  if (btnCancelChangePassword) btnCancelChangePassword.addEventListener('click', closeChangePasswordModal);
  if (formChangePassword) formChangePassword.addEventListener('submit', handleChangePassword);
  if (modalChangePassword) {
    modalChangePassword.addEventListener('click', (e) => {
      if (e.target === modalChangePassword) closeChangePasswordModal();
    });
  }

  wirePasswordToggle('btn-toggle-current-password', 'input-current-password');
  wirePasswordToggle('btn-toggle-new-password', 'input-new-password');
  wirePasswordToggle('btn-toggle-confirm-password', 'input-confirm-password');

  // Smart Lists Event Listeners (v1.9.0 Build 10)
  const menuSmartLists = document.getElementById('menu-smart-lists');
  const btnOpenSmartLists = document.getElementById('btn-open-smart-lists');
  const btnBackFromSmart = document.getElementById('btn-back-from-smart-lists');
  const btnOpenSmartSummary = document.getElementById('btn-open-smart-summary');
  const btnFooterSmartSummary = document.getElementById('btn-smart-footer-summary');
  const btnOpenSmartSettings = document.getElementById('btn-open-smart-settings');

  if (menuSmartLists) menuSmartLists.addEventListener('click', () => SmartListsManager.openScreen());
  if (btnOpenSmartLists) btnOpenSmartLists.addEventListener('click', () => SmartListsManager.openScreen());
  if (btnBackFromSmart) btnBackFromSmart.addEventListener('click', () => showMainFlow('profile'));
  if (btnOpenSmartSummary) btnOpenSmartSummary.addEventListener('click', () => SmartListsManager.openSummaryModal());
  if (btnFooterSmartSummary) btnFooterSmartSummary.addEventListener('click', () => SmartListsManager.openSummaryModal());
  if (btnOpenSmartSettings) btnOpenSmartSettings.addEventListener('click', () => SmartListsManager.openSettingsModal());

  // Add routine triggers
  const btnToggleAddRoutine = document.getElementById('btn-toggle-add-routine');
  const btnEmptyAddRoutine = document.getElementById('btn-empty-add-routine');
  const btnCancelAddRoutine = document.getElementById('btn-cancel-add-routine');
  const formAddRoutine = document.getElementById('form-smart-add-routine');
  const inputAddRoutine = document.getElementById('input-smart-routine-title');

  if (btnToggleAddRoutine) {
    btnToggleAddRoutine.addEventListener('click', () => {
      if (formAddRoutine) {
        formAddRoutine.style.display = 'flex';
        btnToggleAddRoutine.style.display = 'none';
        if (inputAddRoutine) inputAddRoutine.focus();
      }
    });
  }
  if (btnEmptyAddRoutine) {
    btnEmptyAddRoutine.addEventListener('click', () => {
      if (formAddRoutine) {
        formAddRoutine.style.display = 'flex';
        if (btnToggleAddRoutine) btnToggleAddRoutine.style.display = 'none';
        if (inputAddRoutine) inputAddRoutine.focus();
      }
    });
  }
  if (btnCancelAddRoutine) {
    btnCancelAddRoutine.addEventListener('click', () => {
      if (formAddRoutine) {
        formAddRoutine.style.display = 'none';
        formAddRoutine.reset();
      }
      if (btnToggleAddRoutine) btnToggleAddRoutine.style.display = 'flex';
    });
  }
  if (formAddRoutine) {
    formAddRoutine.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = inputAddRoutine ? inputAddRoutine.value : '';
      await SmartListsManager.addRoutine(val);
      if (formAddRoutine) {
        formAddRoutine.style.display = 'none';
        formAddRoutine.reset();
      }
      if (btnToggleAddRoutine) btnToggleAddRoutine.style.display = 'flex';
    });
  }

  // Edit routine form
  const formEditRoutine = document.getElementById('form-smart-edit-routine');
  const editBox = document.getElementById('smart-edit-routine-box');
  const btnCancelEditRoutine = document.getElementById('btn-cancel-edit-routine');
  if (btnCancelEditRoutine) {
    btnCancelEditRoutine.addEventListener('click', () => {
      if (editBox) editBox.style.display = 'none';
      if (formEditRoutine) formEditRoutine.reset();
    });
  }
  if (formEditRoutine) {
    formEditRoutine.addEventListener('submit', async (e) => {
      e.preventDefault();
      const idInput = document.getElementById('edit-smart-routine-id');
      const titleInput = document.getElementById('input-smart-edit-title');
      if (idInput && titleInput) {
        await SmartListsManager.updateRoutine(idInput.value, titleInput.value);
      }
      if (editBox) editBox.style.display = 'none';
      if (formEditRoutine) formEditRoutine.reset();
    });
  }

  // Summary modal listeners
  const modalSmartSummary = document.getElementById('modal-smart-summary');
  const btnCloseSmartSummary = document.getElementById('btn-close-smart-summary');
  const btnCloseSmartSummaryOk = document.getElementById('btn-close-smart-summary-ok');
  const btnCarryYes = document.getElementById('btn-carry-forward-yes');
  const btnCarryNo = document.getElementById('btn-carry-forward-no');
  const btnChangeCarry = document.getElementById('btn-change-carry-forward');
  const btnSmartOpenHistory = document.getElementById('btn-smart-open-history');

  if (btnCloseSmartSummary) btnCloseSmartSummary.addEventListener('click', () => SmartListsManager.closeSummaryModal());
  if (btnCloseSmartSummaryOk) btnCloseSmartSummaryOk.addEventListener('click', () => SmartListsManager.closeSummaryModal());
  if (modalSmartSummary) {
    modalSmartSummary.addEventListener('click', (e) => {
      if (e.target === modalSmartSummary) SmartListsManager.closeSummaryModal();
    });
  }
  if (btnCarryYes) {
    btnCarryYes.addEventListener('click', async () => {
      const date = SmartListsManager.state.activeReportDate || SmartListsManager.state.activeDate;
      await SmartListsManager.setCarryForwardDecision(date, 'yes');
    });
  }
  if (btnCarryNo) {
    btnCarryNo.addEventListener('click', async () => {
      const date = SmartListsManager.state.activeReportDate || SmartListsManager.state.activeDate;
      await SmartListsManager.setCarryForwardDecision(date, 'no');
    });
  }
  if (btnChangeCarry) {
    btnChangeCarry.addEventListener('click', async () => {
      const date = SmartListsManager.state.activeReportDate || SmartListsManager.state.activeDate;
      await SmartListsManager.resetCarryForwardDecision(date);
    });
  }
  if (btnSmartOpenHistory) {
    btnSmartOpenHistory.addEventListener('click', () => {
      SmartListsManager.closeSummaryModal();
      SmartListsManager.openHistoryModal();
    });
  }

  // History modal listeners
  const modalSmartHistory = document.getElementById('modal-smart-history');
  const btnCloseSmartHistory = document.getElementById('btn-close-smart-history');
  const btnCloseSmartHistoryOk = document.getElementById('btn-close-smart-history-ok');
  if (btnCloseSmartHistory) btnCloseSmartHistory.addEventListener('click', () => SmartListsManager.closeHistoryModal());
  if (btnCloseSmartHistoryOk) {
    btnCloseSmartHistoryOk.addEventListener('click', () => {
      SmartListsManager.closeHistoryModal();
      SmartListsManager.openSummaryModal();
    });
  }
  if (modalSmartHistory) {
    modalSmartHistory.addEventListener('click', (e) => {
      if (e.target === modalSmartHistory) SmartListsManager.closeHistoryModal();
    });
  }

  // Settings modal listeners
  const modalSmartSettings = document.getElementById('modal-smart-settings');
  const btnCloseSmartSettings = document.getElementById('btn-close-smart-settings');
  const btnCancelSmartSettings = document.getElementById('btn-cancel-smart-settings');
  const btnSaveSmartSettings = document.getElementById('btn-save-smart-settings');
  if (btnCloseSmartSettings) btnCloseSmartSettings.addEventListener('click', () => SmartListsManager.closeSettingsModal());
  if (btnCancelSmartSettings) btnCancelSmartSettings.addEventListener('click', () => SmartListsManager.closeSettingsModal());
  if (btnSaveSmartSettings) btnSaveSmartSettings.addEventListener('click', () => SmartListsManager.saveSettingsFromUI());
  if (modalSmartSettings) {
    modalSmartSettings.addEventListener('click', (e) => {
      if (e.target === modalSmartSettings) SmartListsManager.closeSettingsModal();
    });
  }

  // Delete confirm modal listeners
  const modalSmartDelete = document.getElementById('modal-smart-delete-confirm');
  const btnCloseSmartDelete = document.getElementById('btn-close-smart-delete');
  const btnCancelSmartDelete = document.getElementById('btn-cancel-smart-delete');
  const btnProceedSmartDelete = document.getElementById('btn-proceed-smart-delete');
  if (btnCloseSmartDelete) btnCloseSmartDelete.addEventListener('click', () => SmartListsManager.closeDeleteConfirm());
  if (btnCancelSmartDelete) btnCancelSmartDelete.addEventListener('click', () => SmartListsManager.closeDeleteConfirm());
  if (btnProceedSmartDelete) btnProceedSmartDelete.addEventListener('click', () => SmartListsManager.executePendingDelete());
  if (modalSmartDelete) {
    modalSmartDelete.addEventListener('click', (e) => {
      if (e.target === modalSmartDelete) SmartListsManager.closeDeleteConfirm();
    });
  }

  // Routine Status Picker Modal Listeners (v2.0.0 Build 11)
  const modalSmartStatusPicker = document.getElementById('modal-smart-status-picker');
  const btnCloseStatusPicker = document.getElementById('btn-close-status-picker');
  const btnCancelStatusPicker = document.getElementById('btn-cancel-status-picker');
  const btnConfirmStatusPicker = document.getElementById('btn-confirm-status-picker');
  const optStatusCompleted = document.getElementById('opt-status-completed');
  const optStatusPending = document.getElementById('opt-status-pending');
  const optStatusPostponed = document.getElementById('opt-status-postponed');
  const optStatusCancelled = document.getElementById('opt-status-cancelled');

  if (btnCloseStatusPicker) btnCloseStatusPicker.addEventListener('click', () => SmartListsManager.closeStatusPicker());
  if (btnCancelStatusPicker) btnCancelStatusPicker.addEventListener('click', () => SmartListsManager.closeStatusPicker());
  if (btnConfirmStatusPicker) btnConfirmStatusPicker.addEventListener('click', () => SmartListsManager.confirmStatusPicker());

  if (optStatusCompleted) optStatusCompleted.addEventListener('click', () => SmartListsManager.updateStatusPickerUI('completed'));
  if (optStatusPending) optStatusPending.addEventListener('click', () => SmartListsManager.updateStatusPickerUI('pending'));
  if (optStatusPostponed) optStatusPostponed.addEventListener('click', () => SmartListsManager.updateStatusPickerUI('postponed'));
  if (optStatusCancelled) optStatusCancelled.addEventListener('click', () => SmartListsManager.updateStatusPickerUI('cancelled'));

  if (modalSmartStatusPicker) {
    modalSmartStatusPicker.addEventListener('click', (e) => {
      if (e.target === modalSmartStatusPicker) SmartListsManager.closeStatusPicker();
    });
  }

  // Habit Streak Reset Listeners (v2.0.0 Build 11)
  const btnResetHabitStreak = document.getElementById('btn-reset-habit-streak');
  const modalResetStreak = document.getElementById('modal-smart-reset-streak-confirm');
  const btnCloseResetStreak = document.getElementById('btn-close-reset-streak-modal');
  const btnCancelResetStreak = document.getElementById('btn-cancel-reset-streak');
  const btnProceedResetStreak = document.getElementById('btn-proceed-reset-streak');

  if (btnResetHabitStreak) btnResetHabitStreak.addEventListener('click', () => SmartListsManager.openResetStreakModal());
  if (btnCloseResetStreak) btnCloseResetStreak.addEventListener('click', () => SmartListsManager.closeResetStreakModal());
  if (btnCancelResetStreak) btnCancelResetStreak.addEventListener('click', () => SmartListsManager.closeResetStreakModal());
  if (btnProceedResetStreak) btnProceedResetStreak.addEventListener('click', () => SmartListsManager.executeStreakReset());
  if (modalResetStreak) {
    modalResetStreak.addEventListener('click', (e) => {
      if (e.target === modalResetStreak) SmartListsManager.closeResetStreakModal();
    });
  }

  // Next-Day Routines Listeners (v2.0.0 Build 11)
  const btnAddTomorrow = document.getElementById('btn-add-tomorrow-routine');
  const boxAddTomorrow = document.getElementById('next-day-add-box');
  const formAddTomorrow = document.getElementById('form-next-day-add');
  const inputTomorrowTitle = document.getElementById('input-tomorrow-routine-title');
  const btnCancelTomorrow = document.getElementById('btn-cancel-tomorrow-routine');

  if (btnAddTomorrow) {
    btnAddTomorrow.addEventListener('click', () => {
      if (boxAddTomorrow) {
        const isHidden = boxAddTomorrow.style.display === 'none' || !boxAddTomorrow.style.display;
        boxAddTomorrow.style.display = isHidden ? 'block' : 'none';
        const errEl = document.getElementById('add-tomorrow-error-msg');
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        if (isHidden && inputTomorrowTitle) inputTomorrowTitle.focus();
      }
    });
  }
  if (btnCancelTomorrow) {
    btnCancelTomorrow.addEventListener('click', () => {
      if (boxAddTomorrow) boxAddTomorrow.style.display = 'none';
      if (formAddTomorrow) formAddTomorrow.reset();
      const errEl = document.getElementById('add-tomorrow-error-msg');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    });
  }
  if (formAddTomorrow) {
    formAddTomorrow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = inputTomorrowTitle ? inputTomorrowTitle.value : '';
      if (val && val.trim()) {
        const ok = await SmartListsManager.addRoutineForTomorrow(val.trim());
        if (ok) {
          if (formAddTomorrow) formAddTomorrow.reset();
          if (boxAddTomorrow) boxAddTomorrow.style.display = 'none';
          const errEl = document.getElementById('add-tomorrow-error-msg');
          if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        }
      }
    });
  }

  // Remove Tomorrow Modal Listeners
  const modalRemoveTomorrow = document.getElementById('modal-smart-remove-tomorrow-confirm');
  const btnCloseRemoveTomorrow = document.getElementById('btn-close-remove-tomorrow-modal');
  const btnCancelRemoveTomorrow = document.getElementById('btn-cancel-remove-tomorrow');
  const btnProceedRemoveTomorrow = document.getElementById('btn-proceed-remove-tomorrow');

  if (btnCloseRemoveTomorrow) btnCloseRemoveTomorrow.addEventListener('click', () => SmartListsManager.closeRemoveTomorrowConfirm());
  if (btnCancelRemoveTomorrow) btnCancelRemoveTomorrow.addEventListener('click', () => SmartListsManager.closeRemoveTomorrowConfirm());
  if (btnProceedRemoveTomorrow) btnProceedRemoveTomorrow.addEventListener('click', () => SmartListsManager.executeRemoveTomorrow());
  if (modalRemoveTomorrow) {
    modalRemoveTomorrow.addEventListener('click', (e) => {
      if (e.target === modalRemoveTomorrow) SmartListsManager.closeRemoveTomorrowConfirm();
    });
  }

  // Edit Tomorrow Modal Listeners (Taskly v2.1.0)
  const modalEditTomorrow = document.getElementById('modal-smart-edit-tomorrow');
  const btnCloseEditTomorrow = document.getElementById('btn-close-edit-tomorrow-modal');
  const btnCancelEditTomorrow = document.getElementById('btn-cancel-edit-tomorrow');
  const formEditTomorrow = document.getElementById('form-smart-edit-tomorrow');
  const inputEditTomorrowTitle = document.getElementById('input-edit-tomorrow-title');
  const idEditTomorrow = document.getElementById('edit-tomorrow-routine-id');

  if (btnCloseEditTomorrow) btnCloseEditTomorrow.addEventListener('click', () => SmartListsManager.closeEditTomorrowModal());
  if (btnCancelEditTomorrow) btnCancelEditTomorrow.addEventListener('click', () => SmartListsManager.closeEditTomorrowModal());
  if (modalEditTomorrow) {
    modalEditTomorrow.addEventListener('click', (e) => {
      if (e.target === modalEditTomorrow) SmartListsManager.closeEditTomorrowModal();
    });
  }

  if (formEditTomorrow) {
    formEditTomorrow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rId = idEditTomorrow ? idEditTomorrow.value : '';
      const newTitle = inputEditTomorrowTitle ? inputEditTomorrowTitle.value.trim() : '';
      console.log('[SmartLists Diagnostic] Edit Tomorrow submitted:', { rId, newTitle });
      if (rId && newTitle) {
        await SmartListsManager.updateTomorrowRoutine(rId, newTitle);
      }
    });
  }

  // Summary "View Tomorrow" navigation
  const btnSummaryViewTomorrow = document.getElementById('btn-summary-view-tomorrow');
  if (btnSummaryViewTomorrow) {
    btnSummaryViewTomorrow.addEventListener('click', () => {
      SmartListsManager.closeSummaryModal();
      SmartListsManager.openScreen();
      setTimeout(() => {
        const section = document.getElementById('smart-next-day-section');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          section.classList.add('section-highlight');
          setTimeout(() => section.classList.remove('section-highlight'), 1800);
        }
      }, 100);
    });
  }

  // Log Out / Confirmation Modal
  const btnLogout = document.getElementById('btn-logout');
  const modalLogout = document.getElementById('modal-logout-confirm');
  const btnCancelLogout = document.getElementById('btn-cancel-logout');
  const btnConfirmLogout = document.getElementById('btn-confirm-logout');

  if (btnLogout) btnLogout.addEventListener('click', openLogoutModal);
  if (btnCancelLogout) btnCancelLogout.addEventListener('click', closeLogoutModal);
  if (btnConfirmLogout) btnConfirmLogout.addEventListener('click', handleConfirmLogout);
  if (modalLogout) {
    modalLogout.addEventListener('click', (e) => {
      if (e.target === modalLogout) closeLogoutModal();
    });
  }

  // Delete Custom Category Confirmation Modal
  const modalDeleteCat = document.getElementById('modal-delete-category-confirm');
  const btnCancelDeleteCat = document.getElementById('btn-cancel-delete-category');
  const btnConfirmDeleteCat = document.getElementById('btn-confirm-delete-category');

  if (btnCancelDeleteCat) btnCancelDeleteCat.addEventListener('click', closeDeleteCategoryModal);
  if (btnConfirmDeleteCat) btnConfirmDeleteCat.addEventListener('click', handleConfirmDeleteCategory);
  if (modalDeleteCat) {
    modalDeleteCat.addEventListener('click', (e) => {
      if (e.target === modalDeleteCat) closeDeleteCategoryModal();
    });
  }

  // Initialize Notification Settings modal controls & event listeners
  if (typeof TasklyNotifications !== 'undefined' && typeof TasklyNotifications.initNotificationSettingsUI === 'function') {
    TasklyNotifications.initNotificationSettingsUI();
  }
}

// ==========================================================================
// Change Password & Logout Confirmation Handlers
// ==========================================================================

function wirePasswordToggle(buttonId, inputId) {
  const btn = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';

    const eyeIcon = btn.querySelector('.icon-eye');
    const eyeOffIcon = btn.querySelector('.icon-eye-off');
    if (eyeIcon && eyeOffIcon) {
      eyeIcon.style.display = isPassword ? 'none' : 'block';
      eyeOffIcon.style.display = isPassword ? 'block' : 'none';
    }
    const label = isPassword ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  });
}

function openChangePasswordModal() {
  const modal = document.getElementById('modal-change-password');
  const errorBanner = document.getElementById('change-password-error');
  const successBanner = document.getElementById('change-password-success');
  const currentPwdInput = document.getElementById('input-current-password');
  const newPwdInput = document.getElementById('input-new-password');
  const confirmPwdInput = document.getElementById('input-confirm-password');

  if (errorBanner) { errorBanner.style.display = 'none'; errorBanner.textContent = ''; }
  if (successBanner) { successBanner.style.display = 'none'; successBanner.textContent = ''; }
  if (currentPwdInput) currentPwdInput.value = '';
  if (newPwdInput) newPwdInput.value = '';
  if (confirmPwdInput) confirmPwdInput.value = '';

  if (modal) modal.classList.add('active');
}

function closeChangePasswordModal() {
  const modal = document.getElementById('modal-change-password');
  const currentPwdInput = document.getElementById('input-current-password');
  const newPwdInput = document.getElementById('input-new-password');
  const confirmPwdInput = document.getElementById('input-confirm-password');
  const errorBanner = document.getElementById('change-password-error');
  const successBanner = document.getElementById('change-password-success');

  if (currentPwdInput) currentPwdInput.value = '';
  if (newPwdInput) newPwdInput.value = '';
  if (confirmPwdInput) confirmPwdInput.value = '';
  if (errorBanner) { errorBanner.style.display = 'none'; errorBanner.textContent = ''; }
  if (successBanner) { successBanner.style.display = 'none'; successBanner.textContent = ''; }

  if (modal) modal.classList.remove('active');
}

let isUpdatingPassword = false;

async function handleChangePassword(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (isUpdatingPassword) return;

  const currentPwdInput = document.getElementById('input-current-password');
  const newPwdInput = document.getElementById('input-new-password');
  const confirmPwdInput = document.getElementById('input-confirm-password');
  const errorBanner = document.getElementById('change-password-error');
  const successBanner = document.getElementById('change-password-success');
  const submitBtn = document.getElementById('btn-submit-change-password');

  const hideBanners = () => {
    if (errorBanner) { errorBanner.style.display = 'none'; errorBanner.textContent = ''; }
    if (successBanner) { successBanner.style.display = 'none'; successBanner.textContent = ''; }
  };
  const showError = (msg) => {
    if (errorBanner) {
      errorBanner.style.display = 'flex';
      errorBanner.textContent = msg;
    }
  };
  const showSuccess = (msg) => {
    if (successBanner) {
      successBanner.style.display = 'flex';
      successBanner.textContent = msg;
    }
  };

  hideBanners();

  const currentPassword = currentPwdInput ? currentPwdInput.value : '';
  const newPassword = newPwdInput ? newPwdInput.value : '';
  const confirmPassword = confirmPwdInput ? confirmPwdInput.value : '';

  // Step 1: Require all three fields
  if (!currentPassword || !newPassword || !confirmPassword) {
    showError('All three password fields are required.');
    return;
  }

  // Step 2: Enforce sensible minimum password length of at least 8 characters
  if (newPassword.length < 8) {
    showError('New password must be at least 8 characters.');
    return;
  }

  // Step 2: Check that the new password and confirmation password match
  if (newPassword !== confirmPassword) {
    showError('New password and confirmation do not match.');
    return;
  }

  // Step 3: Reauthenticate and Update Password
  isUpdatingPassword = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating...';
  }

  try {
    let userEmail = state.user?.email;
    if (!userEmail && supabaseClient && typeof supabaseClient.auth?.getUser === 'function') {
      try {
        const { data: userData } = await supabaseClient.auth.getUser();
        if (userData?.user?.email) {
          userEmail = userData.user.email;
          state.user.email = userEmail;
        }
      } catch (_) {}
    }

    if (!userEmail) {
      throw new Error('No authenticated user session found. Please sign in again.');
    }

    if (!supabaseClient || !supabaseClient.auth) {
      throw new Error('Authentication service is currently unavailable.');
    }

    // Step 1 check with server: Verify current password against actual authenticated account
    if (typeof supabaseClient.auth.signInWithPassword === 'function') {
      const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword
      });

      if (signInError || !signInData || !signInData.user) {
        showError('Your current password is incorrect.');
        return;
      }
    }

    // Step 3: Call updateUser with new password
    if (typeof supabaseClient.auth.updateUser === 'function') {
      const { data: updateData, error: updateError } = await supabaseClient.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        showError(updateError.message || 'Failed to update password. Please try again.');
        return;
      }
    }

    // Step 4: Confirm success
    showSuccess('Your password has been updated successfully.');

    // Clear all password inputs immediately
    if (currentPwdInput) currentPwdInput.value = '';
    if (newPwdInput) newPwdInput.value = '';
    if (confirmPwdInput) confirmPwdInput.value = '';

    setTimeout(() => {
      closeChangePasswordModal();
    }, 1500);

  } catch (err) {
    showError(err.message || 'An unexpected error occurred while updating your password.');
  } finally {
    isUpdatingPassword = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Password';
    }
  }
}

function openLogoutModal() {
  const modal = document.getElementById('modal-logout-confirm');
  if (modal) modal.classList.add('active');
}

function closeLogoutModal() {
  const modal = document.getElementById('modal-logout-confirm');
  if (modal) modal.classList.remove('active');
}

let isLoggingOut = false;

async function handleConfirmLogout() {
  if (isLoggingOut) return;
  isLoggingOut = true;

  const btnConfirm = document.getElementById('btn-confirm-logout');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Logging out...';
  }

  try {
    if (supabaseClient) {
      try {
        await supabaseClient.auth.signOut();
      } catch (err) {
        console.warn('Sign out warning:', err);
      }
    }
    syncAuthSignOut();
    state.user.name = 'User';
    state.user.age = 18;
    state.user.email = '';
    try {
      localStorage.removeItem('taskly_user');
      localStorage.removeItem('taskly_onboarding_step');
      if (typeof history !== 'undefined') {
        history.replaceState(null, '', '#profile-setup');
      }
    } catch (_) {}
    closeLogoutModal();
    showOnboardingStep('profile-setup', false);
  } finally {
    isLoggingOut = false;
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Yes, Log Out';
    }
  }
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    isAuthenticated,
    isOnboardingCompleted,
    setOnboardingCompleted,
    syncOnboardingToSupabase,
    initialRouteFastSync,
    handleSkipOnboarding,
    handleFinishOnboarding,
    handleAuthExpiry,
    handleUnverifiedEmail,
    fetchTodos,
    initSupabaseAuth,
    syncAuthSession,
    syncAuthSignOut,
    restoreActiveRoute,
    loadStoredPreferences,
    saveUserPreferences,
    applyTheme,
    showOnboardingStep,
    showMainFlow,
    escapeHtml,
    getAuthRedirectUrl,
    handleAuthDeepLink,
    setupEventListeners,
    isLocalPreview,
    initPreviewData,
    updatePreviewUI,
    renderCalendar,
    renderProfile,
    renderAll,
    selectCalendarDate,
    changeCalendarMonth,
    updateCalendarTimelineRope,
    saveQuickNote,
    deleteQuickNote,
    renderQuickNotes,
    renderAnalytics,
    calculateOverallProductivityScore,
    getMonthlyProductivityTrends,
    calculateStreaks,
    getWeeklyOverview,
    getProductivityLast7Days,
    getCategoryBreakdown,
    filterTodosByTimeframe,
    calculateRadarPoints,
    updateTask,
    handleToggleComplete,
    handleDeleteTask,
    handleOpenEditTaskModal,
    closeEditTaskModal,
    TasklyNotifications,
    parseTaskDeadline,
    formatTimeAgo,
    formatDateTimeFriendly,
    openQuickReminderPromptModal,
    closeQuickReminderPromptModal,
    openQuickReminderPicker,
    closeQuickReminderPicker,
    handleConfirmQuickReminder,
    openEditQuickNoteModal,
    closeEditQuickNoteModal,
    handleSaveEditQuickNote,
    handleRemoveNoteReminder,
    togglePasswordVisibility,
    updatePasswordVisibilityUI,
    setAuthMode,
    formatTimeTo24Hour,
    formatTime24To12,
    getRoundedLocalTime,
    initAddTaskDateTime,
    handleAddTask,
    setupAndroidKeyboardAndViewportHandlers,
    TasklyWorkloadEngine,
    TaskCategoryColors,
    getTaskCategoryConfig,
    getStoredCustomCategories,
    saveCustomCategory,
    deleteCustomCategory,
    openDeleteCategoryModal,
    closeDeleteCategoryModal,
    handleConfirmDeleteCategory,
    syncCustomCategoriesToDOM,
    openLogoutModal,
    closeLogoutModal,
    handleConfirmLogout,
    openChangePasswordModal,
    closeChangePasswordModal,
    handleChangePassword,
    wirePasswordToggle,
    TasklyUpdateManager,
    SmartListsManager,
    setSupabaseClient: (client) => { supabaseClient = client; },
    getSupabaseClient: () => supabaseClient
  };
}
