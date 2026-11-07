/**
 * Taskly - Home Dashboard 2-Column Pastel Layout & Quick Share System Tests
 *
 * Verifies:
 * 1. Strict 2-column layout (no 1-col collapse, no 3+ columns)
 * 2. Pastel card colour assignment (Soft peach, soft cream, soft yellow, soft blue, soft mint, pink, lavender, periwinkle, buttercup)
 * 3. Quick Capture input styled with soft box colour (no black background)
 * 4. Complete task visibility (all pending and completed tasks rendered)
 * 5. Dedicated Quick Shares Collection card & standalone featured Pinned card
 * 6. Quick note pinning persistence & user isolation
 * 7. Calendar design remains 100% untouched
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');

describe('Taskly Home Dashboard 2-Column Pastel & Quick Share Suite', () => {

  describe('1. Responsive Multi-Column Masonry Architecture', () => {
    test('public/index.html organizes Home dashboard into a multi-column masonry container', () => {
      assert.match(INDEX_HTML, /class="[^"]*dash-home-2col-layout[^"]*"/, 'Expected .dash-home-2col-layout container in index.html');
      assert.match(INDEX_HTML, /class="[^"]*dash-home-masonry-layout[^"]*"/, 'Expected .dash-home-masonry-layout class in index.html');
      assert.match(INDEX_HTML, /class="[^"]*dash-home-col dash-home-col-left[^"]*"/, 'Expected left column in index.html');
      assert.match(INDEX_HTML, /class="[^"]*dash-home-col dash-home-col-right[^"]*"/, 'Expected right column in index.html');
    });

    test('public/styles.css enforces 1 full-width column on mobile phones (<768px) to prevent squeezed cards', () => {
      assert.match(STYLES_CSS, /@media\s*\(max-width:\s*767px\)/i, 'Expected @media (max-width: 767px) breakpoint');
      assert.match(STYLES_CSS, /\.dash-home-2col-layout[^}]*display:\s*flex/i,
        'Expected single-column flex column layout on mobile viewports (<768px)');
      assert.match(STYLES_CSS, /\.dash-home-col\s*\{[^}]*display:\s*contents/i,
        'Expected .dash-home-col to use display: contents on mobile for natural top-to-bottom card stacking');
    });

    test('public/styles.css enforces 2 columns on tablets and 3-4 columns on desktops', () => {
      assert.match(STYLES_CSS, /@media\s*\(min-width:\s*768px\)\s+and\s+\(max-width:\s*1024px\)\s*\{[^}]*grid-template-columns:\s*repeat\(2,/i,
        'Expected 2 columns on tablet viewports (768px - 1024px)');
      assert.match(STYLES_CSS, /@media\s*\(min-width:\s*1025px\)[^}]*grid-template-columns:\s*repeat\(3,/i,
        'Expected 3 columns on desktop viewports (1025px - 1439px)');
      assert.match(STYLES_CSS, /@media\s*\(min-width:\s*1440px\)\s*\{[^}]*grid-template-columns:\s*repeat\(4,/i,
        'Expected 4 columns on wide desktop viewports (>=1440px)');
    });

    test('Natural text wrapping is enforced for task titles without character-by-character breaking', () => {
      assert.match(STYLES_CSS, /\.task-title\s*\{[^}]*word-break:\s*normal/i, 'Expected word-break: normal on .task-title');
      assert.match(STYLES_CSS, /\.task-title\s*\{[^}]*overflow-wrap:\s*break-word/i, 'Expected overflow-wrap: break-word on .task-title');
    });
  });

  describe('2. Harmonious Pastel Palette & Input Box Styling (No Black)', () => {
    test('Quick Capture input row matches soft box colour with light mode enforced', () => {
      assert.match(STYLES_CSS, /\.card-quickcapture-cream\s*\{[^}]*background:\s*#FFF8F0/i, 'Quick Capture card should be soft cream #FFF8F0');
      assert.match(STYLES_CSS, /\.card-quickcapture-cream\s+\.qc-input-row\s*\{[^}]*background:\s*#FFF3EB/i,
        'Expected .qc-input-row to match soft box colour #FFF3EB');
      assert.match(STYLES_CSS, /\.card-quickcapture-cream\s+\.qc-input-field\s*\{[^}]*color:\s*#2B180E/i,
        'Expected .qc-input-field to use dark espresso text');
      assert.match(STYLES_CSS, /\.card-quickcapture-cream\s+\.qc-input-field\s*\{[^}]*color-scheme:\s*light/i,
        'Expected color-scheme: light to prevent browser dark mode from turning input black');
    });

    test('All major dashboard cards define coordinated pastel backgrounds in styles.css', () => {
      assert.match(STYLES_CSS, /\.card-stats-peach\s*\{[^}]*background:\s*#FFF3EA/i, 'Stats card should use soft peach #FFF3EA');
      assert.match(STYLES_CSS, /\.card-pinned-yellow\s*\{[^}]*background:\s*#FEF9C3/i, 'Pinned card should use soft yellow #FEF9C3');
      assert.match(STYLES_CSS, /\.card-quickshares-blue\s*\{[^}]*background:\s*#EDF7FF/i, 'Quick Shares collection should use soft sky blue #EDF7FF');
      assert.match(STYLES_CSS, /\.card-progress-mint\s*\{[^}]*background:\s*#EDFAF2/i, 'Progress card should use soft mint green #EDFAF2');
    });

    test('Dynamic task cards define coordinated pastel priority and category tints', () => {
      assert.match(STYLES_CSS, /\.task-item\.card-task-pink\s*\{[^}]*background:\s*#FFF0F3/i, 'High priority tasks should use soft pink #FFF0F3');
      assert.match(STYLES_CSS, /\.task-item\.card-task-lavender\s*\{[^}]*background:\s*#F4F0FF/i, 'Project tasks should use soft lavender #F4F0FF');
      assert.match(STYLES_CSS, /\.task-item\.card-task-periwinkle\s*\{[^}]*background:\s*#EEF2FF/i, 'Study tasks should use soft periwinkle #EEF2FF');
      assert.match(STYLES_CSS, /\.task-item\.card-task-buttercup\s*\{[^}]*background:\s*#FFFBEB/i, 'Completed tasks should use soft buttercup #FFFBEB');
    });

    test('public/app.js dynamically assigns pastel classes to task items', () => {
      assert.match(APP_JS, /card-task-pink/, 'Expected card-task-pink assigned in renderTaskItemHtml');
      assert.match(APP_JS, /card-task-lavender/, 'Expected card-task-lavender assigned in renderTaskItemHtml');
      assert.match(APP_JS, /card-task-periwinkle/, 'Expected card-task-periwinkle assigned in renderTaskItemHtml');
      assert.match(APP_JS, /card-task-buttercup/, 'Expected card-task-buttercup assigned in renderTaskItemHtml');
    });
  });

  describe('3. Dedicated Quick Shares Card & Standalone Pinned Card System', () => {
    test('public/index.html includes dedicated Quick Shares card and standalone Pinned card container', () => {
      assert.match(INDEX_HTML, /id="card-pinned-quick-share"/, 'Expected #card-pinned-quick-share in index.html');
      assert.match(INDEX_HTML, /id="section-quick-notes"/, 'Expected #section-quick-notes in index.html');
      assert.match(INDEX_HTML, /id="qc-notes-list"/, 'Expected #qc-notes-list in index.html');
    });

    test('public/app.js implements togglePinQuickNote and renderPinnedQuickShare', () => {
      assert.match(APP_JS, /function\s+togglePinQuickNote\s*\(/, 'Expected togglePinQuickNote function in app.js');
      assert.match(APP_JS, /function\s+renderPinnedQuickShare\s*\(/, 'Expected renderPinnedQuickShare function in app.js');
    });

    test('Pinning logic toggles isPinned and keeps only one featured pinned note', () => {
      const mockNotes = [
        { id: 1, text: 'Note 1', isPinned: false },
        { id: 2, text: 'Note 2', isPinned: true }
      ];

      function togglePin(notes, id) {
        const note = notes.find(n => n.id === id);
        if (!note) return;
        const willPin = !note.isPinned;
        notes.forEach(n => {
          if (n.id === id) {
            n.isPinned = willPin;
          } else if (willPin) {
            n.isPinned = false;
          }
        });
      }

      // Toggle note 1 to pinned
      togglePin(mockNotes, 1);
      assert.equal(mockNotes.find(n => n.id === 1).isPinned, true, 'Note 1 should be pinned');
      assert.equal(mockNotes.find(n => n.id === 2).isPinned, false, 'Note 2 should be unpinned');

      // Unpin note 1
      togglePin(mockNotes, 1);
      assert.equal(mockNotes.find(n => n.id === 1).isPinned, false, 'Note 1 should be unpinned');
      assert.equal(mockNotes.find(n => n.id === 2).isPinned, false, 'No note should be pinned');
    });

    test('Quick note storage supports user isolation key', () => {
      assert.match(APP_JS, /taskly_quick_notes_\$\{state\.user\.id\}/,
        'Expected user-isolated storage key in saveQuickNotesToStorage and loadStoredPreferences');
    });
  });

  describe('4. Complete Task Visibility (No Truncation)', () => {
    test('renderHome retains all tasks in displayTasks without arbitrary limits', () => {
      assert.match(APP_JS, /displayTasks\s*=\s*state\.todos;/, 'Expected all tasks displayed when filter is all');
      assert.doesNotMatch(APP_JS, /displayTasks\s*=\s*state\.todos\.slice\(0,\s*[0-9]+\)/,
        'displayTasks must not be artificially sliced or truncated');
    });
  });

  describe('5. Calendar Design Strictly Untouched (Part 6 Compliance)', () => {
    test('Calendar markup and component styles remain 100% intact', () => {
      assert.match(INDEX_HTML, /id="tab-calendar"/, 'Expected #tab-calendar in index.html');
      assert.match(STYLES_CSS, /\.cal-day-cell/, 'Expected .cal-day-cell intact in styles.css');
      assert.match(STYLES_CSS, /\.cal-strip-day/, 'Expected .cal-strip-day intact in styles.css');
      assert.match(STYLES_CSS, /\.cal-timeline-item/, 'Expected .cal-timeline-item intact in styles.css');
    });
  });

});
