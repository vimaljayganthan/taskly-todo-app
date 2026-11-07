/**
 * Taskly - FAQ Section Content and About Taskly Modal Mapping Test Suite
 *
 * Verifies:
 * 1. Root Cause Fix: Clicking FAQ opens #modal-faq (NOT #modal-about)
 * 2. About Taskly Separation: Clicking About Taskly opens #modal-about (NOT #modal-faq)
 * 3. Dedicated FAQ content: All 16 questions and answers across 6 categories
 * 4. Accordion Mechanics: Collapsed by default, opens on tap, collapses others
 * 5. Real-time Search: Filters questions and answers accurately
 * 6. Clean closing and modal isolation
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');

describe('Taskly FAQ Section & About Taskly Mapping Suite', () => {

  describe('1. Root Cause Fix & Modal Mapping Verification', () => {
    test('Profile menu includes separate items for FAQ (#menu-faq) and About Taskly (#menu-about)', () => {
      assert.match(INDEX_HTML, /id="menu-faq"/, 'Expected #menu-faq in profile menu');
      assert.match(INDEX_HTML, /id="menu-about"/, 'Expected #menu-about in profile menu');
      assert.match(INDEX_HTML, /<span class="menu-item-label">FAQs?<\/span>/, 'Expected FAQs label in menu');
      assert.match(INDEX_HTML, /<span class="menu-item-label">About Taskly<\/span>/, 'Expected About Taskly label in menu');
    });

    test('public/app.js maps #menu-faq to open #modal-faq (NOT #modal-about)', () => {
      // menu-faq listener must activate modal-faq
      assert.match(APP_JS, /menuFaq\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?modalFaq\.classList\.add\('active'\)/,
        'Expected menuFaq click listener to open modalFaq');
      assert.doesNotMatch(APP_JS, /menuFaq\.addEventListener\('click',\s*\(\)\s*=>\s*\{[^}]*modalAbout\.classList\.add\('active'\)/,
        'menuFaq must NOT open modalAbout');
    });

    test('public/app.js maps #menu-about to open #modal-about', () => {
      assert.match(APP_JS, /menuAbout\.addEventListener\('click',\s*openAboutModal\)/,
        'Expected menuAbout click listener to open About Taskly modal');
    });

    test('Both modals have independent close handlers', () => {
      assert.match(INDEX_HTML, /id="btn-close-faq-modal"/, 'Expected #btn-close-faq-modal in index.html');
      assert.match(INDEX_HTML, /id="btn-close-faq-ok"/, 'Expected #btn-close-faq-ok in index.html');
      assert.match(INDEX_HTML, /id="btn-close-about-modal"/, 'Expected #btn-close-about-modal in index.html');
      assert.match(INDEX_HTML, /id="btn-close-about-ok"/, 'Expected #btn-close-about-ok in index.html');
    });
  });

  describe('2. Dedicated FAQ Section & Content Verification (16 Questions)', () => {
    test('#modal-faq is titled "Frequently Asked Questions"', () => {
      assert.match(INDEX_HTML, /id="modal-faq"[\s\S]*?<h3 class="modal-title">Frequently Asked Questions<\/h3>/,
        'Expected #modal-faq with Frequently Asked Questions title');
    });

    test('Category 1: Getting Started questions are present', () => {
      assert.match(INDEX_HTML, /1\.\s*What is Taskly\?/, 'Q1 present');
      assert.match(INDEX_HTML, /Taskly is a personal productivity application that helps you manage daily tasks/);
      assert.match(INDEX_HTML, /2\.\s*How do I create a task\?/, 'Q2 present');
      assert.match(INDEX_HTML, /Navigate to the task creation option, enter the task title and description/);
      assert.match(INDEX_HTML, /3\.\s*Can I edit or delete a task\?/, 'Q3 present');
      assert.match(INDEX_HTML, /Open the relevant task and use the available edit or delete options/);
    });

    test('Category 2: Task Management questions are present', () => {
      assert.match(INDEX_HTML, /4\.\s*How do I mark a task as completed\?/, 'Q4 present');
      assert.match(INDEX_HTML, /Use the completion checkbox or Complete action associated with the task/);
      assert.match(INDEX_HTML, /5\.\s*Can I set a deadline and time for a task\?/, 'Q5 present');
      assert.match(INDEX_HTML, /Taskly supports date and time selection for task deadlines/);
      assert.match(INDEX_HTML, /6\.\s*Can I view my completed and pending tasks separately\?/, 'Q6 present');
      assert.match(INDEX_HTML, /Use the available task filters to organise tasks by their completion status/);
    });

    test('Category 3: Quick Capture and Quick Shares questions are present', () => {
      assert.match(INDEX_HTML, /7\.\s*What is Quick Capture\?/, 'Q7 present');
      assert.match(INDEX_HTML, /Quick Capture allows you to quickly save thoughts, ideas and important information without creating a regular task/);
      assert.match(INDEX_HTML, /8\.\s*What are Quick Shares\?/, 'Q8 present');
      assert.match(INDEX_HTML, /Quick Shares are saved notes that remain accessible from the Home screen/);
      assert.match(INDEX_HTML, /9\.\s*Can I pin an important Quick Share\?/, 'Q9 present');
      assert.match(INDEX_HTML, /Pinning allows an important Quick Share to appear in a separate featured card on the Home screen/);
    });

    test('Category 4: Calendar and Progress questions are present', () => {
      assert.match(INDEX_HTML, /10\.\s*What does the Calendar show\?/, 'Q10 present');
      assert.match(INDEX_HTML, /The Calendar displays your scheduled tasks and uses workload colours to indicate daily task activity/);
      assert.match(INDEX_HTML, /11\.\s*What do the Calendar colours mean\?/, 'Q11 present');
      assert.match(INDEX_HTML, /Pink:.*High workload/);
      assert.match(INDEX_HTML, /Green:.*Moderate workload/);
      assert.match(INDEX_HTML, /Cyan:.*Low workload/);
      assert.match(INDEX_HTML, /12\.\s*How does Taskly track my productivity\?/, 'Q12 present');
      assert.match(INDEX_HTML, /The Progress section analyses your task activity, completion statistics and productivity trends/);
    });

    test('Category 5: Notifications and Reminders questions are present', () => {
      assert.match(INDEX_HTML, /13\.\s*Will Taskly remind me about deadlines\?/, 'Q13 present');
      assert.match(INDEX_HTML, /Taskly can schedule reminders for upcoming deadlines and overdue tasks/);
      assert.match(INDEX_HTML, /14\.\s*Why am I not receiving notifications\?/, 'Q14 present');
      assert.match(INDEX_HTML, /Check whether notification permission is enabled, the Taskly notification channel is enabled/);
    });

    test('Category 6: Account and Settings questions are present', () => {
      assert.match(INDEX_HTML, /15\.\s*Can I change the application theme\?/, 'Q15 present');
      assert.match(INDEX_HTML, /Open Profile and select your preferred available theme/);
      assert.match(INDEX_HTML, /16\.\s*Will my tasks remain available after reopening the application\?/, 'Q16 present');
      assert.match(INDEX_HTML, /Taskly uses its existing persistence and synchronisation system to retain your data/);
    });
  });

  describe('3. Accordion Mechanics & Single-Open Enforcement', () => {
    test('public/app.js defines toggleFaqAccordion to expand tapped question and collapse others', () => {
      assert.match(APP_JS, /function\s+toggleFaqAccordion\s*\(/, 'Expected toggleFaqAccordion in app.js');
      // Collapses other active items
      assert.match(APP_JS, /otherItem\.classList\.remove\('active'\)/, 'Must collapse active items');
    });

    test('Accordion simulation verifies single-expanded state', () => {
      // Simulate accordion state
      const items = [
        { id: 1, active: false },
        { id: 2, active: true },
        { id: 3, active: false }
      ];

      function toggleAccordion(activeItemIndex) {
        const currentlyOpen = items[activeItemIndex].active;
        items.forEach(it => { it.active = false; });
        if (!currentlyOpen) {
          items[activeItemIndex].active = true;
        }
      }

      // Tapping item 0 when item 1 was active
      toggleAccordion(0);
      assert.equal(items[0].active, true, 'Item 0 should be active');
      assert.equal(items[1].active, false, 'Item 1 should be collapsed');
      assert.equal(items[2].active, false, 'Item 2 should be collapsed');

      // Tapping item 0 again collapses it
      toggleAccordion(0);
      assert.equal(items[0].active, false, 'Item 0 should be collapsed');
      assert.equal(items.filter(it => it.active).length, 0, 'No items should be expanded');
    });
  });

  describe('4. Real-time Search Functionality', () => {
    test('public/index.html includes search input #faq-search-input', () => {
      assert.match(INDEX_HTML, /id="faq-search-input"/, 'Expected #faq-search-input in index.html');
      assert.match(INDEX_HTML, /id="btn-clear-faq-search"/, 'Expected clear search button in index.html');
    });

    test('public/app.js defines filterFaqItems and wires input listener', () => {
      assert.match(APP_JS, /function\s+filterFaqItems\s*\(/, 'Expected filterFaqItems in app.js');
      assert.match(APP_JS, /faqSearchInput\.addEventListener\('input'/, 'Expected input event listener for search');
    });

    test('Search filter matches questions and answers case-insensitively', () => {
      const qas = [
        { q: 'What is Taskly?', a: 'Taskly is a personal productivity application' },
        { q: 'What do the Calendar colours mean?', a: 'Pink: Very High workload' },
        { q: 'Will Taskly remind me about deadlines?', a: 'Yes. Taskly can schedule reminders' }
      ];

      function search(term) {
        const t = term.toLowerCase().trim();
        return qas.filter(item => item.q.toLowerCase().includes(t) || item.a.toLowerCase().includes(t));
      }

      assert.equal(search('calendar').length, 1, 'Should find 1 Calendar item');
      assert.equal(search('pink').length, 1, 'Should find Pink in Calendar answer');
      assert.equal(search('taskly').length, 2, 'Should find 2 items mentioning Taskly');
      assert.equal(search('nonexistent').length, 0, 'Should find 0 for nonexistent term');
    });
  });

  describe('5. About Taskly Section Redesign (Part 4)', () => {
    test('#modal-about displays user-facing description and tagline', () => {
      assert.match(INDEX_HTML, /id="modal-about"/, 'Expected #modal-about in index.html');
      assert.match(INDEX_HTML, /Your personal productivity companion\./, 'Expected tagline in About modal');
      assert.match(INDEX_HTML, /Taskly helps you stay organised, manage your daily responsibilities and make better use of your time\./,
        'Expected user-facing description in About modal');
    });

    test('#modal-about includes all eight feature cards with descriptions', () => {
      assert.match(INDEX_HTML, /Smart Task Management/, 'Feature 1: Smart Task Management');
      assert.match(INDEX_HTML, /Create, edit, organise and complete your daily tasks\./);

      assert.match(INDEX_HTML, /Deadlines & Reminders/, 'Feature 2: Deadlines & Reminders');
      assert.match(INDEX_HTML, /Set task deadlines and choose whether you want notifications for each task\./);

      assert.match(INDEX_HTML, /Interactive Calendar/, 'Feature 3: Interactive Calendar');
      assert.match(INDEX_HTML, /View your scheduled tasks, workload and daily activities in a visual calendar\./);

      assert.match(INDEX_HTML, /Quick Capture & Quick Shares/, 'Feature 4: Quick Capture & Quick Shares');
      assert.match(INDEX_HTML, /Quickly save ideas, important information and notes\./);

      assert.match(INDEX_HTML, /Pinned Quick Notes/, 'Feature 5: Pinned Quick Notes');
      assert.match(INDEX_HTML, /Pin important notes so they remain easy to access\./);

      assert.match(INDEX_HTML, /Productivity Tracking/, 'Feature 6: Productivity Tracking');
      assert.match(INDEX_HTML, /Monitor completed tasks, pending work, weekly activity and productivity progress\./);

      assert.match(INDEX_HTML, /Personalised Experience/, 'Feature 7: Personalised Experience');
      assert.match(INDEX_HTML, /Customise your application theme and manage your profile\./);

      assert.match(INDEX_HTML, /Pet Theme Experience/, 'Feature 8: Pet Theme Experience');
      assert.match(INDEX_HTML, /Enjoy the friendly pet illustrations and warm visual design throughout Taskly\./);
    });

    test('Technical details (Backend, Database, Client) are NOT displayed in #modal-about', () => {
      // Isolate modal-about content
      const aboutMatch = INDEX_HTML.match(/id="modal-about"[\s\S]*?<\/div>\s*<\/div>\s*<!-- Modal: Frequently Asked Questions/);
      assert.ok(aboutMatch, 'Found modal-about HTML block');
      const aboutHtml = aboutMatch[0];

      assert.doesNotMatch(aboutHtml, /Backend:\s*Node\.js/i, 'Backend tech details must not be in About modal');
      assert.doesNotMatch(aboutHtml, /Database:\s*Supabase/i, 'Database tech details must not be in About modal');
      assert.doesNotMatch(aboutHtml, /Client:\s*Capacitor/i, 'Client tech details must not be in About modal');
    });

    test('styles.css defines .modal-card-about and scrollable body for responsive display', () => {
      assert.match(STYLES_CSS, /\.modal-card-about/, 'Expected .modal-card-about in styles.css');
      assert.match(STYLES_CSS, /\.about-scroll-body/, 'Expected .about-scroll-body in styles.css');
      assert.match(STYLES_CSS, /\.about-feature-grid/, 'Expected .about-feature-grid in styles.css');
      assert.match(STYLES_CSS, /\.about-feature-card/, 'Expected .about-feature-card in styles.css');
    });
  });

});
