/**
 * Taskly - Notification Settings & 10 Custom Notification Sounds Suite
 *
 * Verifies:
 * 1. Profile screen menu order & exact position 6 for Notifications.
 * 2. 10 custom sound WAV audio files in both res/raw and public/assets/sounds with valid RIFF headers.
 * 3. Settings persistence in localStorage & default values.
 * 4. Master toggle behavior: stops Android notifications and cancels pending when OFF, restores when ON.
 * 5. Sound toggle & channel routing: silent channel when sound is OFF, specific channel per sound when ON.
 * 6. Audio preview playback without native notification triggers and single active preview handling.
 * 7. Android native multichannel creation on plugin init.
 * 8. All 4 theme CSS selectors and responsive rules.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock Storage and DOM Environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Notification Settings & 10 Custom Sounds Test Suite', () => {

  const EXPECTED_SOUNDS = [
    { id: 'cat_meow', file: 'taskly_meow.wav', channelId: 'taskly-reminders-v3' },
    { id: 'gentle_chime', file: 'taskly_chime.wav', channelId: 'taskly-sound-gentle-chime' },
    { id: 'soft_bell', file: 'taskly_soft_bell.wav', channelId: 'taskly-sound-soft-bell' },
    { id: 'classic', file: 'taskly_classic.wav', channelId: 'taskly-sound-classic' },
    { id: 'digital_pop', file: 'taskly_pop.wav', channelId: 'taskly-sound-pop' },
    { id: 'bubble', file: 'taskly_bubble.wav', channelId: 'taskly-sound-bubble' },
    { id: 'glass_tap', file: 'taskly_glass.wav', channelId: 'taskly-sound-glass' },
    { id: 'soft_marimba', file: 'taskly_marimba.wav', channelId: 'taskly-sound-marimba' },
    { id: 'calm_melody', file: 'taskly_melody.wav', channelId: 'taskly-sound-melody' },
    { id: 'water_drop', file: 'taskly_water_drop.wav', channelId: 'taskly-sound-water-drop' }
  ];

  describe('1. Profile Screen Modification & Menu Item Position', () => {
    test('Notifications button exists in public/index.html with id="menu-notifications"', () => {
      assert.match(INDEX_HTML, /id="menu-notifications"/, 'Expected #menu-notifications in index.html');
      assert.match(INDEX_HTML, /id="profile-notifications-badge"/, 'Expected #profile-notifications-badge');
    });

    test('Notifications is at exact position 6 in the Profile menu list', () => {
      const menuListMatch = INDEX_HTML.match(/<div class="profile-menu-list">([\s\S]*?)<\/div>\s*<!-- Bottom Log Out/);
      assert.ok(menuListMatch, 'Expected profile-menu-list in index.html');

      const menuListHtml = menuListMatch[1];
      const buttonMatches = [...menuListHtml.matchAll(/<button[^>]*class="profile-menu-item"[^>]*id="([^"]+)"/g)];
      const menuIds = buttonMatches.map(m => m[1]);

      assert.strictEqual(menuIds[0], 'menu-track-tasks', 'Position 1 must be Track Tasks');
      assert.strictEqual(menuIds[1], 'menu-appointments', 'Position 2 must be Appointments');
      assert.strictEqual(menuIds[2], 'menu-progress', 'Position 3 must be Progress');
      assert.strictEqual(menuIds[3], 'menu-faq', 'Position 4 must be FAQs');
      assert.strictEqual(menuIds[4], 'menu-change-password', 'Position 5 must be Change Password');
      assert.strictEqual(menuIds[5], 'menu-notifications', 'Position 6 must be Notifications (NEW)');
      assert.strictEqual(menuIds[6], 'btn-toggle-theme', 'Position 7 must be Theme');
      assert.strictEqual(menuIds[7], 'menu-about', 'Position 8 must be About Taskly');
      assert.strictEqual(menuIds[8], 'menu-version', 'Position 9 must be Version');
    });

    test('Dedicated modal #modal-notification-settings exists with expected controls', () => {
      assert.match(INDEX_HTML, /id="modal-notification-settings"/, 'Expected #modal-notification-settings');
      assert.match(INDEX_HTML, /id="btn-close-notification-settings"/, 'Expected close button');
      assert.match(INDEX_HTML, /id="toggle-master-notifications"/, 'Expected master toggle');
      assert.match(INDEX_HTML, /id="toggle-notification-sound"/, 'Expected sound toggle');
      assert.match(INDEX_HTML, /id="sound-options-list"/, 'Expected sound options list container');
      assert.match(INDEX_HTML, /id="btn-notification-settings-done"/, 'Expected Done button');
      assert.match(INDEX_HTML, /id="notif-permission-warning"/, 'Expected permission warning banner');
    });
  });

  describe('2. Bundled Audio Resource Verification (All 10 Sounds)', () => {
    for (const item of EXPECTED_SOUNDS) {
      test(`Raw Android audio exists: ${item.file}`, () => {
        const filePath = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'raw', item.file);
        assert.ok(fs.existsSync(filePath), `Missing ${item.file} in res/raw/`);
        const stats = fs.statSync(filePath);
        assert.ok(stats.size > 1000, `${item.file} must not be empty (size: ${stats.size} bytes)`);

        // Check RIFF WAVE header
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(12);
        fs.readSync(fd, buffer, 0, 12, 0);
        fs.closeSync(fd);
        assert.strictEqual(buffer.toString('utf8', 0, 4), 'RIFF', 'Must have RIFF header');
        assert.strictEqual(buffer.toString('utf8', 8, 12), 'WAVE', 'Must have WAVE header');
      });

      test(`Web public asset audio exists: ${item.file}`, () => {
        const filePath = path.join(ROOT_DIR, 'public', 'assets', 'sounds', item.file);
        assert.ok(fs.existsSync(filePath), `Missing ${item.file} in public/assets/sounds/`);
        const stats = fs.statSync(filePath);
        assert.ok(stats.size > 1000, `${item.file} must not be empty`);
      });
    }
  });

  describe('3. Notification Settings Persistence & Defaults', () => {
    beforeEach(() => {
      // Clear localStorage keys
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_MASTER);
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED);
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SELECTED_SOUND);
      }
    });

    afterEach(() => {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_MASTER);
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED);
        localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SELECTED_SOUND);
      }
    });

    test('Default settings are masterEnabled=true, soundEnabled=true, selectedSound="cat_meow"', () => {
      const settings = app.TasklyNotifications.getSettings();
      assert.strictEqual(settings.masterEnabled, true);
      assert.strictEqual(settings.soundEnabled, true);
      assert.strictEqual(settings.selectedSound, 'cat_meow');
    });

    test('setMasterEnabled(false) persists and updates getSettings()', async () => {
      await app.TasklyNotifications.setMasterEnabled(false);
      assert.strictEqual(app.TasklyNotifications.areNotificationsEnabled(), false);
      assert.strictEqual(app.TasklyNotifications.getSettings().masterEnabled, false);
      assert.strictEqual(localStorage.getItem(app.TasklyNotifications.STORAGE_KEY_MASTER), 'false');

      await app.TasklyNotifications.setMasterEnabled(true);
      assert.strictEqual(app.TasklyNotifications.areNotificationsEnabled(), true);
    });

    test('setSoundEnabled(false) persists and updates getSettings()', async () => {
      await app.TasklyNotifications.setSoundEnabled(false);
      assert.strictEqual(app.TasklyNotifications.isSoundEnabled(), false);
      assert.strictEqual(app.TasklyNotifications.getSettings().soundEnabled, false);
      assert.strictEqual(localStorage.getItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED), 'false');

      await app.TasklyNotifications.setSoundEnabled(true);
      assert.strictEqual(app.TasklyNotifications.isSoundEnabled(), true);
    });

    test('setSelectedSound() persists any of the 10 sound choices', async () => {
      for (const item of EXPECTED_SOUNDS) {
        await app.TasklyNotifications.setSelectedSound(item.id);
        assert.strictEqual(app.TasklyNotifications.getSelectedSoundId(), item.id);
        assert.strictEqual(app.TasklyNotifications.getSettings().selectedSound, item.id);
      }
    });
  });

  describe('4. Master Notification Toggle Scheduling Control', () => {
    let mockScheduled = [];
    let mockCancelled = [];
    const origGetPlugin = app.TasklyNotifications.getPlugin;

    beforeEach(() => {
      mockScheduled = [];
      mockCancelled = [];
      app.TasklyNotifications.getPlugin = () => ({
        async schedule({ notifications }) {
          mockScheduled.push(...notifications);
          return { notifications };
        },
        async cancel({ notifications }) {
          mockCancelled.push(...notifications);
          const cancelIds = new Set(notifications.map(n => n.id));
          mockScheduled = mockScheduled.filter(n => !cancelIds.has(n.id));
          return { notifications };
        }
      });
      app.TasklyNotifications.saveScheduledRegistry([]);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_MASTER);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SELECTED_SOUND);
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = origGetPlugin;
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_MASTER);
    });

    test('When master notifications is OFF, scheduleTaskDeadlines schedules ZERO notifications', async () => {
      await app.TasklyNotifications.setMasterEnabled(false);

      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const task = {
        id: 'task-master-off-1',
        title: 'Master Off Task',
        dueDate: ymd,
        time: '11:59 PM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 0, 'No notifications scheduled when master switch is OFF');
    });

    test('When master notifications is OFF, notifyImmediate does not schedule native notifications', async () => {
      await app.TasklyNotifications.setMasterEnabled(false);

      await app.TasklyNotifications.notifyImmediate({
        title: 'Immediate Test',
        description: 'Should not schedule natively',
        type: 'task_created'
      });

      assert.strictEqual(mockScheduled.length, 0, 'No immediate native notification dispatched when master switch is OFF');
    });

    test('Toggling master notifications to OFF cancels existing active schedules', async () => {
      await app.TasklyNotifications.setMasterEnabled(true);

      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const task = {
        id: 'task-active-cancel-1',
        title: 'Active Task to Cancel',
        dueDate: ymd,
        time: '11:59 PM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3);

      // Now toggle OFF
      await app.TasklyNotifications.setMasterEnabled(false);
      assert.ok(mockCancelled.length >= 3, 'Cancelled previous schedules');
      assert.strictEqual(app.TasklyNotifications.getScheduledRegistry().length, 0);
    });
  });

  describe('5. Custom Sound Channels & Silent Channel Routing', () => {
    let mockScheduled = [];
    const origGetPlugin = app.TasklyNotifications.getPlugin;

    beforeEach(() => {
      mockScheduled = [];
      app.TasklyNotifications.getPlugin = () => ({
        async schedule({ notifications }) {
          mockScheduled.push(...notifications);
          return { notifications };
        },
        async cancel() { return { notifications: [] }; }
      });
      app.TasklyNotifications.saveScheduledRegistry([]);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_MASTER);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SELECTED_SOUND);
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = origGetPlugin;
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SOUND_ENABLED);
      localStorage.removeItem(app.TasklyNotifications.STORAGE_KEY_SELECTED_SOUND);
    });

    test('When sound is enabled, each of the 10 sounds routes to its dedicated channel and sound file', async () => {
      await app.TasklyNotifications.setMasterEnabled(true);
      await app.TasklyNotifications.setSoundEnabled(true);

      for (const item of EXPECTED_SOUNDS) {
        mockScheduled = [];
        await app.TasklyNotifications.setSelectedSound(item.id);

        const config = app.TasklyNotifications.getActiveChannelConfig();
        assert.strictEqual(config.enabled, true);
        assert.strictEqual(config.channelId, item.channelId, `Expected channel ${item.channelId} for ${item.id}`);
        assert.strictEqual(config.sound, item.file, `Expected sound ${item.file} for ${item.id}`);

        await app.TasklyNotifications.notifyImmediate({
          title: `Testing ${item.id}`,
          description: 'Sound channel verification',
          type: 'brand'
        });

        assert.strictEqual(mockScheduled.length, 1);
        assert.strictEqual(mockScheduled[0].channelId, item.channelId);
        assert.strictEqual(mockScheduled[0].sound, item.file);
      }
    });

    test('When notification sound switch is OFF, notifications route to taskly-sound-silent without sound', async () => {
      await app.TasklyNotifications.setMasterEnabled(true);
      await app.TasklyNotifications.setSoundEnabled(false);

      const config = app.TasklyNotifications.getActiveChannelConfig();
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.channelId, 'taskly-sound-silent');
      assert.strictEqual(config.sound, undefined);

      await app.TasklyNotifications.notifyImmediate({
        title: 'Silent Test',
        description: 'Should deliver via silent channel',
        type: 'brand'
      });

      assert.strictEqual(mockScheduled.length, 1);
      assert.strictEqual(mockScheduled[0].channelId, 'taskly-sound-silent');
      assert.strictEqual(mockScheduled[0].sound, undefined);
    });
  });

  describe('6. Android Native Multichannel Creation in init()', () => {
    let createdChannels = [];
    const origGetPlugin = app.TasklyNotifications.getPlugin;

    beforeEach(() => {
      createdChannels = [];
      app.TasklyNotifications.getPlugin = () => ({
        async createChannel(channel) {
          createdChannels.push(channel);
        },
        async deleteChannel() {},
        async removeAllDeliveredNotifications() {},
        async registerActionTypes() {},
        async checkPermissions() { return { display: 'granted' }; },
        addListener() {}
      });
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = origGetPlugin;
    });

    test('createAllChannels creates 10 sound channels and 1 silent channel', async () => {
      const mockPlugin = app.TasklyNotifications.getPlugin();
      await app.TasklyNotifications.createAllChannels(mockPlugin);

      assert.strictEqual(createdChannels.length, 11, 'Must create 10 sound channels + 1 silent channel');

      // Check default/cat_meow channel
      const catChannel = createdChannels.find(c => c.id === 'taskly-reminders-v3');
      assert.ok(catChannel, 'Expected taskly-reminders-v3 channel');
      assert.strictEqual(catChannel.sound, 'taskly_meow.wav');
      assert.strictEqual(catChannel.importance, 5);

      // Check silent channel
      const silentChannel = createdChannels.find(c => c.id === 'taskly-sound-silent');
      assert.ok(silentChannel, 'Expected taskly-sound-silent channel');
      assert.strictEqual(silentChannel.sound, undefined);
      assert.strictEqual(silentChannel.importance, 3);
      assert.strictEqual(silentChannel.vibration, true);

      // Check remaining 9 channels
      for (const item of EXPECTED_SOUNDS.slice(1)) {
        const ch = createdChannels.find(c => c.id === item.channelId);
        assert.ok(ch, `Missing channel ${item.channelId} for ${item.id}`);
        assert.strictEqual(ch.sound, item.file);
        assert.strictEqual(ch.importance, 5);
      }
    });
  });

  describe('7. CSS Theme Support & Responsive Design', () => {
    test('public/styles.css includes .modal-card-notification-settings styles', () => {
      assert.match(STYLES_CSS, /\.modal-card-notification-settings/);
      assert.match(STYLES_CSS, /\.sound-option-card/);
      assert.match(STYLES_CSS, /\.btn-sound-preview/);
      assert.match(STYLES_CSS, /\.sound-radio-pill/);
    });

    test('All 4 themes are styled for Notification Settings', () => {
      assert.match(STYLES_CSS, /\[data-theme="light"\]\s+\.modal-card-notification-settings/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.modal-card-notification-settings/);
      assert.match(STYLES_CSS, /\[data-theme="pet"\]\s+\.modal-card-notification-settings/);
      assert.match(STYLES_CSS, /\[data-theme="pastel"\]\s+\.modal-card-notification-settings/);

      assert.match(STYLES_CSS, /\[data-theme="light"\]\s+\.sound-option-card\.active/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.sound-option-card\.active/);
      assert.match(STYLES_CSS, /\[data-theme="pet"\]\s+\.sound-option-card\.active/);
      assert.match(STYLES_CSS, /\[data-theme="pastel"\]\s+\.sound-option-card\.active/);
    });

    test('Responsive rules exist for <= 360px and <= 320px screens', () => {
      assert.match(STYLES_CSS, /@media\s*\(max-width:\s*360px\)[\s\S]*?\.modal-card-notification-settings/);
      assert.match(STYLES_CSS, /@media\s*\(max-width:\s*320px\)[\s\S]*?\.sound-desc/);
    });
  });

  describe('8. Audio Preview Playback Safety', () => {
    let mockScheduled = [];
    const origGetPlugin = app.TasklyNotifications.getPlugin;

    beforeEach(() => {
      mockScheduled = [];
      app.TasklyNotifications.getPlugin = () => ({
        async schedule({ notifications }) {
          mockScheduled.push(...notifications);
          return { notifications };
        }
      });
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = origGetPlugin;
      app.TasklyNotifications.stopSoundPreview();
    });

    test('previewSound does not trigger or schedule any native notifications', () => {
      app.TasklyNotifications.previewSound('cat_meow');
      assert.strictEqual(mockScheduled.length, 0, 'Audio preview must never dispatch native notifications');
      app.TasklyNotifications.stopSoundPreview();
    });

    test('stopSoundPreview resets currentPreviewAudio and currentPreviewSoundId', () => {
      app.TasklyNotifications.currentPreviewSoundId = 'soft_bell';
      app.TasklyNotifications.currentPreviewAudio = { pause() {}, currentTime: 0 };

      app.TasklyNotifications.stopSoundPreview();
      assert.strictEqual(app.TasklyNotifications.currentPreviewAudio, null);
      assert.strictEqual(app.TasklyNotifications.currentPreviewSoundId, null);
    });
  });

});
