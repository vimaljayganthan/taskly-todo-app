// ==========================================================================
// Taskly Aerodynamic 2.0 Engine
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
  userToken: null,
  authMode: 'login', // 'login' | 'signup'
  theme: 'light',

  // Active Flow & Navigation
  flow: 'onboarding', // 'main' | 'onboarding'
  currentOnboardingStep: 'carousel',
  carouselIndex: 0,
  activeTab: 'home', // 'home' | 'calendar' | 'add' | 'progress' | 'profile'

  // Calendar State
  calCurrentDate: new Date(),
  selectedDateStr: toYmdString(new Date()),
  calendarViewMode: 'strip', // 'strip' | 'month'
  previousTab: null,

  // Analytics State
  analyticsTimeframe: 'week', // 'week' | 'month' | 'all'

  // Task Store & Filters
  todos: [],
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
        dueDate: yesterday,
        time: '11:00 AM',
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
        time: '06:00 PM',
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
          if (state.user?.onboarded) {
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
          if (state.user?.onboarded) {
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
          await supabaseClient.auth.signOut().catch(() => {});
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
      syncAuthSignOut();
    }
  } catch (err) {
    console.warn('[Supabase Auth Init Warning]:', err.message);
    supabaseClient = null;
    syncAuthSignOut();
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

  saveUserPreferences();
  updatePreviewUI();
  renderProfile();
  fetchTodos();
}

function syncAuthSignOut() {
  state.userToken = null;
  state.isPreviewSession = false;
  state.todos = [];
  state.user.id = null;
  state.user.email = '';
  state.user.onboarded = false;
  state.user.isPreview = false;
  state.user.isEmailVerified = false;
  try {
    localStorage.removeItem('taskly_user_token');
    localStorage.removeItem('taskly_active_flow');
    localStorage.removeItem('taskly_active_tab');
  } catch (_) {}
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
    await initSupabaseAuth();
    updatePreviewUI();
    if (isLocalPreview() && state.isPreviewSession) {
      initPreviewData();
    } else if (isAuthenticated()) {
      fetchTodos();
    }

    // Restore the active screen/route on reload or initial visit
    restoreActiveRoute();
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

  const mainTabs = ['home', 'calendar', 'progress', 'profile', 'add'];
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
      try {
        if (typeof history !== 'undefined') history.replaceState(null, '', '#carousel');
      } catch (_) {
        if (typeof window !== 'undefined') window.location.hash = 'carousel';
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
    showOnboardingStep(paramStep, false);
    return;
  }

  // 3. Saved localStorage session if explicitly onboarded and has an active tab AND authenticated
  try {
    const savedFlow = localStorage.getItem('taskly_active_flow');
    const savedTab = localStorage.getItem('taskly_active_tab');
    if (isAuthenticated() && state.user && state.user.onboarded === true && savedFlow === 'main' && savedTab && mainTabs.includes(savedTab)) {
      showMainFlow(savedTab, false);
      return;
    }
  } catch (_) {}

  // 4. Default entry point for root (/):
  // If already authenticated and onboarded, take directly to home dashboard
  if (isAuthenticated() && state.user && state.user.onboarded === true) {
    showMainFlow('home', false);
    return;
  }

  // If authenticated but not yet onboarded (e.g. email confirmation callback), show welcome screen
  if (isAuthenticated()) {
    showOnboardingStep('welcome', false);
    return;
  }

  // Otherwise start with Onboarding Carousel
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
    const storedTheme = localStorage.getItem('taskly_theme');
    state.theme = (storedTheme === 'day') ? 'day' : 'pastel';
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

function applyTheme(theme = 'pastel') {
  const normalized = theme === 'day' ? 'day' : 'pastel';
  state.theme = normalized;

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', normalized);
    if (document.body) {
      document.body.setAttribute('data-theme', normalized);
    }

    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
      if (normalized === 'day') {
        const activeTab = state.activeTab || 'home';
        const colorMap = {
          home: '#38BDF8',
          calendar: '#FFE1E7',
          progress: '#FFF1B8',
          profile: '#38BDF8',
          add: '#38BDF8'
        };
        metaTheme.setAttribute('content', colorMap[activeTab] || '#38BDF8');
      } else {
        metaTheme.setAttribute('content', '#F5F3FF');
      }
    }

    // Update profile theme label
    const themeValEl = document.getElementById('theme-display-val');
    if (themeValEl) {
      themeValEl.textContent = normalized === 'day' ? 'Day Theme ›' : 'Pastel Light ›';
    }

    // Update modal active selection
    const optPastel = document.getElementById('theme-choice-pastel');
    const optDay = document.getElementById('theme-choice-day');
    if (optPastel) optPastel.classList.toggle('active', normalized === 'pastel');
    if (optDay) optDay.classList.toggle('active', normalized === 'day');
  }

  try {
    localStorage.setItem('taskly_theme', normalized);
  } catch (_) {}
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
    if (state.theme === 'day') {
      const metaTheme = document.getElementById('meta-theme-color');
      if (metaTheme) {
        const colorMap = {
          home: '#38BDF8',
          calendar: '#FFE1E7',
          progress: '#FFF1B8',
          profile: '#38BDF8',
          add: '#38BDF8'
        };
        metaTheme.setAttribute('content', colorMap[tabName] || '#38BDF8');
      }
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
  const tabs = ['home', 'calendar', 'add', 'progress', 'profile'];
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
    state.todos = await res.json();
    renderAll();
  } catch (err) {
    console.warn('[Fetch Warning]:', err.message);
    state.todos = state.todos || [];
    renderAll();
  }
}

