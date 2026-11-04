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
      return 'https://taskly-todo-app-4z1c.vercel.app';
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
  currentOnboardingStep: 'launch',
  carouselIndex: 0,
  activeTab: 'home', // 'home' | 'calendar' | 'add' | 'progress' | 'profile'

  // Calendar State
  calCurrentDate: new Date(),
  selectedDateStr: toYmdString(new Date()),

  // Analytics State
  analyticsTimeframe: 'week', // 'week' | 'month' | 'all'

  // Task Store & Filters
  todos: [],
  dashboardFilter: 'all' // 'all' | 'today' | 'pending' | 'completed'
};

// Supabase Auth Integration
let supabaseClient = null;

function isAuthenticated() {
  if (!state.userToken || typeof state.userToken !== 'string') return false;
  if (state.userToken.startsWith('mock-user:')) return false;
  if (!state.user || !state.user.id) return false;
  return true;
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

async function initSupabaseAuth() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/config`);
    if (!res.ok) throw new Error('Failed to load server config');
    const config = await res.json();

    if (window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      const { data, error } = await supabaseClient.auth.getSession();
      if (data && data.session && !error) {
        syncAuthSession(data.session);
      } else {
        syncAuthSignOut();
      }

      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
          syncAuthSession(session);
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
  state.userToken = session.access_token;
  try {
    localStorage.setItem('taskly_user_token', session.access_token);
  } catch (_) {}

  const meta = session.user?.user_metadata || {};
  state.user.id = session.user?.id;
  state.user.email = session.user?.email || '';
  if (meta.name) {
    state.user.name = meta.name;
  } else if (!state.user.name && session.user?.email) {
    state.user.name = session.user.email.split('@')[0];
  }
  if (meta.age) {
    state.user.age = meta.age;
  }

  saveUserPreferences();
  renderProfile();
  fetchTodos();
}

function syncAuthSignOut() {
  state.userToken = null;
  state.todos = [];
  state.user.id = null;
  state.user.email = '';
  state.user.onboarded = false;
  try {
    localStorage.removeItem('taskly_user_token');
    localStorage.removeItem('taskly_active_flow');
    localStorage.removeItem('taskly_active_tab');
  } catch (_) {}
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
    if (isAuthenticated()) {
      fetchTodos();
    }

    // Restore the active screen/route on reload or initial visit
    restoreActiveRoute();
  });
}

// Restore active route based on URL hash, query params, or default to landing page
function restoreActiveRoute() {
  const hash = (typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '').trim().toLowerCase() : '');
  const params = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams());
  const paramTab = params.get('tab');
  const paramStep = params.get('step');

  const mainTabs = ['home', 'calendar', 'progress', 'profile', 'add'];
  const onboardingSteps = ['launch', 'carousel', 'profile-setup', 'welcome'];

  // 1. Check if user requests a protected main dashboard tab (via hash or ?tab=)
  const requestedTab = mainTabs.includes(hash) ? hash : (paramTab && mainTabs.includes(paramTab) ? paramTab : null);

  if (requestedTab) {
    if (isAuthenticated()) {
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
    if (hash === 'welcome' && !isAuthenticated()) {
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
    if (paramStep === 'welcome' && !isAuthenticated()) {
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

  // Otherwise start with Screen 1 Landing Page
  showOnboardingStep('launch', false);
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
    if (storedTheme) {
      state.theme = storedTheme;
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

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.getElementById('meta-theme-color');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#0f172a' : '#ffffff');
  }
  try {
    localStorage.setItem('taskly_theme', theme);
  } catch (_) {}

  // Update profile theme label
  const themeValEl = document.getElementById('theme-display-val');
  if (themeValEl) {
    themeValEl.textContent = `${theme === 'dark' ? 'Dark' : 'Light'} ›`;
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
  if (!isAuthenticated()) {
    console.warn(`[Auth Guard]: Attempted to show main flow '${tabName}' while unauthenticated. Redirecting to profile-setup.`);
    try {
      if (typeof history !== 'undefined') history.replaceState(null, '', '#profile-setup');
    } catch (_) {
      if (typeof window !== 'undefined') window.location.hash = 'profile-setup';
    }
    showOnboardingStep('profile-setup', false);
    return;
  }

  state.flow = 'main';
  state.activeTab = tabName;
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('onboarding-active');
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
}

// ==========================================================================
// API Operations (User-Scoped & Authenticated)
// ==========================================================================
async function fetchTodos() {
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
  if (!state.userToken) {
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

    // Route back to home dashboard
    showMainFlow('home');
  } catch (err) {
    console.error('Add task error:', err);
    alert(`Could not create task: ${err.message}`);
  }
}

async function handleToggleComplete(id) {
  if (!state.userToken) return;
  const task = state.todos.find(t => t.id === id);
  if (!task) return;

  const nextStatus = !task.completed;
  task.completed = nextStatus;
  renderAll();

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
  } catch (err) {
    console.warn('Update completion warning:', err);
  }
}

async function handleDeleteTask(event, id) {
  if (event && event.stopPropagation) {
    event.stopPropagation();
  }
  if (!state.userToken) return;
  state.todos = state.todos.filter(t => t.id !== id);
  renderAll();

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
  } catch (err) {
    console.warn('Delete task warning:', err);
  }
}

async function handleClearCompleted() {
  if (!state.userToken) return;
  const hasCompleted = state.todos.some(t => t.completed);
  if (!hasCompleted) return;

  state.todos = state.todos.filter(t => !t.completed);
  renderAll();

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
  } catch (err) {
    console.warn('Clear completed warning:', err);
  }
}

// ==========================================================================
// Rendering Engine
// ==========================================================================
function renderAll() {
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

// 2. Calendar Render
function renderCalendar() {
  const monthTitle = document.getElementById('cal-month-display');
  const daysContainer = document.getElementById('calendar-days-container');
  const selectedDateTitle = document.getElementById('cal-selected-date-title');
  const taskListContainer = document.getElementById('calendar-task-list');

  const curYear = state.calCurrentDate.getFullYear();
  const curMonth = state.calCurrentDate.getMonth();

  if (monthTitle) {
    monthTitle.textContent = state.calCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Days Grid
  if (daysContainer) {
    const firstDayIndex = new Date(curYear, curMonth, 1).getDay();
    const totalDaysInMonth = new Date(curYear, curMonth + 1, 0).getDate();

    // Map which dates have tasks
    const datesWithTasks = new Set();
    state.todos.forEach(t => {
      if (t.dueDate) datesWithTasks.add(t.dueDate);
    });

    let cellsHtml = '';

    // Leading blanks (from prev month)
    for (let i = 0; i < firstDayIndex; i++) {
      cellsHtml += `<div class="cal-day-cell other-month"><span class="day-num"></span></div>`;
    }

    // Days of current month
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

    daysContainer.innerHTML = cellsHtml;
  }

  // Scheduled tasks for selected date
  if (selectedDateTitle) {
    const parts = state.selectedDateStr.split('-');
    const selObj = new Date(parts[0], parts[1] - 1, parts[2]);
    selectedDateTitle.textContent = `Tasks on ${selObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }

  if (taskListContainer) {
    const tasksOnDate = state.todos.filter(t => t.dueDate === state.selectedDateStr);
    if (tasksOnDate.length === 0) {
      taskListContainer.innerHTML = `<div class="empty-state">No tasks scheduled for this day.</div>`;
    } else {
      taskListContainer.innerHTML = tasksOnDate.map(t => renderTaskItemHtml(t)).join('');
    }
  }
}

