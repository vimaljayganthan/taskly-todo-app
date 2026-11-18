const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRATCH_DIR = '/Users/vimaljayganthan/.gemini/antigravity/brain/a63d551c-c485-47d8-a379-5b12ada06ef6/scratch';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STYLES_PATH = path.resolve(__dirname, '..', 'public', 'styles.css');

function generateHtml(options = {}) {
  const {
    theme = 'light',
    hasRoutines = false,
    routines = [],
    fontScale = 1.0,
    isLandscape = false
  } = options;

  const routineItemsHtml = routines.map(r => `
    <div class="smart-routine-card ${r.completed ? 'completed' : ''} status-${r.status || 'pending'}" data-routine-id="${r.id}">
      <div class="smart-routine-left">
        <label class="smart-checkbox-wrap" aria-label="Mark ${r.title}">
          <input type="checkbox" ${r.completed ? 'checked' : ''}>
          <span class="smart-custom-check">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </label>
        <div class="smart-routine-info">
          <span class="routine-title">${r.title}</span>
        </div>
      </div>
      <div class="smart-routine-actions">
        <button type="button" class="btn-routine-status-pill status-${r.status || 'pending'}">
          <span class="status-pill-icon">${r.completed ? '✓' : '○'}</span>
          <span class="status-pill-text">${r.completed ? 'Done' : 'Pending'}</span>
        </button>
        <button type="button" class="btn-routine-action btn-routine-edit" aria-label="Edit ${r.title}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button type="button" class="btn-routine-action btn-routine-delete" aria-label="Delete ${r.title}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" style="font-size: ${16 * fontScale}px;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <link rel="stylesheet" href="${STYLES_PATH}">
  <style>
    body { margin: 0; padding: 0; background: var(--app-bg, #f8fafc); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .tab-view { display: block !important; }
  </style>
</head>
<body>
  <div class="app-viewport">
    <section id="tab-smart-lists" class="tab-view theme-smart-lists-screen">
      <div class="smart-lists-wrapper">
        <!-- Navigation Header -->
        <div class="smart-lists-header-bar">
          <button type="button" class="btn-back btn-back-smart" id="btn-back-from-smart-lists" aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div class="smart-lists-top-actions">
            <button type="button" class="btn-smart-action btn-smart-summary-trigger" id="btn-open-smart-summary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>Summary</span>
            </button>
            <button type="button" class="btn-smart-action btn-smart-settings-trigger btn-smart-icon-only" id="btn-open-smart-settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>

        <!-- Title Card -->
        <div class="smart-lists-title-card">
          <div class="smart-lists-title-row">
            <div class="smart-badge-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
            <div class="smart-title-text-group">
              <h2 class="smart-lists-heading">Smart Lists</h2>
              <p class="smart-lists-subheading">Wednesday, Nov 18, 2026</p>
            </div>
          </div>
          <div class="smart-lists-progress-pill">
            <span>${hasRoutines ? (routines.filter(r => r.completed).length + ' / ' + routines.length + ' completed') : '0 / 0 completed'}</span>
          </div>
        </div>

        <!-- Habit Streak Card -->
        <div class="smart-habit-streak-card">
          <div class="streak-hero-row">
            <div class="streak-flame-stat">
              <span class="streak-flame-icon">🔥</span>
              <div class="streak-flame-texts">
                <div class="streak-flame-count">0 Days</div>
                <div class="streak-flame-label">Current Streak</div>
              </div>
            </div>
            <div class="streak-best-badge">
              <span>🏆 Best: 0 Days</span>
            </div>
            <button type="button" class="btn-reset-streak">
              <span class="reset-streak-icon">↺</span>
              <span class="reset-streak-label">Reset</span>
            </button>
          </div>

          <div class="smart-habit-metrics-grid">
            <div class="habit-metric-box">
              <span class="habit-metric-val">0%</span>
              <span class="habit-metric-label">Today's Rate</span>
              <span class="habit-target-hint">Target: 80%</span>
            </div>
            <div class="habit-metric-box">
              <span class="habit-metric-val">0%</span>
              <span class="habit-metric-label">This Week</span>
              <span class="habit-target-hint">0/2 days</span>
            </div>
            <div class="habit-metric-box">
              <span class="habit-metric-val">0%</span>
              <span class="habit-metric-label">This Month</span>
              <span class="habit-target-hint">0/18 days</span>
            </div>
          </div>

          <div class="smart-breakdown-row">
            <span class="breakdown-chip chip-completed">✓ ${routines.filter(r => r.completed).length} Done</span>
            <span class="breakdown-chip chip-pending">○ ${routines.filter(r => !r.completed).length} Pending</span>
          </div>
        </div>

        <!-- Body Container -->
        <div class="smart-lists-body">
          ${hasRoutines ? `
            <div class="smart-add-routine-box" id="smart-add-routine-box">
              <button type="button" class="btn-smart-add-trigger" id="btn-toggle-add-routine">
                <span class="smart-add-plus">+</span>
                <span>Add Routine</span>
              </button>
            </div>
            <div class="smart-routines-list">
              ${routineItemsHtml}
            </div>
          ` : `
            <div class="smart-empty-state" id="smart-empty-state">
              <div class="smart-empty-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </div>
              <h4 class="smart-empty-title">No routines yet. Start building your daily habits.</h4>
              <p class="smart-empty-desc">Routines are simple daily checklists that reset each day without task complexity.</p>
              <button type="button" class="btn-smart-empty-add" id="btn-empty-add-routine">+ Add Your First Routine</button>
            </div>
          `}

          <!-- Tomorrow Section -->
          <div class="smart-next-day-section">
            <div class="next-day-section-header">
              <div class="next-day-title-wrap">
                <div class="next-day-icon">🌅</div>
                <div>
                  <h4 class="next-day-heading">Tomorrow's Routines</h4>
                  <span class="next-day-subtitle">2026-11-19</span>
                </div>
              </div>
              <div class="next-day-header-actions">
                <span class="next-day-count-badge">${hasRoutines ? '1 routine' : '0 routines'}</span>
                <button type="button" class="btn-next-day-add">+ Add Routine</button>
              </div>
            </div>

            ${hasRoutines ? `
              <div class="next-day-routines-list">
                <div class="next-day-routine-card">
                  <div class="next-day-card-left">
                    <span class="next-day-status-pill pending">Pending</span>
                    <div class="next-day-info">
                      <span class="next-day-routine-name">Hii</span>
                    </div>
                  </div>
                  <div class="smart-routine-actions">
                    <button type="button" class="btn-routine-action"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                    <button type="button" class="btn-routine-action"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Footer Summary -->
          <div class="smart-footer-summary-wrap">
            <button type="button" class="btn-smart-footer-summary">
              <div class="footer-summary-left">
                <div class="footer-summary-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div class="footer-summary-texts">
                  <span class="footer-summary-title">Daily Routine Summary</span>
                  <span class="footer-summary-sub">${hasRoutines ? '0 of 1 routines completed today (0%)' : 'Add your routines to generate reports'}</span>
                </div>
              </div>
              <span class="footer-summary-chevron">›</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Bottom Nav -->
    <nav class="bottom-nav">
      <button class="nav-tab"><span class="nav-icon">🏠</span><span class="nav-label">Home</span></button>
      <button class="nav-tab"><span class="nav-icon">📅</span><span class="nav-label">Calendar</span></button>
      <button class="nav-fab"><div class="fab-circle">+</div></button>
      <button class="nav-tab"><span class="nav-icon">📊</span><span class="nav-label">Progress</span></button>
      <button class="nav-tab active"><span class="nav-icon">👤</span><span class="nav-label">Profile</span></button>
    </nav>
  </div>
</body>
</html>`;
}

// Generate test matrix
const testCases = [
  { id: '1_compact_320x640_empty', width: 320, height: 640, options: { hasRoutines: false, theme: 'light' } },
  { id: '2_compact_320x640_saved', width: 320, height: 640, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false }], theme: 'light' } },
  { id: '3_standard_390x844_empty', width: 390, height: 844, options: { hasRoutines: false, theme: 'light' } },
  { id: '4_standard_390x844_saved', width: 390, height: 844, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false }], theme: 'light' } },
  { id: '5_pixel_412x915_multiple', width: 412, height: 915, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: true, status: 'completed' }, { id: '2', title: 'Drink 3L water', completed: false, status: 'pending' }], theme: 'light' } },
  { id: '6_tablet_768x1024', width: 768, height: 1024, options: { hasRoutines: true, routines: [{ id: '1', title: 'Morning meditation' }], theme: 'light' } },
  { id: '7_theme_dark_390x844', width: 390, height: 844, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false }], theme: 'dark' } },
  { id: '8_theme_pet_390x844', width: 390, height: 844, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false }], theme: 'pet' } },
  { id: '9_theme_pastel_390x844', width: 390, height: 844, options: { hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false }], theme: 'pastel' } },
  { id: '10_font_scale_150_360x720', width: 360, height: 720, options: { hasRoutines: true, routines: [{ id: '1', title: 'Drink water', completed: false }], fontScale: 1.5, theme: 'light' } },
  { id: '11_font_scale_200_360x800', width: 360, height: 800, options: { hasRoutines: true, routines: [{ id: '1', title: 'Very long routine title testing 200% font scaling', completed: false }], fontScale: 2.0, theme: 'light' } },
  { id: '12_landscape_800x360', width: 800, height: 360, options: { hasRoutines: false, theme: 'light', isLandscape: true } }
];

console.log('Generating test HTML files and capturing screenshots...');

testCases.forEach(tc => {
  const htmlContent = generateHtml(tc.options);
  const htmlPath = path.join(SCRATCH_DIR, `${tc.id}.html`);
  const pngPath = path.join(SCRATCH_DIR, `${tc.id}.png`);
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  try {
    const cmd = `"${CHROME_PATH}" --headless=new --user-data-dir="/tmp/chrome-audit-${tc.id}" --screenshot="${pngPath}" --window-size=${tc.width},${tc.height} "file://${htmlPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    const stat = fs.statSync(pngPath);
    console.log(`[PASS] ${tc.id}: ${stat.size} bytes (${tc.width}x${tc.height})`);
  } catch (err) {
    console.error(`[FAIL] ${tc.id}: ${err.message}`);
  }
});

console.log('Screenshots generation complete.');
