const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARTIFACTS_DIR = '/Users/vimaljayganthan/.gemini/antigravity/brain/a63d551c-c485-47d8-a379-5b12ada06ef6';
const SCRATCH_DIR = path.join(ARTIFACTS_DIR, 'scratch');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STYLES_PATH = path.resolve(__dirname, '..', 'public', 'styles.css');

if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

const stylesCss = fs.readFileSync(STYLES_PATH, 'utf8');

function generateHtml(options = {}) {
  const {
    oem = 'generic',
    platform = 'native_android',
    viewportCategory = 'standard',
    orientation = 'portrait',
    fontScale = 1.0,
    theme = 'light',
    hasRoutines = false,
    routines = []
  } = options;

  const fontScaleCat = fontScale <= 1.15 ? 'normal' : (fontScale <= 1.4 ? 'medium' : (fontScale <= 1.7 ? 'large' : 'xlarge'));

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
<html lang="en" data-theme="${theme}" data-device-oem="${oem}" data-device-platform="${platform}" data-viewport-category="${viewportCategory}" data-orientation="${orientation}" data-font-scale="${fontScaleCat}" style="font-size: ${16 * fontScale}px;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>Taskly Device Simulation: ${oem} (${viewportCategory})</title>
  <style>
    ${stylesCss}
    body {
      margin: 0;
      padding: 0;
      background: var(--app-bg);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body data-theme="${theme}" data-device-oem="${oem}" data-device-platform="${platform}" data-viewport-category="${viewportCategory}" data-orientation="${orientation}" data-font-scale="${fontScaleCat}">
  <div class="app-viewport">
    <div id="main-flow" class="screen-flow active">
      <section id="tab-smart-lists" class="tab-view theme-smart-lists-screen" style="display: flex;">
        <div class="smart-lists-wrapper">
          <!-- Header Bar -->
          <div class="smart-lists-header-bar">
            <button type="button" class="btn-back btn-back-smart" aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div class="smart-lists-top-actions">
              <button type="button" class="btn-smart-action btn-smart-summary-trigger" id="btn-open-smart-summary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                <span>Summary</span>
              </button>
              <button type="button" class="btn-smart-action btn-smart-settings-trigger btn-smart-icon-only">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </div>

          <!-- Title Card -->
          <div class="smart-lists-title-card">
            <div class="smart-lists-title-row">
              <div class="smart-badge-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="M9 7h4"/><path d="M9 17h8"/></svg>
              </div>
              <div class="smart-title-text-group">
                <h2 class="smart-lists-heading">Smart Lists</h2>
                <p class="smart-lists-subheading">Tuesday, Nov 17, 2026</p>
              </div>
            </div>
            <div class="smart-lists-progress-pill">
              <span>${hasRoutines ? '0 / 1 completed • 0%' : '0 / 0 completed'}</span>
            </div>
          </div>

          <!-- Streak Card -->
          <div class="smart-habit-streak-card">
            <div class="streak-hero-row">
              <div class="streak-flame-stat">
                <span class="streak-flame-icon">🔥</span>
                <div class="streak-flame-texts">
                  <div class="streak-flame-count">0 Days</div>
                  <div class="streak-flame-label">CURRENT STREAK</div>
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

            <!-- Metrics Grid -->
            <div class="smart-habit-metrics-grid">
              <div class="habit-metric-box">
                <span class="habit-metric-val">0%</span>
                <span class="habit-metric-label">TODAY'S RATE</span>
                <span class="habit-target-hint">Target: 80%</span>
              </div>
              <div class="habit-metric-box">
                <span class="habit-metric-val">0%</span>
                <span class="habit-metric-label">THIS WEEK</span>
                <span class="habit-target-hint">0/2 days</span>
              </div>
              <div class="habit-metric-box">
                <span class="habit-metric-val">0%</span>
                <span class="habit-metric-label">THIS MONTH</span>
                <span class="habit-target-hint">0/17 days</span>
              </div>
            </div>

            <!-- Breakdown Row -->
            <div class="smart-breakdown-row">
              <span class="breakdown-chip chip-completed">✓ 0 Done</span>
              <span class="breakdown-chip chip-pending">○ ${hasRoutines ? '0' : '0'} Pending</span>
            </div>
          </div>

          <!-- Body -->
          <div class="smart-lists-body">
            <!-- Add Routine Trigger (visible when routines exist) -->
            ${hasRoutines ? `
              <div class="smart-add-routine-box" style="display: block;">
                <button type="button" class="btn-smart-add-trigger">
                  <span class="smart-add-plus">+</span>
                  <span>Add Routine</span>
                </button>
              </div>
            ` : ''}

            <!-- Routine Items -->
            ${hasRoutines ? `
              <div class="smart-routines-list">
                ${routineItemsHtml}
              </div>
            ` : `
              <!-- Empty State (Only CTA when 0 routines exist) -->
              <div class="smart-empty-state" style="display: flex;">
                <div class="smart-empty-icon">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <h4 class="smart-empty-title">No routines yet. Start building your daily habits.</h4>
                <p class="smart-empty-desc">Routines are simple daily checklists that reset each day without task complexity.</p>
                <button type="button" class="btn-smart-empty-add">+ Add Your First Routine</button>
              </div>
            `}

            <!-- Tomorrow's Routines Section -->
            <div class="smart-next-day-section">
              <div class="next-day-section-header">
                <div class="next-day-title-wrap">
                  <div class="next-day-icon">🌅</div>
                  <div class="next-day-title-texts">
                    <h3 class="next-day-heading">Tomorrow's Routines</h3>
                    <span class="next-day-subtitle">2026-11-18</span>
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
                    <div class="next-day-routine-info">
                      <span class="next-day-routine-name">Hii</span>
                      <div class="next-day-badges-row">
                        <span class="badge-scheduled-tomorrow">Scheduled</span>
                        <span class="badge-status-subtle status-pending">Pending</span>
                      </div>
                    </div>
                    <div class="next-day-routine-actions">
                      <button type="button" class="btn-next-day-action btn-next-day-edit" aria-label="Edit Hii">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      </button>
                      <button type="button" class="btn-next-day-action btn-next-day-delete" aria-label="Delete Hii">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              ` : `
                <div class="next-day-empty-state" style="display: flex;">
                  <span class="next-day-empty-icon">🌱</span>
                  <p class="next-day-empty-text">No routines scheduled for tomorrow yet.</p>
                </div>
              `}
            </div>

            <!-- Footer Summary -->
            <div class="smart-footer-summary-wrap">
              <button type="button" class="btn-smart-footer-summary">
                <div class="footer-summary-left">
                  <div class="footer-summary-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
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

      <!-- Bottom Navigation -->
      <nav class="bottom-nav">
        <button class="nav-tab"><span class="nav-icon">🏠</span><span class="nav-label">Home</span></button>
        <button class="nav-tab"><span class="nav-icon">📅</span><span class="nav-label">Calendar</span></button>
        <button class="nav-fab"><div class="fab-circle">+</div></button>
        <button class="nav-tab"><span class="nav-icon">📊</span><span class="nav-label">Progress</span></button>
        <button class="nav-tab active"><span class="nav-icon">👤</span><span class="nav-label">Profile</span></button>
      </nav>
    </div>
  </div>
</body>
</html>`;
}

// Matrix of OEM + Viewport + Theme simulations
const simulationMatrix = [
  { id: 'oem_oneplus_412x915', width: 412, height: 915, options: { oem: 'oneplus', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_samsung_412x915', width: 412, height: 915, options: { oem: 'samsung', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_xiaomi_393x873', width: 393, height: 873, options: { oem: 'xiaomi', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_poco_393x873_empty', width: 393, height: 873, options: { oem: 'poco', hasRoutines: false, theme: 'light' } },
  { id: 'oem_redmi_360x800', width: 360, height: 800, options: { oem: 'redmi', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_realme_390x844', width: 390, height: 844, options: { oem: 'realme', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_vivo_390x844', width: 390, height: 844, options: { oem: 'vivo', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_oppo_412x915', width: 412, height: 915, options: { oem: 'oppo', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'oem_motorola_360x800', width: 360, height: 800, options: { oem: 'motorola', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'viewport_compact_320x640', width: 320, height: 640, options: { oem: 'generic', viewportCategory: 'compact', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'viewport_tablet_768x1024', width: 768, height: 1024, options: { oem: 'generic', viewportCategory: 'tablet', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'font_scale_200_360x800', width: 360, height: 800, options: { oem: 'generic', fontScale: 2.0, hasRoutines: true, routines: [{ id: '1', title: 'Routine with 200% font scale', completed: false, status: 'pending' }], theme: 'light' } },
  { id: 'orientation_landscape_800x360', width: 800, height: 360, options: { oem: 'generic', orientation: 'landscape', hasRoutines: false, theme: 'light' } },
  { id: 'theme_pastel_empty_repro', width: 390, height: 844, options: { oem: 'generic', hasRoutines: false, theme: 'pastel' } },
  { id: 'theme_day_saved_repro', width: 412, height: 915, options: { oem: 'oneplus', hasRoutines: true, routines: [{ id: '1', title: 'Hii', completed: false, status: 'pending' }], theme: 'light' } }
];

console.log('Rendering OEM and responsive matrix screenshots...');

simulationMatrix.forEach(item => {
  const htmlContent = generateHtml(item.options);
  const htmlFile = path.join(SCRATCH_DIR, `${item.id}.html`);
  const pngFile = path.join(ARTIFACTS_DIR, `${item.id}.png`);
  fs.writeFileSync(htmlFile, htmlContent, 'utf8');

  try {
    const cmd = `"${CHROME_PATH}" --headless=new --disable-gpu --disable-software-rasterizer --no-sandbox --user-data-dir="/tmp/chrome-oem-${item.id}" --screenshot="${pngFile}" --window-size=${item.width},${item.height} "file://${htmlFile}"`;
    execSync(cmd, { stdio: 'pipe' });
    const stat = fs.statSync(pngFile);
    console.log(`[PASS] ${item.id}: ${stat.size} bytes (${item.width}x${item.height}, OEM: ${item.options.oem}, Theme: ${item.options.theme})`);
  } catch (err) {
    console.error(`[FAIL] ${item.id}: ${err.message}`);
  }
});

console.log('Matrix generation finished successfully.');