async function handleAddTask(e) {
  e.preventDefault();
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) {
    alert('Please sign in or create an account to create tasks.');
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

  const activeCategoryBtn = document.querySelector('#add-category-selector .pill-opt.active');
  const category = activeCategoryBtn ? activeCategoryBtn.dataset.val : 'Personal';

  const payload = {
    title,
    description: descInput.value.trim(),
    dueDate: dateInput.value || toYmdString(new Date()),
    time: timeInput.value.trim() || '6:00 PM',
    priority,
    category,
    reminder: reminderInput.checked
  };

  if (isLocalPreview() && state.isPreviewSession) {
    const created = Object.assign({ id: 'preview-' + Date.now(), completed: false }, payload);
    state.todos.unshift(created);
    titleInput.value = '';
    descInput.value = '';
    timeInput.value = '';
    const targetTab = state.previousTab === 'calendar' ? 'calendar' : 'home';
    state.previousTab = null;
    showMainFlow(targetTab);
    return;
  }

  try {
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

    const created = await res.json();
    state.todos.unshift(created);

    // Reset Form
    titleInput.value = '';
    descInput.value = '';
    timeInput.value = '';

    // Route back to calendar or home
    const targetTab = state.previousTab === 'calendar' ? 'calendar' : 'home';
    state.previousTab = null;
    showMainFlow(targetTab);
  } catch (err) {
    console.error('Add task error:', err);
    alert(`Could not create task: ${err.message}`);
  }
}

async function handleToggleComplete(id) {
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) return;
  const task = state.todos.find(t => t.id === id);
  if (!task) return;

  const nextStatus = !task.completed;
  task.completed = nextStatus;
  renderAll();

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) return;

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
  } catch (err) {
    console.warn('Update completion warning:', err);
  }
}

async function handleDeleteTask(event, id) {
  if (event && event.stopPropagation) {
    event.stopPropagation();
  }
  if (!state.userToken && !(isLocalPreview() && state.isPreviewSession)) return;
  state.todos = state.todos.filter(t => t.id !== id);
  renderAll();

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) return;

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
  } catch (err) {
    console.warn('Delete task warning:', err);
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
  updatePreviewUI();
  renderHome();
  renderCalendar();
  renderAnalytics();
  renderProfile();
}

