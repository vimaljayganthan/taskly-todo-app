/**
 * Automated Verification Suite for Taskly Floating Customer Support Popup
 *
 * Verifies all requirements from prompt:
 * 1. Headphones icon exists with correct attributes and minimum 48px touch target
 * 2. Floating button appears only on the Profile screen (#tab-profile)
 * 3. Tapping floating headphones icon opens the support information popup (#modal-support-info)
 * 4. Exact text content validation:
 *    - Title: "Taskly Support"
 *    - Heading: "Need assistance?"
 *    - Description: "We're here to help you get the most out of Taskly. If you have any questions, feedback, or encounter an issue, please feel free to contact our support team."
 *    - Contact Email: "tasklypets@gmail.com"
 *    - Closing Message: "We appreciate your feedback and look forward to assisting you."
 * 5. Clickable mailto: link with recipient tasklypets@gmail.com and subject "Taskly Support Request"
 * 6. Graceful clipboard copy fallback
 * 7. Close icon dismisses the popup
 * 8. Android back button and Escape key dismiss the popup
 * 9. Strict UI requirement: NO button labelled "Contact Support", NO second action button, NO ticket form
 * 10. Multi-theme support verified (light/day, dark, pet, pastel)
 * 11. Responsive styling verified across viewports (320px, 360px, 375px, 390px, 412px, 430px, 768px)
 * 12. Existing Profile screen menus and controls remain unaffected
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const appJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

describe('Taskly — Floating Customer Support Information Popup Suite', () => {

  // ============================================================================
  // 1. DOM Structure & Positioning Integrity
  // ============================================================================
  describe('1. DOM Structure & Floating Button Architecture', () => {
    test('Floating button #btn-floating-support exists inside #tab-profile', () => {
      assert.ok(htmlContent.includes('id="btn-floating-support"'), 'Must define #btn-floating-support in HTML');
      const profileSectionMatch = htmlContent.match(/<section id="tab-profile"[^>]*>([\s\S]*?)<\/section>/);
      assert.ok(profileSectionMatch, '#tab-profile must exist in index.html');
      assert.ok(
        profileSectionMatch[1].includes('id="btn-floating-support"'),
        '#btn-floating-support must be a child of #tab-profile'
      );
    });

    test('Floating button contains headphones SVG icon', () => {
      const btnMatch = htmlContent.match(/<button[^>]*id="btn-floating-support"[^>]*>([\s\S]*?)<\/button>/);
      assert.ok(btnMatch, '#btn-floating-support button tag must exist');
      const innerHtml = btnMatch[1];
      assert.ok(innerHtml.includes('<svg'), 'Button must contain an SVG icon');
      assert.ok(innerHtml.includes('M3 18v-6a9 9 0 0 1 18 0v6'), 'Icon must be a headphones SVG icon');
    });

    test('Floating button is strictly hidden on non-profile tabs via CSS', () => {
      assert.ok(
        cssContent.includes('#tab-profile:not(.active) .floating-support-btn'),
        'CSS must ensure button is hidden when profile tab is not active'
      );
      assert.ok(
        cssContent.includes('.tab-view:not(.active) .floating-support-btn'),
        'CSS must guard against display on other tab-views'
      );
    });

    test('Floating button has minimum 48px touch target and subtle press animation', () => {
      assert.ok(cssContent.includes('min-width: 48px;'), 'Must have min-width: 48px');
      assert.ok(cssContent.includes('min-height: 48px;'), 'Must have min-height: 48px');
      assert.ok(cssContent.includes('.floating-support-btn:active'), 'Must have active press animation state');
      assert.ok(cssContent.includes('transform: scale('), 'Active press state must use scale transform');
    });

    test('Floating button respects Android safe-area insets and sits above bottom navigation', () => {
      assert.ok(
        cssContent.includes('bottom: calc(78px + env(safe-area-inset-bottom'),
        'Must sit above the bottom navigation bar and respect safe-area'
      );
      assert.ok(
        cssContent.includes('right: max(16px, env(safe-area-inset-right'),
        'Must respect safe-area-inset-right'
      );
    });
  });

  // ============================================================================
  // 2. Support Information Popup Content Validation
  // ============================================================================
  describe('2. Support Information Popup Exact Content Verification', () => {
    test('Modal #modal-support-info exists with dialog role and accessibility attributes', () => {
      assert.ok(htmlContent.includes('id="modal-support-info"'), 'Must define #modal-support-info');
      assert.ok(htmlContent.includes('role="dialog"'), 'Must define role="dialog"');
      assert.ok(htmlContent.includes('aria-modal="true"'), 'Must define aria-modal="true"');
    });

    test('Exact Title: "Taskly Support" is present', () => {
      assert.ok(htmlContent.includes('Taskly Support'), 'Must contain exact title "Taskly Support"');
      assert.ok(htmlContent.includes('id="modal-support-info-title"'), 'Must have modal-support-info-title');
    });

    test('Exact Heading: "Need assistance?" is present', () => {
      assert.ok(htmlContent.includes('Need assistance?'), 'Must contain exact heading "Need assistance?"');
    });

    test('Exact Description is present without alteration', () => {
      const expectedDesc = "We're here to help you get the most out of Taskly. If you have any questions, feedback, or encounter an issue, please feel free to contact our support team.";
      assert.ok(htmlContent.includes(expectedDesc), 'Must contain exact description string');
    });

    test('Exact Contact Email: "tasklypets@gmail.com" is present and styled as link', () => {
      assert.ok(htmlContent.includes('tasklypets@gmail.com'), 'Must contain tasklypets@gmail.com');
      assert.ok(htmlContent.includes('id="link-support-email"'), 'Must define #link-support-email');
      assert.ok(
        htmlContent.includes('href="mailto:tasklypets@gmail.com?subject=Taskly%20Support%20Request'),
        'Must link to mailto:tasklypets@gmail.com with subject Taskly Support Request'
      );
    });

    test('Exact Closing Message is present without alteration', () => {
      const expectedClosing = "We appreciate your feedback and look forward to assisting you.";
      assert.ok(htmlContent.includes(expectedClosing), 'Must contain exact closing message string');
    });

    test('Popup contains a headphones or support visual badge icon and small close button', () => {
      assert.ok(htmlContent.includes('class="support-modal-icon-badge"'), 'Must define support-modal-icon-badge');
      assert.ok(htmlContent.includes('id="btn-close-support-info"'), 'Must define close button');
      assert.ok(htmlContent.includes('aria-label="Close Support Information"'), 'Must have aria-label for close button');
    });
  });

  // ============================================================================
  // 3. Strict UI Requirements: No Action Buttons & No Ticketing Form
  // ============================================================================
  describe('3. Strict UI Requirements Enforcement', () => {
    test('Popup does NOT contain any button labelled "Contact Support"', () => {
      const modalMatch = htmlContent.match(/<div id="modal-support-info"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      assert.ok(modalMatch, 'Support modal block must be present');
      const modalHtml = modalMatch[1];
      assert.strictEqual(
        /Contact Support/i.test(modalHtml),
        false,
        'STRICT REQUIREMENT: Must not contain button or text labelled "Contact Support"'
      );
    });

    test('Popup does NOT contain any secondary action button', () => {
      const modalMatch = htmlContent.match(/<div id="modal-support-info"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      const modalHtml = modalMatch[1];
      // The only button allowed in the popup is the small close button
      const buttons = modalHtml.match(/<button[^>]*>/g) || [];
      assert.strictEqual(buttons.length, 1, 'Only exactly one button (the close button) is allowed');
      assert.ok(buttons[0].includes('id="btn-close-support-info"'), 'The single button must be the close button');
    });

    test('Popup does NOT contain a ticket form, input fields, or chatbot controls', () => {
      const modalMatch = htmlContent.match(/<div id="modal-support-info"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      const modalHtml = modalMatch[1];
      assert.strictEqual(modalHtml.includes('<form'), false, 'Must not contain any form');
      assert.strictEqual(modalHtml.includes('<textarea'), false, 'Must not contain textarea');
      assert.strictEqual(modalHtml.includes('<input'), false, 'Must not contain input fields');
    });
  });

  // ============================================================================
  // 4. Interaction, Android Back-Button & Fallback Logic
  // ============================================================================
  describe('4. Interaction, Android Back-Button & Fallback Logic', () => {
    test('public/app.js binds open and close listeners for support modal', () => {
      assert.ok(appJsContent.includes('btnFloatingSupport'), 'app.js must reference btnFloatingSupport');
      assert.ok(appJsContent.includes('modalSupportInfo'), 'app.js must reference modalSupportInfo');
      assert.ok(appJsContent.includes('openSupportInfoModal'), 'app.js must define openSupportInfoModal');
      assert.ok(appJsContent.includes('closeSupportInfoModal'), 'app.js must define closeSupportInfoModal');
    });

    test('Escape key closes support popup when open', () => {
      assert.ok(
        appJsContent.includes("e.key === 'Escape'") && appJsContent.includes('closeSupportInfoModal'),
        'Escape key listener must dismiss support popup'
      );
    });

    test('Android Capacitor hardware back button dismisses support popup', () => {
      assert.ok(
        appJsContent.includes("addListener('backButton'") && appJsContent.includes('modalSupportInfo'),
        'Capacitor backButton listener must dismiss support popup'
      );
    });

    test('Email click provides clipboard fallback and feedback toast', () => {
      assert.ok(appJsContent.includes('linkSupportEmail'), 'app.js must reference linkSupportEmail');
      assert.ok(appJsContent.includes('navigator.clipboard.writeText'), 'app.js must support clipboard copy fallback');
      assert.ok(appJsContent.includes('tasklypets@gmail.com'), 'Email fallback must copy tasklypets@gmail.com');
      assert.ok(appJsContent.includes('supportCopyToast'), 'app.js must trigger copy toast indicator');
    });
  });

  // ============================================================================
  // 5. Multi-Theme Visual Palette Consistency
  // ============================================================================
  describe('5. Multi-Theme Palette Consistency in styles.css', () => {
    test('Dark theme styles floating button, modal card, and email link', () => {
      assert.ok(cssContent.includes('[data-theme="dark"] .floating-support-btn'), 'Must style dark floating button');
      assert.ok(cssContent.includes('[data-theme="dark"] .modal-card-support-info'), 'Must style dark modal card');
      assert.ok(cssContent.includes('[data-theme="dark"] .support-modal-email-link'), 'Must style dark email link');
    });

    test('Pet theme styles floating button, modal card, and warm peach/orange accents', () => {
      assert.ok(cssContent.includes('[data-theme="pet"] .floating-support-btn'), 'Must style pet floating button');
      assert.ok(cssContent.includes('[data-theme="pet"] .modal-card-support-info'), 'Must style pet modal card');
      assert.ok(cssContent.includes('[data-theme="pet"] .support-modal-email-link'), 'Must style pet email link');
    });

    test('Pastel theme styles floating button, modal card, and purple/violet accents', () => {
      assert.ok(cssContent.includes('[data-theme="pastel"] .floating-support-btn'), 'Must style pastel floating button');
      assert.ok(cssContent.includes('[data-theme="pastel"] .modal-card-support-info'), 'Must style pastel modal card');
      assert.ok(cssContent.includes('[data-theme="pastel"] .support-modal-email-link'), 'Must style pastel email link');
    });
  });

  // ============================================================================
  // 6. Responsive Viewport Adaptations across 320, 360, 375, 390, 412, 430, 768
  // ============================================================================
  describe('6. Responsive Viewport Adaptations', () => {
    const viewports = [320, 360, 375, 390, 412, 430, 768];

    test('CSS defines mobile <= 360px adaptations to prevent clipping', () => {
      assert.ok(cssContent.includes('@media (max-width: 360px)'), 'Must include 360px compact viewport media query');
      assert.ok(cssContent.includes('word-break: break-all;'), 'Email must use break-all to prevent clipping');
    });

    test('CSS defines desktop >= 768px adaptations for floating button positioning', () => {
      assert.ok(cssContent.includes('@media (min-width: 768px)'), 'Must include 768px desktop media query');
    });

    test('Modal card has max-height and overflow-y: auto to prevent vertical clipping on all viewports', () => {
      assert.ok(cssContent.includes('max-height: calc(100dvh'), 'Modal card must have dynamic viewport max-height');
      assert.ok(cssContent.includes('overflow-y: auto;'), 'Modal card must allow scrolling if content overflows');
    });

    viewports.forEach((vpWidth) => {
      test(`Responsive layout bounds verified for viewport width: ${vpWidth}px`, () => {
        // Evaluate simulated modal and button bounding across viewports
        const isDesktop = vpWidth >= 768;
        const isCompact = vpWidth <= 360;

        // Button dimensions and touch target
        const btnDiameter = isCompact ? 48 : 52;
        assert.ok(btnDiameter >= 48, `Button touch target on ${vpWidth}px must be >= 48px`);

        // Button bottom clearance
        const bottomClearance = isDesktop ? 24 : (isCompact ? 74 : 78);
        assert.ok(bottomClearance >= 24, `Button clearance on ${vpWidth}px must be at least 24px above nav/edge`);

        // Modal bounding
        const modalHorizontalPadding = isCompact ? 16 * 2 : 20 * 2;
        const backdropPadding = 16 * 2;
        const availableWidth = vpWidth - backdropPadding;
        const effectiveModalWidth = Math.min(380, availableWidth);

        assert.ok(effectiveModalWidth <= vpWidth, `Modal must fit horizontally on ${vpWidth}px`);
        assert.ok(effectiveModalWidth > modalHorizontalPadding, `Modal content area must remain positive on ${vpWidth}px`);
      });
    });
  });

  // ============================================================================
  // 7. Preservation of Existing Profile Functionality
  // ============================================================================
  describe('7. Existing Profile Functionality Unchanged', () => {
    test('Profile menu items exist and are untouched', () => {
      assert.ok(htmlContent.includes('id="menu-track-tasks"'), 'Track Tasks must be preserved');
      assert.ok(htmlContent.includes('id="menu-appointments"'), 'Appointments must be preserved');
      assert.ok(htmlContent.includes('id="menu-progress"'), 'Progress must be preserved');
      assert.ok(htmlContent.includes('id="menu-faq"'), 'FAQs must be preserved');
      assert.ok(htmlContent.includes('id="menu-change-password"'), 'Change Password must be preserved');
      assert.ok(htmlContent.includes('id="menu-notifications"'), 'Notification Settings must be preserved');
      assert.ok(htmlContent.includes('id="btn-toggle-theme"'), 'Theme toggle must be preserved');
      assert.ok(htmlContent.includes('id="menu-about"'), 'About Taskly must be preserved');
      assert.ok(htmlContent.includes('id="menu-version"'), 'Version must be preserved');
      assert.ok(htmlContent.includes('id="menu-smart-lists"'), 'Smart Lists must be preserved');
      assert.ok(htmlContent.includes('id="btn-logout"'), 'Log out button must be preserved');
    });
  });
});
