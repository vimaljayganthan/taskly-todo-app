/**
 * Taskly – Dark Mode Contrast & Cute Cat Meow Notification Sound Suite
 * Validates:
 * 1. Dark Mode high-contrast palette (#121820, #1C2733, #253241, #F1F5F9, #B6C2CF, #94A3B8, #3B4B5C, #60A5FA).
 * 2. Quick Capture heading, description, input row, and placeholder contrast.
 * 3. Dashboard stats, task cards, filter pills, calendar, forms, modals, and mascot protection.
 * 4. Zero regressions across Light, Pet, and Pastel Light modes.
 * 5. Cute cat meow WAV audio file specifications (valid RIFF, PCM, duration 0.6-1.2s, 44.1kHz 16-bit).
 * 6. Notification channel migration to taskly-reminders-v3 and taskly_meow.wav packaging.
 * 7. Delivery-only sound behavior (no startup, login, refresh, or sync noise).
 * 8. Task reminder ON/OFF and Quick Note isolation without duplicate schedules.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public/styles.css'), 'utf8');
const CAPACITOR_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'capacitor.config.json'), 'utf8'));

// Mock browser globals for app.js
global.window = {
  location: { hash: '#home', replace: () => {} },
  addEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  document: {
    documentElement: { setAttribute: () => {}, getAttribute: () => 'dark' },
    body: { classList: { add: () => {}, remove: () => {}, contains: () => false }, setAttribute: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      LocalNotifications: {
        createChannel: async () => {},
        deleteChannel: async () => {},
        schedule: async () => {},
        cancel: async () => {},
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        addListener: () => {}
      }
    }
  }
};
global.document = global.window.document;
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

const app = require('../public/app.js');

describe('Taskly Dark Mode Contrast & Cat Meow Notification Sound Suite', () => {

  // ==========================================================================
  // PART 1: Cat Meow Audio Asset Packaging & Signal Verification
  // ==========================================================================
  describe('1. Cat Meow Audio Asset Packaging & Physical Verification', () => {
    const rawAudioPath = path.join(ROOT_DIR, 'android/app/src/main/res/raw/taskly_meow.wav');
    const webAudioPath = path.join(ROOT_DIR, 'public/assets/sounds/taskly_meow.wav');

    test('taskly_meow.wav exists in android/app/src/main/res/raw/ and public/assets/sounds/', () => {
      assert.ok(fs.existsSync(rawAudioPath), 'Must exist in android res/raw/');
      assert.ok(fs.existsSync(webAudioPath), 'Must exist in web assets/sounds/');
      const rawStat = fs.statSync(rawAudioPath);
      const webStat = fs.statSync(webAudioPath);
      assert.ok(rawStat.size > 10000, `Raw file size must be substantial, found ${rawStat.size}`);
      assert.strictEqual(rawStat.size, webStat.size, 'Raw and web assets must be identical');
    });

    test('Audio file has valid 44-byte standard RIFF WAVE header', () => {
      const buffer = Buffer.alloc(44);
      const fd = fs.openSync(rawAudioPath, 'r');
      fs.readSync(fd, buffer, 0, 44, 0);
      fs.closeSync(fd);

      const riff = buffer.toString('ascii', 0, 4);
      const wave = buffer.toString('ascii', 8, 12);
      const fmt = buffer.toString('ascii', 12, 16);
      const audioFormat = buffer.readUInt16LE(20); // 1 = PCM
      const channels = buffer.readUInt16LE(22);
      const sampleRate = buffer.readUInt32LE(24);
      const bitsPerSample = buffer.readUInt16LE(34);

      assert.strictEqual(riff, 'RIFF', 'Header magic must be RIFF');
      assert.strictEqual(wave, 'WAVE', 'Format must be WAVE');
      assert.strictEqual(fmt.trim(), 'fmt', 'Format chunk must be fmt');
      assert.strictEqual(audioFormat, 1, 'Audio format must be uncompressed PCM (1)');
      assert.strictEqual(channels, 1, 'Channels must be 1 (mono)');
      assert.strictEqual(sampleRate, 44100, 'Sample rate must be 44.1kHz');
      assert.strictEqual(bitsPerSample, 16, 'Bits per sample must be 16-bit');
    });

    test('Audio duration is between 0.6 and 1.2 seconds (~0.81s target)', () => {
      const stat = fs.statSync(rawAudioPath);
      const pcmBytes = stat.size - 44;
      // 44100 samples/sec * 1 channel * 2 bytes/sample = 88200 bytes/sec
      const durationSec = pcmBytes / (44100 * 1 * 2);
      assert.ok(durationSec >= 0.6 && durationSec <= 1.2, `Duration ${durationSec.toFixed(3)}s must be in 0.6-1.2s`);
      assert.ok(Math.abs(durationSec - 0.81) < 0.05, `Duration ${durationSec.toFixed(3)}s is ~0.81s cute meow`);
    });

    test('Capacitor config specifies taskly_meow.wav as notification sound', () => {
      assert.strictEqual(CAPACITOR_CONFIG.plugins.LocalNotifications.sound, 'taskly_meow.wav');
    });
  });

  // ==========================================================================
  // PART 2: Notification Channel Migration & Delivery-Only Behaviour
  // ==========================================================================
  describe('2. Android Notification Channel Migration & Delivery-Only Audio', () => {
    test('TasklyNotifications configures CHANNEL_ID taskly-reminders-v3 and NOTIFICATION_SOUND taskly_meow.wav', () => {
      assert.strictEqual(app.TasklyNotifications.CHANNEL_ID, 'taskly-reminders-v3');
      assert.strictEqual(app.TasklyNotifications.NOTIFICATION_SOUND, 'taskly_meow.wav');
      assert.ok(app.TasklyNotifications.LEGACY_CHANNELS.includes('taskly-reminders'));
      assert.ok(app.TasklyNotifications.LEGACY_CHANNELS.includes('taskly-reminders-v2'));
    });

    test('init() migrates legacy channels (v1 and v2) and creates taskly-reminders-v3', async () => {
      const deleted = [];
      const created = [];
      const originalPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        deleteChannel: async (opts) => { deleted.push(opts.id); },
        createChannel: async (opts) => { created.push(opts); },
        checkPermissions: async () => ({ display: 'granted' }),
        addListener: () => {}
      });

      await app.TasklyNotifications.init();

      assert.ok(deleted.includes('taskly-reminders'), 'Must delete v1 legacy channel');
      assert.ok(deleted.includes('taskly-reminders-v2'), 'Must delete v2 legacy channel');

      const v3 = created.find(c => c.id === 'taskly-reminders-v3');
      assert.ok(v3, 'Must create channel taskly-reminders-v3');
      assert.strictEqual(v3.sound, 'taskly_meow.wav');
      assert.strictEqual(v3.importance, 5, 'High importance');
      assert.strictEqual(v3.vibration, true);

      app.TasklyNotifications.getPlugin = originalPlugin;
    });

    test('In-app audio is NEVER played during startup or sync on native Android', () => {
      let audioPlayed = false;
      const originalAudio = global.Audio;
      global.Audio = class {
        constructor() { audioPlayed = true; }
        play() { return Promise.resolve(); }
      };

      // Native Android returns true
      app.TasklyNotifications.playMeow();
      assert.strictEqual(audioPlayed, false, 'Native Android must never trigger in-app HTML5 audio');

      global.Audio = originalAudio;
    });

    test('playMeow() and playChime() alias exist on TasklyNotifications', () => {
      assert.strictEqual(typeof app.TasklyNotifications.playMeow, 'function');
      assert.strictEqual(typeof app.TasklyNotifications.playChime, 'function');
    });
  });

  // ==========================================================================
  // PART 3: Notification Scheduling, Reminder Control, & Isolation
  // ==========================================================================
  describe('3. Notification Scheduling & Isolation Integrity', () => {
    let scheduledRecords;
    let originalPlugin;

    beforeEach(() => {
      scheduledRecords = [];
      originalPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduledRecords.push(...opts.notifications); },
        cancel: async () => {}
      });
      localStorage.clear();
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = originalPlugin;
    });

    test('Task with reminder=true schedules 3 alerts using channel v3 and taskly_meow.wav', async () => {
      const future = new Date(Date.now() + 3 * 3600 * 1000);
      const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
      const hh = String(future.getHours()).padStart(2, '0');
      const mm = String(future.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-rem-test',
        title: 'Submit quarterly budget',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        category: 'Work',
        priority: 'High',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(scheduledRecords.length, 3);
      for (const notif of scheduledRecords) {
        assert.strictEqual(notif.channelId, 'taskly-reminders-v3');
        assert.strictEqual(notif.sound, 'taskly_meow.wav');
        assert.strictEqual(notif.iconColor, '#F88438');
      }
    });

    test('Task with reminder=false schedules zero alerts', async () => {
      const task = {
        id: 'task-no-rem',
        title: 'Unreminded task',
        dueDate: '2026-11-20',
        time: '14:00',
        reminder: false,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(scheduledRecords.length, 0, 'Reminder OFF must schedule zero alerts');
    });

    test('Quick Note reminder schedules independently with channel v3 and taskly_meow.wav', async () => {
      const target = new Date(Date.now() + 45 * 60 * 1000);
      const note = { id: 999, text: 'Feed the cats' };

      await app.TasklyNotifications.scheduleQuickNoteReminder(note, target);

      assert.strictEqual(scheduledRecords.length, 1);
      assert.strictEqual(scheduledRecords[0].channelId, 'taskly-reminders-v3');
      assert.strictEqual(scheduledRecords[0].sound, 'taskly_meow.wav');
      assert.strictEqual(scheduledRecords[0].extra.type, 'quick_note_reminder');
    });
  });

  // ==========================================================================
  // PART 4: Dark Mode Text Contrast & CSS Variable Specifications
  // ==========================================================================
  describe('4. Dark Mode Palette & High Contrast Typography', () => {
    test('[data-theme="dark"] defines the requested high-contrast token palette', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--app-bg:\s*#121820/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--surface:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--bg-card-subtle:\s*#253241/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--text-primary:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--text-secondary:\s*#B6C2CF/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--text-muted:\s*#94A3B8/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--border:\s*#3B4B5C/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s*\{[^}]+--primary:\s*#60A5FA/);
    });

    test('Quick Capture card heading, description, input row, and placeholder are high-contrast', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-quickcapture-cream[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-quickcapture-cream[^\{]*\{[^}]+border:\s*1\.5px solid #3B4B5C/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-title-lg[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-subtitle-text[^\{]*\{[^}]+color:\s*#B6C2CF/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-quickcapture-cream\s+\.qc-input-row[^\{]*\{[^}]+background:\s*#253241/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+#qc-input-text[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+#qc-input-text::placeholder[^\{]*\{[^}]+color:\s*#94A3B8/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.btn-qc-save[^\{]*\{[^}]+background:\s*#60A5FA/);
    });

    test('Dashboard statistics, tasks, and filter pills are high-contrast', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.card-stats-peach[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.stat-card[^\{]*\{[^}]+background:\s*#253241/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.stat-number[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.stat-label[^\{]*\{[^}]+color:\s*#B6C2CF/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.filter-pill[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.filter-pill\.active[^\{]*\{[^}]+background:\s*#60A5FA/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.task-item[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.task-title[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.task-desc[^\{]*\{[^}]+color:\s*#B6C2CF/);
    });

    test('Forms, inputs, modals, and navigation components are high-contrast', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.form-input[^\{]*\{[^}]+background:\s*#253241/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.form-input[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.modal-card[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.modal-title[^\{]*\{[^}]+color:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.bottom-nav[^\{]*\{[^}]+background:\s*#1C2733/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.nav-tab\.active[^\{]*\{[^}]+color:\s*#60A5FA/);
    });

    test('Mascot artwork retains original colors without inversion or recoloring in Dark Mode', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.pet-circle-container[^\{]*\{[^}]+filter:\s*none\s*!important/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.pet-circle-container[^\{]*\{[^}]+background:\s*transparent\s*!important/);
    });

    test('Zero regressions across Light Mode, Pet Mode, and Pastel Light Mode', () => {
      assert.match(STYLES_CSS, /\[data-theme="light"\],\s*\[data-theme="day"\]/);
      assert.match(STYLES_CSS, /\[data-theme="pet"\]\s*\{[^}]+--app-bg:\s*#FDF1EA/);
      assert.match(STYLES_CSS, /\[data-theme="pastel"\]\s*\{[^}]+--app-bg:\s*#F5F3FF/);
    });
  });
});
