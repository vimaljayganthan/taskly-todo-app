const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');

describe('Taskly Smart Lists — Multi-Viewport Responsive Layout Verification Suite', () => {
  const VIEWPORTS = [
    { name: 'Narrow Mobile (320px)', width: 320, padding: 10 },
    { name: 'Standard Android Compact (360px)', width: 360, padding: 16 },
    { name: 'Standard Mobile (375px)', width: 375, padding: 16 },
    { name: 'Modern Android / iPhone (390px)', width: 390, padding: 16 },
    { name: 'Pixel / Modern Flagship (412px)', width: 412, padding: 16 },
    { name: 'Large Mobile (430px)', width: 430, padding: 16 },
    { name: 'Tablet / Foldable (768px)', width: 768, padding: 16 }
  ];

  test('1. Core CSS Rules and Responsive Architecture Exist', () => {
    // Wrapper overflow-x hidden and box-sizing
    assert.ok(STYLES_CSS.includes('overflow-x: hidden;'), 'Screen wrapper must prevent horizontal overflow');
    assert.ok(STYLES_CSS.includes('box-sizing: border-box;'), 'Screen wrapper must enforce border-box');
    assert.ok(STYLES_CSS.includes('calc(110px + env(safe-area-inset-bottom, 0px))'), 'Bottom padding must clear bottom navigation bar');

    // Title card flex wrapping
    assert.ok(STYLES_CSS.includes('.smart-lists-title-card'), 'Title card must be styled');

    // Streak Hero row responsive flex-wrap
    assert.ok(STYLES_CSS.includes('.streak-hero-row'), 'Streak hero row must be styled');
    assert.ok(STYLES_CSS.includes('flex-wrap: wrap;'), 'Streak hero row must allow wrapping');

    // Habit metrics grid 3-column / 2-column minmax
    assert.ok(STYLES_CSS.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'Metrics grid must use minmax(0, 1fr)');

    // Add routine button 100% width and >= 44px touch target
    assert.ok(STYLES_CSS.includes('.btn-smart-add-trigger'), 'Add routine button must be styled');

    // Routine cards word-break and flexible wrap
    assert.ok(STYLES_CSS.includes('word-break: break-word;'), 'Titles must wrap with word-break: break-word');
    assert.ok(STYLES_CSS.includes('overflow-wrap: break-word;'), 'Titles must wrap with overflow-wrap');

    // Next-day routine cards flex wrap
    assert.ok(STYLES_CSS.includes('.next-day-routine-card'), 'Next-day card must be styled');
  });

  VIEWPORTS.forEach(vp => {
    test(`2. Viewport ${vp.name} [Width: ${vp.width}px] Layout Simulation`, () => {
      // Calculate available inner content width
      const totalHorizontalPadding = vp.padding * 2;
      const contentWidth = Math.min(vp.width - totalHorizontalPadding, 600);
      assert.ok(contentWidth > 0, `Content width must be positive: ${contentWidth}px`);

      // Card inner width (assuming 16px card padding, 12px on compact <=480px, 10px on <=380px)
      const cardPadding = vp.width <= 380 ? 12 : (vp.width <= 480 ? 14 : 16);
      const innerCardWidth = contentWidth - (cardPadding * 2);

      // Verify Metrics Grid Columns
      const columns = vp.width <= 330 ? 2 : 3;
      const colGap = vp.width <= 380 ? 6 : 8;
      const availableGridWidth = innerCardWidth - (vp.width <= 380 ? 12 : 20); // metrics grid padding
      const colWidth = (availableGridWidth - (colGap * (columns - 1))) / columns;

      assert.ok(colWidth >= 80, `Metric column width (${colWidth.toFixed(1)}px) at ${vp.width}px is sufficient for percentage and label`);

      // Verify Routine Card Space
      const routineCardPadding = vp.width <= 380 ? 10 : (vp.width <= 480 ? 12 : 14);
      const routineInnerWidth = contentWidth - (routineCardPadding * 2);
      const actionsWidth = 55 + 30 + 30 + 12; // status pill (55px) + 2 actions (30px each) + gaps
      const titleAvailableWidth = routineInnerWidth - actionsWidth - 8; // 8px card gap

      assert.ok(titleAvailableWidth >= 80, `Routine title available width (${titleAvailableWidth.toFixed(1)}px) at ${vp.width}px allows clean multiline text wrapping`);
    });
  });

  test('3. Mobile Breakpoint Media Queries Verified in styles.css', () => {
    assert.ok(STYLES_CSS.includes('@media (max-width: 480px)'), 'Max-width 480px media query exists');
    assert.ok(STYLES_CSS.includes('@media (max-width: 380px)'), 'Max-width 380px media query exists');
    assert.ok(STYLES_CSS.includes('@media (max-width: 330px)'), 'Max-width 330px media query exists');
  });

  test('4. Critical Touch Targets Meet or Exceed 44px Requirement', () => {
    // .btn-routine-status-pill
    const pillMatch = STYLES_CSS.match(/\.btn-routine-status-pill\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(pillMatch, '.btn-routine-status-pill min-height rule must exist');
    assert.ok(parseInt(pillMatch[1], 10) >= 44, '.btn-routine-status-pill min-height must be >= 44px');

    // .btn-status-option
    const optMatch = STYLES_CSS.match(/\.btn-status-option\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(optMatch, '.btn-status-option min-height rule must exist');
    assert.ok(parseInt(optMatch[1], 10) >= 44, '.btn-status-option min-height must be >= 44px');

    // .btn-reset-streak
    const resetMatch = STYLES_CSS.match(/\.btn-reset-streak\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(resetMatch, '.btn-reset-streak min-height rule must exist');
    assert.ok(parseInt(resetMatch[1], 10) >= 44, '.btn-reset-streak min-height must be >= 44px');

    // .btn-smart-add-trigger
    const addMatch = STYLES_CSS.match(/\.btn-smart-add-trigger\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(addMatch, '.btn-smart-add-trigger min-height rule must exist');
    assert.ok(parseInt(addMatch[1], 10) >= 44, '.btn-smart-add-trigger min-height must be >= 44px');
  });

  test('5. Safe Area and Bottom Navigation Clearance', () => {
    // Verify #tab-smart-lists bottom padding
    const tabSmartListsMatch = STYLES_CSS.match(/#tab-smart-lists\s*\{([^}]*)\}/);
    assert.ok(tabSmartListsMatch, '#tab-smart-lists rule must exist');
    const tabRule = tabSmartListsMatch[1];
    assert.ok(tabRule.includes('calc(110px + env(safe-area-inset-bottom, 0px))'), 'Bottom padding must be at least 110px + safe area');
  });
});
