// ==========================================================================
// API Base URL Configuration (Automatic Hybrid Web & Native Mobile Routing)
// ==========================================================================
const API_BASE_URL = (() => {
  if (typeof window !== 'undefined' && window.TASKLY_API_URL) {
    return window.TASKLY_API_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const isCapacitor = Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:' ||
      (window.location.hostname === 'localhost' && window.location.port === '' && !window.location.origin.includes(':3000'))
    );
    if (isCapacitor) {
      return 'https://taskly-todo-app-4z1c.vercel.app';
    }
  }
  // Standard web browser deployment on Vercel or local Express development
  return '';
})();

// State Management
const state = {
  todos: [],
  filter: 'all', // 'all' | 'pending' | 'overdue' | 'completed'
  theme: localStorage.getItem('taskly_theme') || 'light'
};

// DOM Elements
const elements = {
  todoForm: document.getElementById('todo-form'),
  taskInput: document.getElementById('task-title-input'),
  dueDateInput: document.getElementById('task-due-date-input'),
  todoList: document.getElementById('todo-list'),
  emptyState: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyDesc: document.getElementById('empty-desc'),
  progressSummaryText: document.getElementById('progress-summary-text'),
  progressPercent: document.getElementById('progress-percent'),
  segCompleted: document.getElementById('seg-completed'),
  segPending: document.getElementById('seg-pending'),
  segOverdue: document.getElementById('seg-overdue'),
  statTotalValue: document.getElementById('stat-total-value'),
  statCompletedValue: document.getElementById('stat-completed-value'),
  statCompletedRate: document.getElementById('stat-completed-rate'),
  statPendingValue: document.getElementById('stat-pending-value'),
  statOverdueValue: document.getElementById('stat-overdue-value'),
  statOverdueCard: document.querySelector('.stat-card-overdue'),
  statCards: document.querySelectorAll('.stat-card'),
  badgeAll: document.getElementById('badge-all'),
  badgePending: document.getElementById('badge-pending'),
  badgeOverdue: document.getElementById('badge-overdue'),
  badgeCompleted: document.getElementById('badge-completed'),
  clearCompletedBtn: document.getElementById('clear-completed-btn'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  dateDisplay: document.getElementById('date-display'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  toastContainer: document.getElementById('toast-container'),
  charCounter: document.getElementById('char-counter'),
  charCount: document.getElementById('char-count')
};

// ==========================================================================
// Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDateDisplay();
  setupEventListeners();
  updateCharCounter();
  initCapacitor();
  fetchTodos();
});

function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('taskly_theme', state.theme);
  updateStatusBarTheme();
}

// Native Capacitor Lifecycle & Status Bar Configuration
async function initCapacitor() {
  if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.location.protocol === 'capacitor:')) {
    try {
      document.body.classList.add('is-native-mobile');

      // 1. Configure Status Bar to match Taskly theme
      updateStatusBarTheme();

      // 2. Hide Splash Screen smoothly once UI is mounted
      if (window.Capacitor?.Plugins?.SplashScreen) {
        setTimeout(async () => {
          try {
            await window.Capacitor.Plugins.SplashScreen.hide({ fadeOutDuration: 300 });
          } catch (_) {}
        }, 400);
      }

      // 3. Native Android Hardware Back Button Handling
      if (window.Capacitor?.Plugins?.App) {
        window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) {
            window.history.back();
          } else {
            window.Capacitor.Plugins.App.exitApp();
          }
        });
      }
    } catch (err) {
      console.warn('[Capacitor] Plugin initialization notice:', err);
    }
  }
}

function updateStatusBarTheme() {
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.StatusBar) {
    try {
      const { StatusBar, Style } = window.Capacitor.Plugins;
      const isDark = state.theme === 'dark';
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
      if (window.Capacitor.getPlatform() === 'android') {
        StatusBar.setBackgroundColor({ color: isDark ? '#0f172a' : '#ffffff' }).catch(() => {});
      }
    } catch (_) {}
  }
}

function initDateDisplay() {
  const options = { weekday: 'long', month: 'short', day: 'numeric' };
  const today = new Date().toLocaleDateString(undefined, options);
  if (elements.dateDisplay) {
    elements.dateDisplay.textContent = today;
  }
}

// ==========================================================================
// Event Listeners
// ==========================================================================
function setupEventListeners() {
  // Form submit (Add task)
  elements.todoForm.addEventListener('submit', handleAddTask);

  // Theme toggle
  elements.themeToggleBtn.addEventListener('click', toggleTheme);

  // Filter tabs
  elements.filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      setFilter(filter);
    });
  });

  // Stat cards interactive filters
  elements.statCards.forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.statFilter;
      setFilter(filter);
    });
  });

  // Clear completed
  elements.clearCompletedBtn.addEventListener('click', handleClearCompleted);

  // Character counter input listener
  if (elements.taskInput) {
    elements.taskInput.addEventListener('input', updateCharCounter);
  }
}