function selectCalendarDate(dateStr) {
  state.selectedDateStr = dateStr;
  renderCalendar();
}

function changeCalendarMonth(offset) {
  state.calCurrentDate.setMonth(state.calCurrentDate.getMonth() + offset);
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

  const currentName = state.user.name || 'User';
  if (nameEl) nameEl.textContent = currentName;
  if (ageEl) ageEl.textContent = `Age: ${state.user.age || 18}`;
  if (deskNameEl) deskNameEl.textContent = currentName;
  if (deskAvatarEl) deskAvatarEl.textContent = currentName.charAt(0).toUpperCase();
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================
function setupEventListeners() {
  // Screen 1: Click Anywhere or Press Any Key to proceed to Carousel (Screen 2)
  const launchScreen = document.getElementById('screen-launch');
  if (launchScreen) {
    launchScreen.addEventListener('click', () => {
      state.carouselIndex = 0;
      showOnboardingStep('carousel');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (state.flow === 'onboarding') {
      if (state.currentOnboardingStep === 'launch') {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          state.carouselIndex = 0;
          showOnboardingStep('carousel');
        }
      }
    }
  });

  // Screen 2: Carousel Navigation & Back to Landing Page
  const btnBackToLaunch = document.getElementById('btn-back-to-launch');
  if (btnBackToLaunch) {
    btnBackToLaunch.addEventListener('click', () => {
      showOnboardingStep('launch');
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
            const { data, error } = await supabaseClient.auth.signUp({
              email,
              password,
              options: {
                data: { name, age }
              }
            });
            if (error) throw error;

            state.user.name = name;
            state.user.age = age;
            state.user.email = email;
            saveUserPreferences();

            if (data.session) {
              syncAuthSession(data.session);
              showOnboardingStep('welcome');
            } else {
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
      if (!isAuthenticated()) {
        console.warn('[Auth Guard]: Blocked unauthenticated attempt to enter home.');
        showOnboardingStep('profile-setup');
        return;
      }
      state.user.onboarded = true;
      saveUserPreferences();
      showMainFlow('home');
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
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
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

  // Theme Toggle in Profile
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });
  }

  // Onboarding Tour in Profile
  const btnOpenTour = document.getElementById('btn-open-tour');
  if (btnOpenTour) {
    btnOpenTour.addEventListener('click', () => {
      showOnboardingStep('launch');
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
            history.replaceState(null, '', '#launch');
          }
        } catch (_) {}
        showOnboardingStep('launch', false);
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
    initSupabaseAuth,
    syncAuthSession,
    syncAuthSignOut,
    restoreActiveRoute,
    loadStoredPreferences,
    saveUserPreferences,
    applyTheme,
    showOnboardingStep,
    showMainFlow,
    escapeHtml
  };
}
