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
  passwordVisibility: {
    login: false,
    signup: false
  },
  theme: 'pet',
  quickNotes: [],

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
    initAddTaskDateTime();
    await TasklyNotifications.init();
    renderQuickNotes();
    await initSupabaseAuth();
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
    if (storedTheme === 'day') {
      state.theme = 'day';
    } else if (storedTheme === 'pastel' || storedTheme === 'light') {
      state.theme = 'pastel';
    } else {
      state.theme = 'pet';
    }

    try {
      const storedQc = localStorage.getItem('taskly_quick_notes');
      if (storedQc) {
        state.quickNotes = JSON.parse(storedQc);
      } else {
        state.quickNotes = [
          { id: 1, text: "Buy cat & dog treats" },
          { id: 2, text: "Review mobile release v1.4" }
        ];
      }
    } catch (_) {
      state.quickNotes = [
        { id: 1, text: "Buy cat & dog treats" },
        { id: 2, text: "Review mobile release v1.4" }
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

function applyTheme(theme = 'pet') {
  let normalized = 'pet';
  if (theme === 'day') normalized = 'day';
  else if (theme === 'pastel' || theme === 'light') normalized = 'pastel';
  else normalized = 'pet';
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
      } else if (normalized === 'pastel') {
        metaTheme.setAttribute('content', '#F5F3FF');
      } else {
        metaTheme.setAttribute('content', '#FDF1EA');
      }
    }

    // Update profile theme label
    const themeValEl = document.getElementById('theme-display-val');
    if (themeValEl) {
      if (normalized === 'pet') {
        themeValEl.textContent = 'Pet Theme ›';
      } else if (normalized === 'day') {
        themeValEl.textContent = 'Day Theme ›';
      } else {
        themeValEl.textContent = 'Pastel Light ›';
      }
    }

    // Update modal active selection
    const optPet = document.getElementById('theme-choice-pet');
    const optPastel = document.getElementById('theme-choice-pastel');
    const optDay = document.getElementById('theme-choice-day');
    if (optPet) optPet.classList.toggle('active', normalized === 'pet');
    if (optPastel) optPastel.classList.toggle('active', normalized === 'pastel');
    if (optDay) optDay.classList.toggle('active', normalized === 'day');
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
  CHANNEL_ID: 'taskly-reminders',
  STORAGE_KEY_PREFIX: 'taskly_notifications_',
  SCHEDULE_REGISTRY_KEY: 'taskly_scheduled_reminders',

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

  async init() {
    this.loadHistory();
    this.updateBadges();

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.createChannel({
          id: this.CHANNEL_ID,
          name: 'Taskly Reminders & Tasks',
          description: 'Task deadlines, updates, and Quick Note reminders',
          importance: 4,
          visibility: 1,
          sound: 'beep.wav',
          vibration: true,
          lights: true,
          lightColor: '#F88438'
        }).catch(err => console.warn('[Notifications] createChannel warning:', err));

        const check = await plugin.checkPermissions().catch(() => ({ display: 'prompt' }));
        if (check.display !== 'granted') {
          await plugin.requestPermissions().catch(err => console.warn('[Notifications] requestPermissions error:', err));
        }

        plugin.addListener('localNotificationActionPerformed', (notificationAction) => {
          this.handleNotificationTap(notificationAction);
        });

        plugin.addListener('localNotificationReceived', (notification) => {
          this.handleNotificationReceived(notification);
        });
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

  addInAppNotification({ title, description, type = 'system', icon = '🔔', sourceId = null, sourceType = null, actionUrl = null }) {
    const entry = {
      id: 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      title,
      description,
      timestamp: new Date().toISOString(),
      read: false,
      type,
      icon,
      sourceId,
      sourceType,
      actionUrl
    };

    if (!Array.isArray(state.notifications)) state.notifications = [];
    state.notifications.unshift(entry);
    if (state.notifications.length > 50) state.notifications = state.notifications.slice(0, 50);

    this.saveHistory();
    this.renderNotificationList();

    if (!this.isNative() && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: description,
          icon: '/logo.png'
        });
      } catch (_) {}
    }

    return entry;
  },

  async notifyImmediate({ title, description, type, icon = '🔔', sourceId = null, sourceType = null, actionUrl = null }) {
    this.addInAppNotification({ title, description, type, icon, sourceId, sourceType, actionUrl });

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        const id = this.getStableId(`immediate_${Date.now()}`, Math.floor(Math.random() * 1000));
        await plugin.schedule({
          notifications: [
            {
              id,
              title,
              body: description,
              schedule: { at: new Date(Date.now() + 100) },
              channelId: this.CHANNEL_ID,
              smallIcon: 'ic_launcher_round',
              iconColor: '#F88438',
              extra: { sourceId, sourceType, actionUrl }
            }
          ]
        });
      } catch (err) {
        console.warn('[Notifications] Immediate schedule warning:', err);
      }
    }
  },

  async scheduleTaskDeadlines(task) {
    if (!task || !task.dueDate || task.completed) return;

    const deadline = parseTaskDeadline(task.dueDate, task.time);
    if (!deadline || isNaN(deadline.getTime())) return;

    const now = Date.now();
    const leadMinutes = state.notificationSettings?.reminderLeadMinutes || 30;
    const leadMs = leadMinutes * 60 * 1000;

    const approachingTime = new Date(deadline.getTime() - leadMs);
    const reachedTime = deadline;
    const overdueTime = new Date(deadline.getTime() + (60 * 60 * 1000));

    const plugin = this.getPlugin();
    const notificationsToSchedule = [];

    // 1. Approaching
    if (approachingTime.getTime() > now) {
      const notifId = this.getStableId(task.id, 'approaching');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Task deadline approaching',
        body: `"${task.title}" is due in ${leadMinutes} minutes`,
        schedule: { at: approachingTime, allowWhileIdle: true },
        channelId: this.CHANNEL_ID,
        smallIcon: 'ic_launcher_round',
        iconColor: '#F88438',
        extra: { taskId: task.id, type: 'deadline_approaching' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Task deadline approaching', `"${task.title}" is due in ${leadMinutes} minutes`, approachingTime.toISOString(), 'deadline_approaching');
    }

    // 2. Reached
    if (reachedTime.getTime() > now) {
      const notifId = this.getStableId(task.id, 'reached');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Task deadline reached',
        body: `"${task.title}" deadline has arrived`,
        schedule: { at: reachedTime, allowWhileIdle: true },
        channelId: this.CHANNEL_ID,
        smallIcon: 'ic_launcher_round',
        iconColor: '#F88438',
        extra: { taskId: task.id, type: 'deadline_reached' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Task deadline reached', `"${task.title}" deadline has arrived`, reachedTime.toISOString(), 'deadline_reached');
    }

    // 3. Overdue
    if (overdueTime.getTime() > now) {
      const notifId = this.getStableId(task.id, 'overdue');
      notificationsToSchedule.push({
        id: notifId,
        title: 'Your task is still in progress',
        body: `"${task.title}" is now past its deadline`,
        schedule: { at: overdueTime, allowWhileIdle: true },
        channelId: this.CHANNEL_ID,
        smallIcon: 'ic_launcher_round',
        iconColor: '#F88438',
        extra: { taskId: task.id, type: 'task_overdue' }
      });
      this.recordScheduled(notifId, 'task', task.id, 'Your task is still in progress', `"${task.title}" is now past its deadline`, overdueTime.toISOString(), 'task_overdue');
    }

    if (plugin && notificationsToSchedule.length > 0) {
      try {
        await plugin.schedule({ notifications: notificationsToSchedule });
      } catch (err) {
        console.warn('[Notifications] Error scheduling task deadlines:', err);
      }
    }
  },

  async cancelTaskReminders(taskId) {
    if (!taskId) return;
    const ids = [
      this.getStableId(taskId, 'approaching'),
      this.getStableId(taskId, 'reached'),
      this.getStableId(taskId, 'overdue')
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
    const atDate = new Date(reminderDate);
    if (isNaN(atDate.getTime()) || atDate.getTime() <= Date.now()) return;

    const notifId = this.getStableId(note.id, 'quicknote');
    const title = 'Taskly – Quick Note Reminder';
    const body = `You wanted to remember: ${note.text}`;

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        await plugin.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              schedule: { at: atDate, allowWhileIdle: true },
              channelId: this.CHANNEL_ID,
              smallIcon: 'ic_launcher_round',
              iconColor: '#F88438',
              extra: { noteId: note.id, type: 'quick_note_reminder' }
            }
          ]
        });
      } catch (err) {
        console.warn('[Notifications] Quick Note reminder schedule warning:', err);
      }
    }

    this.recordScheduled(notifId, 'quick_note', note.id, title, body, atDate.toISOString(), 'quick_note_reminder');
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
    const reg = this.getScheduledRegistry();
    const now = Date.now();
    const activeTasks = state.todos || [];
    const activeNotes = state.quickNotes || [];

    const surviving = [];
    const idsToCancel = [];

    for (const item of reg) {
      if (item.sourceType === 'task') {
        const task = activeTasks.find(t => String(t.id) === String(item.sourceId));
        if (!task || task.completed) {
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

      if (new Date(item.scheduledAt).getTime() <= now) {
        this.addInAppNotification({
          title: item.title,
          description: item.body,
          type: item.type,
          icon: item.sourceType === 'quick_note' ? '📌' : '⏰',
          sourceId: item.sourceId,
          sourceType: item.sourceType
        });
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

    for (const task of activeTasks) {
      if (!task.completed && task.dueDate) {
        const hasScheduled = surviving.some(r => r.sourceType === 'task' && String(r.sourceId) === String(task.id));
        if (!hasScheduled) {
          await this.scheduleTaskDeadlines(task);
        }
      }
    }

    for (const note of activeNotes) {
      if (note.reminderDate && new Date(note.reminderDate).getTime() > now) {
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

  handleNotificationTap(action) {
    const extra = action?.notification?.extra || {};
    if (extra.taskId) {
      showMainFlow('home');
      setTimeout(() => {
        const el = document.querySelector(`[data-task-id="${extra.taskId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.transition = 'outline 0.3s';
          el.style.outline = '2px solid #F88438';
          setTimeout(() => { el.style.outline = 'none'; }, 2000);
        }
      }, 300);
    } else if (extra.noteId) {
      showMainFlow('home');
      setTimeout(() => {
        const sec = document.getElementById('section-quick-notes');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  },

  handleNotificationReceived(notification) {
    const extra = notification?.extra || {};
    this.addInAppNotification({
      title: notification.title || 'Notification',
      description: notification.body || '',
      type: extra.type || 'system',
      icon: extra.sourceType === 'quick_note' ? '📌' : '⏰',
      sourceId: extra.taskId || extra.noteId,
      sourceType: extra.sourceType
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
      return `
        <div class="notif-card ${n.read ? 'read' : 'unread'}" data-notif-id="${n.id}" onclick="TasklyNotifications.handleItemClick('${n.id}')">
          <div class="notif-icon-col">${n.icon || '🔔'}</div>
          <div class="notif-body-col">
            <div class="notif-head-row">
              <span class="notif-title">${escapeHtml(n.title)}</span>
              <span class="notif-time">${escapeHtml(timeAgo)}</span>
            </div>
            <div class="notif-desc">${escapeHtml(n.description)}</div>
          </div>
          <div class="notif-actions-col">
            ${!n.read ? `<span class="notif-unread-dot" title="Unread"></span>` : ''}
            <button type="button" class="btn-notif-dismiss" onclick="event.stopPropagation(); TasklyNotifications.deleteNotification('${n.id}')" title="Dismiss">×</button>
          </div>
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
      localStorage.setItem('taskly_quick_notes', JSON.stringify(state.quickNotes));
    }
  } catch (_) {}
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
    return;
  }

  listEl.innerHTML = notes.map(n => {
    const createdStr = n.createdAt ? formatTimeAgo(n.createdAt) : 'Recently';
    const isScheduled = Boolean(n.reminderDate && new Date(n.reminderDate).getTime() > Date.now());
    return `
      <div class="quick-note-card" data-note-id="${n.id}">
        <div class="qn-card-top">
          <span class="qn-date-tag">${escapeHtml(createdStr)}</span>
          <div class="qn-card-actions">
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
  if (tabName === 'add') {
    initAddTaskDateTime();
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
    TasklyNotifications.reconcileScheduledReminders();
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
    reminder: reminderInput ? reminderInput.checked : true
  };

  if (isLocalPreview() && state.isPreviewSession) {
    const created = Object.assign({ id: 'preview-' + Date.now(), completed: false }, payload);
    state.todos.unshift(created);
    TasklyNotifications.notifyImmediate({
      title: 'New task created',
      description: `"${created.title}" has been added to your tasks.`,
      type: 'task_created',
      icon: '📝',
      sourceId: created.id,
      sourceType: 'task'
    });
    TasklyNotifications.scheduleTaskDeadlines(created);
    titleInput.value = '';
    if (descInput) descInput.value = '';
    initAddTaskDateTime();
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
    TasklyNotifications.notifyImmediate({
      title: 'New task created',
      description: `"${created.title}" has been added to your tasks.`,
      type: 'task_created',
      icon: '📝',
      sourceId: created.id,
      sourceType: 'task'
    });
    TasklyNotifications.scheduleTaskDeadlines(created);

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

  if (nextStatus) {
    TasklyNotifications.cancelTaskReminders(id);
  } else {
    TasklyNotifications.scheduleTaskDeadlines(task);
  }

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
  const taskToDelete = state.todos.find(t => t.id === id);
  const taskTitle = taskToDelete ? taskToDelete.title : 'Task';
  TasklyNotifications.cancelTaskReminders(id);
  state.todos = state.todos.filter(t => t.id !== id);
  renderAll();

  TasklyNotifications.notifyImmediate({
    title: 'Task deleted',
    description: `"${taskTitle}" has been deleted.`,
    type: 'task_deleted',
    icon: '🗑️',
    sourceId: id,
    sourceType: 'task'
  });

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

async function updateTask(id, updates) {
  if (!id || !updates) return null;
  const task = state.todos.find(t => t.id === id);
  if (!task) return null;

  // Apply updates locally
  Object.assign(task, updates);
  renderAll();

  TasklyNotifications.cancelTaskReminders(task.id);
  if (!task.completed) {
    TasklyNotifications.scheduleTaskDeadlines(task);
  }

  TasklyNotifications.notifyImmediate({
    title: 'Task updated successfully',
    description: `"${task.title}" details have been updated.`,
    type: 'task_updated',
    icon: '✏️',
    sourceId: task.id,
    sourceType: 'task'
  });

  if ((isLocalPreview() && state.isPreviewSession) || !state.userToken) return task;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/todos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.userToken}`
      },
      body: JSON.stringify(updates)
    });
    if (res.status === 401) {
      handleAuthExpiry();
      return task;
    }
    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      handleUnverifiedEmail(errData.error || 'Please verify your email address to access Taskly.');
      return task;
    }
    if (res.ok) {
      const updated = await res.json();
      Object.assign(task, updated);
      renderAll();
      return updated;
    }
  } catch (err) {
    console.warn('Update task warning:', err);
  }
  return task;
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
  if (catInput) catInput.value = task.category || 'Personal';

  const timeInput = document.getElementById('edit-task-time');
  const timeDisplay = document.getElementById('edit-task-time-display');
  if (timeInput) {
    const time24 = task.time ? formatTimeTo24Hour(task.time) : getRoundedLocalTime();
    timeInput.value = time24;
    if (timeDisplay) {
      timeDisplay.textContent = formatTime24To12(time24);
    }
  }

  if (modal) modal.classList.add('active');
}

function closeEditTaskModal() {
  const modal = document.getElementById('modal-edit-task');
  if (modal) modal.classList.remove('active');
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

function renderCalendarTimelineItemHtml(t) {
  const isChecked = Boolean(t.completed);
  const timeDisplay = t.time ? escapeHtml(t.time) : 'All Day';
  let shortTime = 'All Day';
  if (t.time) {
    const timeMatch = t.time.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    shortTime = timeMatch ? timeMatch[1] : t.time;
  }
  const isGreen = isChecked;
  const cardClass = isGreen ? 'tl-card-green' : (t.priority === 'Medium' ? 'tl-card-yellow' : 'tl-card-peach');
  const dotColor = isChecked ? 'var(--mint)' : (t.priority === 'High' ? 'var(--brand-red)' : (t.priority === 'Medium' ? 'var(--brand-yellow)' : 'var(--primary)'));
  const iconBg = isChecked ? '#10B981' : (t.priority === 'Medium' ? '#FFAD00' : 'var(--primary)');
  const pct = isChecked ? '100%' : '0%';
  const nodeIcon = getTimelineCategoryIcon(t);

  return `
    <div class="timeline-event-row cal-timeline-item ${isChecked ? 'completed' : ''}" data-id="${t.id}" data-task-id="${t.id}">
      <div class="timeline-time-col">
        <span class="timeline-time-text timeline-time-label">${shortTime}</span>
      </div>
      <div class="timeline-spine-col">
        <div class="timeline-marker-dot ${isChecked ? 'checked' : ''}" style="background: ${dotColor};"></div>
      </div>
      <div class="timeline-card ${cardClass}">
        <div class="tl-card-main">
          <div class="tl-icon-circle timeline-node-circle" style="background: ${iconBg}; color: #fff; width: 28px; height: 28px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0;" title="${escapeHtml(t.category || 'Task')}">
            ${nodeIcon}
          </div>
          <div class="tl-text-box timeline-content">
            <div class="tl-title timeline-title" style="${isChecked ? 'color: #065F46;' : ''}">${escapeHtml(t.title)}</div>
            <div class="tl-sub timeline-sub" style="${isChecked ? 'color: #047857;' : ''}">${escapeHtml(t.description || timeDisplay)}</div>
            <div class="tl-badge-row">
              <span class="priority-badge-pill p-${(t.priority || 'medium').toLowerCase()}">${escapeHtml(t.priority || 'Medium')}</span>
              ${t.category ? `<span class="tl-category-tag">${escapeHtml(t.category)}</span>` : ''}
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

function renderAnalytics() {
  const allTodos = state.todos || [];
  const todayStr = toYmdString(new Date());

  // 1. Dynamic Streak Calculation (based on full task history)
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

  // 2. Weekly Overview (Mon-Sun task completion row)
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

  // 3. Timeframe Filtering & Overall Productivity Stats
  const timeframe = state.analyticsTimeframe || 'week';
  const filteredTodos = filterTodosByTimeframe(allTodos, timeframe);

  const total = filteredTodos.length;
  const completed = filteredTodos.filter(t => t.completed).length;
  const pending = total - completed;
  const overdue = filteredTodos.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const ringFill = document.getElementById('analytics-ring-fill');
  const percentEl = document.getElementById('analytics-percent');
  const summaryEl = document.getElementById('analytics-tasks-summary');
  const trendEl = document.getElementById('analytics-trend-badge');

  if (ringFill) {
    const offset = 251.2 - (251.2 * percent / 100);
    ringFill.style.strokeDashoffset = offset;
  }
  if (percentEl) percentEl.textContent = `${percent}%`;
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

  // Task Overview Numbers
  const compVal = document.getElementById('overview-completed-val');
  const pendVal = document.getElementById('overview-pending-val');
  const overVal = document.getElementById('overview-overdue-val');
  if (compVal) compVal.textContent = completed;
  if (pendVal) pendVal.textContent = pending;
  if (overVal) overVal.textContent = overdue;

  // 4. Productivity (Last 7 Days) Bar Chart
  const barContainer = document.getElementById('barchart-bars');
  if (barContainer) {
    const last7 = getProductivityLast7Days(allTodos);
    const maxVal = Math.max(...last7.map(d => d.completed), 1);

    barContainer.innerHTML = last7.map((dayItem) => {
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
  }

  // 5. Category-wise Task Completion Breakdown
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

  // 6. Productivity & Category Dynamic Radar Chart
  const radarPolygon = document.getElementById('radar-polygon');
  const radarPointsGroup = document.getElementById('radar-points');
  if (radarPolygon) {
    const onTimeRate = total === 0 ? 0 : Math.round(((total - overdue) / total) * 100);
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
      const cycle = { pet: 'day', day: 'pastel', pastel: 'pet' };
      const nextTheme = cycle[state.theme] || 'pet';
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
      const idInput = document.getElementById('edit-task-id');
      const titleInput = document.getElementById('edit-task-title');
      const descInput = document.getElementById('edit-task-desc');
      const dateInput = document.getElementById('edit-task-date');
      const priorityInput = document.getElementById('edit-task-priority');
      const catInput = document.getElementById('edit-task-category');

      const id = idInput ? idInput.value : null;
      const title = titleInput ? titleInput.value.trim() : '';
      if (!id || !title) return;

      const timeInput = document.getElementById('edit-task-time');
      const timeVal = (timeInput && timeInput.value) ? formatTime24To12(timeInput.value) : null;

      const updates = {
        title,
        description: descInput ? descInput.value.trim() : '',
        dueDate: dateInput && dateInput.value ? dateInput.value : null,
        time: timeVal,
        priority: priorityInput ? priorityInput.value : 'Medium',
        category: catInput ? catInput.value : 'Personal'
      };

      await updateTask(id, updates);
      closeEditTaskModal();
    });
  }

  // Theme Selection Modal in Profile
  const modalTheme = document.getElementById('modal-theme');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const btnCloseThemeModal = document.getElementById('btn-close-theme-modal');
  const optPet = document.getElementById('theme-choice-pet');
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
  if (optPet) {
    optPet.addEventListener('click', () => {
      applyTheme('pet');
      if (modalTheme) modalTheme.classList.remove('active');
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
    updateCalendarTimelineRope,
    saveQuickNote,
    deleteQuickNote,
    renderQuickNotes,
    renderAnalytics,
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
    setSupabaseClient: (client) => { supabaseClient = client; },
    getSupabaseClient: () => supabaseClient
  };
}