// ==========================================================================
// API Handlers
// ==========================================================================
async function fetchTodos() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/todos`);
    if (!res.ok) throw new Error('Failed to load tasks');
    state.todos = await res.json();
    render();
  } catch (err) {
    showToast('Failed to load tasks from server', 'danger');
  }
}

async function handleAddTask(e) {
  e.preventDefault();
  const title = elements.taskInput.value.trim();
  const dueDate = elements.dueDateInput ? elements.dueDateInput.value : '';
  if (!title) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate })
    });

    if (!res.ok) throw new Error('Failed to add task');

    const newTodo = await res.json();
    state.todos.unshift(newTodo);
    elements.taskInput.value = '';
    if (elements.dueDateInput) {
      elements.dueDateInput.value = '';
    }
    updateCharCounter();
    elements.taskInput.focus();

    showToast('Task added successfully');
    render();
  } catch (err) {
    showToast('Error adding task', 'danger');
  }
}

function updateCharCounter() {
  const count = elements.taskInput ? elements.taskInput.value.length : 0;
  if (elements.charCount) {
    elements.charCount.textContent = count;
  }
  if (elements.charCounter) {
    const isOverLimit = count > 50;
    elements.charCounter.classList.toggle('limit-exceeded', isOverLimit);
    elements.charCounter.classList.toggle('over-limit', isOverLimit);
    elements.charCounter.style.color = isOverLimit ? 'var(--accent-danger)' : '';
  }
}

async function handleToggleComplete(id) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;

  const nextStatus = !todo.completed;

  // Optimistic update
  todo.completed = nextStatus;
  render();

  try {
    const res = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: nextStatus })
    });

    if (!res.ok) throw new Error('Failed to update task');
    const updated = await res.json();
    todo.completed = updated.completed;
  } catch (err) {
    // Revert optimistic update
    todo.completed = !nextStatus;
    showToast('Failed to update task status', 'danger');
    render();
  }
}

async function handleDeleteTask(id) {
  const itemEl = document.querySelector(`[data-id="${id}"]`);
  if (itemEl) {
    itemEl.style.opacity = '0';
    itemEl.style.transform = 'scale(0.95)';
    itemEl.style.transition = 'all 0.18s ease';
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Failed to delete task');

    state.todos = state.todos.filter(t => t.id !== id);
    showToast('Task deleted');
    render();
  } catch (err) {
    showToast('Failed to delete task', 'danger');
    render();
  }
}

async function handleClearCompleted() {
  const completedCount = state.todos.filter(t => t.completed).length;
  if (!completedCount) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/todos`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Failed to clear completed tasks');

    state.todos = state.todos.filter(t => !t.completed);
    showToast(`Cleared ${completedCount} completed task${completedCount > 1 ? 's' : ''}`);
    render();
  } catch (err) {
    showToast('Error clearing completed tasks', 'danger');
  }
}

function isOverdue(todo) {
  if (!todo || todo.completed || !todo.dueDate) return false;
  const parts = todo.dueDate.split('-');
  if (parts.length !== 3) return false;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return false;

  const dueDate = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return dueDate < today;
}