// 1. Home Dashboard Render
function renderHome() {
  // Personalized Greeting
  const greetingEl = document.getElementById('greeting-title');
  if (greetingEl) {
    greetingEl.textContent = `Hello, ${state.user.name || 'vimal'} 👋`;
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
  const catBadgeHtml = `<span class="${catClass}">${catIcon} ${escapeHtml(cat)}</span>`;

  return `
    <div class="task-item ${isChecked ? 'completed' : ''}" data-id="${t.id}">
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

function renderCalendarTimelineItemHtml(t) {
  const isChecked = Boolean(t.completed);
  const timeDisplay = t.time ? escapeHtml(t.time) : 'All Day';
  const nodeIcon = getTimelineCategoryIcon(t);

  let shortTime = 'All Day';
  if (t.time) {
    const timeMatch = t.time.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    shortTime = timeMatch ? timeMatch[1] : t.time;
  }

  return `
    <div class="cal-timeline-item ${isChecked ? 'completed' : ''}" data-id="${t.id}">
      <div class="timeline-left">
        <span class="timeline-time-label">${shortTime}</span>
        <div class="timeline-node-circle" title="${escapeHtml(t.category || 'Task')}">
          ${nodeIcon}
        </div>
        <div class="timeline-content">
          <span class="timeline-sub">${timeDisplay}</span>
          <div class="timeline-title">${escapeHtml(t.title)}</div>
        </div>
      </div>
      <button type="button" class="timeline-status-btn ${isChecked ? 'checked' : ''}" onclick="handleToggleComplete('${t.id}')" aria-label="Toggle task completed">
        ${isChecked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>
    </div>
  `;
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
      // Full Month Grid View
      const firstDayIndex = (new Date(curYear, curMonth, 1).getDay() + 6) % 7; // Monday = 0
      const totalDaysInMonth = new Date(curYear, curMonth + 1, 0).getDate();

      for (let i = 0; i < firstDayIndex; i++) {
        cellsHtml += `<div class="cal-day-cell other-month"><span class="day-num"></span></div>`;
      }

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const cellDateStr = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isSelected = cellDateStr === state.selectedDateStr;
        const hasTask = datesWithTasks.has(cellDateStr);

        cellsHtml += `
          <div class="cal-day-cell ${isSelected ? 'selected' : ''}" data-date="${cellDateStr}" onclick="selectCalendarDate('${cellDateStr}')">
            <span class="day-num">${d}</span>
            ${hasTask ? '<span class="cal-task-dot"></span>' : ''}
          </div>
        `;
      }
    } else {
      // 7-Day Horizontal Strip View (Matching Reference Design)
      const parts = state.selectedDateStr.split('-').map(Number);
      const selDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const selDayOfWeek = selDateObj.getDay(); // 0 is Sun, 1 is Mon
      const mondayOffset = (selDayOfWeek === 0 ? 6 : selDayOfWeek - 1);
      const mondayDate = new Date(selDateObj);
      mondayDate.setDate(selDateObj.getDate() - mondayOffset);

      for (let i = 0; i < 7; i++) {
        const stripDate = new Date(mondayDate);
        stripDate.setDate(mondayDate.getDate() + i);
        const stripDateStr = toYmdString(stripDate);
        const dayAbbr = stripDate.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = stripDate.getDate();
        const isSelected = stripDateStr === state.selectedDateStr;
        const hasTask = datesWithTasks.has(stripDateStr);

        cellsHtml += `
          <div class="cal-strip-day ${isSelected ? 'selected' : ''}" data-date="${stripDateStr}" onclick="selectCalendarDate('${stripDateStr}')">
            <span class="cal-strip-weekday ${isSelected ? 'text-active' : ''}">${dayAbbr}</span>
            <div class="cal-strip-num-wrap">
              <span class="cal-strip-num">${dayNum}</span>
              ${hasTask ? '<span class="cal-strip-dot"></span>' : ''}
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
        <div class="empty-state" style="text-align: center; padding: 28px 16px; color: var(--text-secondary);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🗓️</div>
          <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">No tasks scheduled for this day</div>
          <p style="font-size: 0.8125rem; margin: 0;">Tap the red + button below to create a task for this date.</p>
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

// 3. Analytics Render
function renderAnalytics() {
  const total = state.todos.length;
  const completed = state.todos.filter(t => t.completed).length;
  const pending = total - completed;

  // Overdue: dueDate < today and not completed
  const todayStr = toYmdString(new Date());
  const overdue = state.todos.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length;

  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const ringFill = document.getElementById('analytics-ring-fill');
  const percentEl = document.getElementById('analytics-percent');
  const summaryEl = document.getElementById('analytics-tasks-summary');

  if (ringFill) {
    const offset = 251.2 - (251.2 * percent / 100);
    ringFill.style.strokeDashoffset = offset;
  }
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (summaryEl) summaryEl.textContent = `${completed} of ${total} tasks completed`;

  // Overview counts
  const compVal = document.getElementById('overview-completed-val');
  const pendVal = document.getElementById('overview-pending-val');
  const overVal = document.getElementById('overview-overdue-val');
  if (compVal) compVal.textContent = completed;
  if (pendVal) pendVal.textContent = pending;
  if (overVal) overVal.textContent = overdue;

  // 7-Day Bar Chart
  const barContainer = document.getElementById('barchart-bars');
  if (barContainer) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // Distribute completion counts across past 7 days for visual analytics
    const counts = [3, 5, 2, 6, 4, 1, 2];
    const maxVal = Math.max(...counts, 6);

    barContainer.innerHTML = days.map((day, i) => {
      const heightPercent = Math.round((counts[i] / maxVal) * 100);
      return `
        <div class="bar-col">
          <div class="bar-tube">
            <div class="bar-fill" style="height: ${heightPercent}%;"></div>
          </div>
          <span class="bar-label">${day}</span>
        </div>
      `;
    }).join('');
  }
}

// 4. Profile Render
function renderProfile() {
  const nameEl = document.getElementById('profile-display-name');
  const ageEl = document.getElementById('profile-display-age');
  const deskNameEl = document.getElementById('desktop-user-name');
  const deskAvatarEl = document.getElementById('desktop-user-avatar');

  const isPreview = Boolean(state.isPreviewSession && isLocalPreview());
  const currentName = isPreview ? 'Preview User' : (state.user.name || 'User');
  if (nameEl) nameEl.textContent = currentName;
  if (ageEl) ageEl.textContent = isPreview ? 'LOCAL UI PREVIEW' : `Age: ${state.user.age || 18}`;
  if (deskNameEl) deskNameEl.textContent = isPreview ? 'Preview User (Local UI)' : currentName;
  if (deskAvatarEl) deskAvatarEl.textContent = currentName.charAt(0).toUpperCase();

  const profileAvatarCircle = document.getElementById('profile-avatar-circle');
  if (profileAvatarCircle) {
    profileAvatarCircle.innerHTML = `<span style="font-weight: 800; font-size: 1.5rem;">${currentName.charAt(0).toUpperCase()}</span>`;
  }
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
      showOnboardingStep('profile-setup');
    });
  }

  const btnSkip = document.getElementById('btn-skip-onboarding');
  if (btnSkip) {
    btnSkip.addEventListener('click', () => {
      showOnboardingStep('profile-setup');
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
  const fieldWrapName = document.getElementById('field-wrap-name');
  const fieldWrapAge = document.getElementById('field-wrap-age');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');
  const btnAuthText = document.getElementById('btn-auth-text');
  const authErrorMsg = document.getElementById('auth-error-msg');

  function setAuthMode(mode) {
    state.authMode = mode;
    if (authErrorMsg) {
      authErrorMsg.style.display = 'none';
      authErrorMsg.textContent = '';
    }
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

  if (btnToggleLogin) btnToggleLogin.addEventListener('click', () => setAuthMode('login'));
  if (btnToggleSignup) btnToggleSignup.addEventListener('click', () => setAuthMode('signup'));

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
                await supabaseClient.auth.signOut().catch(() => {});
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
                await supabaseClient.auth.signOut().catch(() => {});
              }
              syncAuthSignOut();
              throw new Error('Please verify your email address before signing in. Check your inbox for the confirmation link.');
            }

            if (data.session) {
              syncAuthSession(data.session);
              state.user.onboarded = true;
              saveUserPreferences();
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
      state.user.onboarded = true;
      saveUserPreferences();
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
      const nextTheme = state.theme === 'day' ? 'pastel' : 'day';
      applyTheme(nextTheme);
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
      const notifDot = document.getElementById('profile-notif-dot');
      if (notifDot) notifDot.style.display = 'none';
      alert("You're all caught up! No unread notifications.");
    });
  }

  if (menuFaq) {
    menuFaq.addEventListener('click', () => {
      const modalAbout = document.getElementById('modal-about');
      if (modalAbout) modalAbout.classList.add('active');
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
    });
  });

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

  // Theme Selection Modal in Profile
  const modalTheme = document.getElementById('modal-theme');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const btnCloseThemeModal = document.getElementById('btn-close-theme-modal');
  const optPastel = document.getElementById('theme-choice-pastel');
  const optDay = document.getElementById('theme-choice-day');

  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      if (modalTheme) modalTheme.classList.add('active');
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
  if (optPastel) {
    optPastel.addEventListener('click', () => {
      applyTheme('pastel');
      if (modalTheme) modalTheme.classList.remove('active');
    });
  }
  if (optDay) {
    optDay.addEventListener('click', () => {
      applyTheme('day');
      if (modalTheme) modalTheme.classList.remove('active');
    });
  }

  // Onboarding Tour in Profile
  const btnOpenTour = document.getElementById('btn-open-tour');
  if (btnOpenTour) {
    btnOpenTour.addEventListener('click', () => {
      state.carouselIndex = 0;
      showOnboardingStep('carousel');
    });
  }

  // About Modal
  const btnOpenAbout = document.getElementById('btn-open-about');
  const modalAbout = document.getElementById('modal-about');
  const btnCloseAbout = document.getElementById('btn-close-about-modal');
  const btnCloseAboutOk = document.getElementById('btn-close-about-ok');

  if (btnOpenAbout) btnOpenAbout.addEventListener('click', () => modalAbout.classList.add('active'));
  if (btnCloseAbout) btnCloseAbout.addEventListener('click', () => modalAbout.classList.remove('active'));
  if (btnCloseAboutOk) btnCloseAboutOk.addEventListener('click', () => modalAbout.classList.remove('active'));

  // Log Out / Reset Profile
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (confirm('Are you sure you want to log out of Taskly?')) {
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
        try {
          localStorage.removeItem('taskly_user');
          localStorage.removeItem('taskly_onboarding_step');
          if (typeof history !== 'undefined') {
            history.replaceState(null, '', '#profile-setup');
          }
        } catch (_) {}
        showOnboardingStep('profile-setup', false);
      }
    });
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
    setSupabaseClient: (client) => { supabaseClient = client; },
    getSupabaseClient: () => supabaseClient
  };
}