function setFilter(filter) {
  state.filter = filter;
  elements.filterButtons.forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  elements.statCards.forEach(card => {
    const isActive = card.dataset.statFilter === filter;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  render();
}

// ==========================================================================
// Rendering
// ==========================================================================
function render() {
  updateStats();
  renderTodoList();
}

function updateStats() {
  const total = state.todos.length;
  const completed = state.todos.filter(t => t.completed).length;
  const overdue = state.todos.filter(t => isOverdue(t)).length;
  const pending = state.todos.filter(t => !t.completed && !isOverdue(t)).length;

  // Stat cards values
  if (elements.statTotalValue) elements.statTotalValue.textContent = total;
  if (elements.statCompletedValue) elements.statCompletedValue.textContent = completed;
  if (elements.statPendingValue) elements.statPendingValue.textContent = pending;
  if (elements.statOverdueValue) elements.statOverdueValue.textContent = overdue;

  if (elements.statOverdueCard) {
    elements.statOverdueCard.classList.toggle('has-overdue', overdue > 0);
  }

  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  if (elements.statCompletedRate) elements.statCompletedRate.textContent = `${percent}%`;

  // Badges in filter tabs
  if (elements.badgeAll) elements.badgeAll.textContent = total;
  if (elements.badgePending) elements.badgePending.textContent = pending;
  if (elements.badgeOverdue) elements.badgeOverdue.textContent = overdue;
  if (elements.badgeCompleted) elements.badgeCompleted.textContent = completed;

  // Clear completed button visibility
  if (elements.clearCompletedBtn) {
    elements.clearCompletedBtn.style.display = completed > 0 ? 'inline-block' : 'none';
  }

  // Segmented Progress Bar
  if (elements.progressSummaryText) {
    elements.progressSummaryText.textContent = `${completed} of ${total} completed`;
  }
  if (elements.progressPercent) {
    elements.progressPercent.textContent = `${percent}%`;
  }

  if (total === 0) {
    if (elements.segCompleted) elements.segCompleted.style.width = '0%';
    if (elements.segPending) elements.segPending.style.width = '0%';
    if (elements.segOverdue) elements.segOverdue.style.width = '0%';
  } else {
    const completedPct = (completed / total) * 100;
    const pendingPct = (pending / total) * 100;
    const overduePct = (overdue / total) * 100;

    if (elements.segCompleted) elements.segCompleted.style.width = `${completedPct}%`;
    if (elements.segPending) elements.segPending.style.width = `${pendingPct}%`;
    if (elements.segOverdue) elements.segOverdue.style.width = `${overduePct}%`;
  }
}

function renderTodoList() {
  const filteredTodos = state.todos.filter(todo => {
    if (state.filter === 'pending') return !todo.completed && !isOverdue(todo);
    if (state.filter === 'overdue') return isOverdue(todo);
    if (state.filter === 'completed') return todo.completed;
    return true;
  });

  // Handle Empty State
  if (filteredTodos.length === 0) {
    elements.todoList.innerHTML = '';
    elements.emptyState.style.display = 'flex';

    if (state.todos.length === 0) {
      elements.emptyTitle.textContent = 'No tasks yet';
      elements.emptyDesc.textContent = 'Add your first task above to start your day organized.';
    } else if (state.filter === 'pending') {
      elements.emptyTitle.textContent = 'No pending tasks!';
      elements.emptyDesc.textContent = 'All tasks are either completed or overdue.';
    } else if (state.filter === 'overdue') {
      elements.emptyTitle.textContent = 'No overdue tasks!';
      elements.emptyDesc.textContent = "You're completely caught up and on schedule.";
    } else if (state.filter === 'completed') {
      elements.emptyTitle.textContent = 'No completed tasks';
      elements.emptyDesc.textContent = 'Mark tasks as complete by clicking their checkbox.';
    }
    return;
  }

  elements.emptyState.style.display = 'none';

  elements.todoList.innerHTML = filteredTodos.map(todo => {
    return `
      <li class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
        <div class="todo-left" onclick="handleToggleComplete('${todo.id}')" role="button" tabindex="0" aria-label="Toggle ${escapeHtml(todo.title)}">
          <button type="button" class="checkbox-btn" aria-label="${todo.completed ? 'Mark incomplete' : 'Mark complete'}">
            <svg class="checkbox-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
          <div class="todo-details">
            <span class="todo-title">${escapeHtml(todo.title)}</span>
            <div class="todo-meta-row">
              <span class="todo-meta">${formatRelativeTime(todo.createdAt)}</span>
              ${renderDueDateBadge(todo.dueDate, todo.completed)}
            </div>
          </div>
        </div>
        <button 
          type="button" 
          class="delete-btn" 
          onclick="handleDeleteTask('${todo.id}')"
          aria-label="Delete task ${escapeHtml(todo.title)}"
          title="Delete task"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </li>
    `;
  }).join('');
}

function renderDueDateBadge(dueDateStr, completed) {
  if (!dueDateStr) return '';

  const parts = dueDateStr.split('-');
  if (parts.length !== 3) return '';
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return '';

  const dueDate = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Calculate whole days difference
  const diffDays = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));
  const formattedDate = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  let label = `Due ${formattedDate}`;
  let badgeClass = 'due-upcoming';

  if (diffDays < 0) {
    badgeClass = completed ? 'due-upcoming' : 'due-overdue';
    label = completed ? formattedDate : `Overdue · ${formattedDate}`;
  } else if (diffDays === 0) {
    badgeClass = 'due-today';
    label = 'Due today';
  } else if (diffDays === 1) {
    badgeClass = 'due-upcoming';
    label = 'Due tomorrow';
  }

  return `
    <span class="due-date-badge ${badgeClass}" title="Due: ${escapeHtml(dueDateStr)}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span>${label}</span>
    </span>
  `;
}

// ==========================================================================
// Helper Utilities
// ==========================================================================
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function showToast(message, type = 'info') {
  if (!elements.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'danger' ? 'toast-danger' : ''}`;
  
  const iconSvg = type === 'danger' 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;

  toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}
