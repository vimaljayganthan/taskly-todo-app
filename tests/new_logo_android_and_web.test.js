const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');

describe('Taskly New Logo Update Across Android and Web Suite', () => {
  test('public/logo.png exists and is non-empty', () => {
    const logoPath = path.join(ROOT_DIR, 'public', 'logo.png');
    assert.ok(fs.existsSync(logoPath), 'Expected public/logo.png to exist');
    const stats = fs.statSync(logoPath);
    assert.ok(stats.size > 10000, `Expected logo to be substantial image file, got ${stats.size} bytes`);
  });

  test('public/index.html uses /logo.png in Desktop Header, Welcome Screen, and About Modal', () => {
    // Desktop brand header
    assert.match(INDEX_HTML, /<img\s+src="\/logo\.png"\s+alt="Taskly"\s+class="desktop-logo"/,
      'Desktop header must use /logo.png');

    // Welcome Screen
    assert.match(INDEX_HTML, /<img\s+src="\/logo\.png"\s+alt="Taskly"\s+class="welcome-logo-img"/,
      'Welcome screen must use /logo.png');

    // About Taskly modal
    assert.match(INDEX_HTML, /<img\s+src="\/logo\.png"\s+alt="Taskly Logo"\s+width="48"\s+height="48"\s+class="about-brand-icon"/,
      'About Taskly modal must use /logo.png');
  });

  test('public/auth/confirmed.html references /logo.png', () => {
    const confirmedHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'auth', 'confirmed.html'), 'utf8');
    assert.ok(confirmedHtml.includes('src="/logo.png"'), 'Auth confirmed template must reference /logo.png');
  });

  test('PWA manifest icons and favicons exist and are updated', () => {
    const icon512 = path.join(ROOT_DIR, 'public', 'icon-512.png');
    const icon192 = path.join(ROOT_DIR, 'public', 'icon-192.png');
    const favPng = path.join(ROOT_DIR, 'public', 'favicon.png');
    const favIco = path.join(ROOT_DIR, 'public', 'favicon.ico');

    assert.ok(fs.existsSync(icon512), 'Expected icon-512.png to exist');
    assert.ok(fs.existsSync(icon192), 'Expected icon-192.png to exist');
    assert.ok(fs.existsSync(favPng), 'Expected favicon.png to exist');
    assert.ok(fs.existsSync(favIco), 'Expected favicon.ico to exist');
  });

  test('Android launcher icons exist across all 5 standard mipmap densities', () => {
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
    for (const d of densities) {
      const launcher = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher.png');
      const launcherRound = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher_round.png');
      const launcherFg = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher_foreground.png');

      assert.ok(fs.existsSync(launcher), `Expected ic_launcher.png for ${d}`);
      assert.ok(fs.existsSync(launcherRound), `Expected ic_launcher_round.png for ${d}`);
      assert.ok(fs.existsSync(launcherFg), `Expected ic_launcher_foreground.png for ${d}`);
    }
  });

  test('Android adaptive background matches logo cream color (#FCEFDF)', () => {
    const bgValues = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml');
    const bgDrawable = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_background.xml');

    const valuesContent = fs.readFileSync(bgValues, 'utf8');
    const drawableContent = fs.readFileSync(bgDrawable, 'utf8');

    assert.ok(valuesContent.includes('#FCEFDF'), 'Expected #FCEFDF in ic_launcher_background.xml values');
    assert.ok(drawableContent.includes('#FCEFDF'), 'Expected #FCEFDF in ic_launcher_background.xml drawable');
  });

  test('Android native notification drawables for logo exist across densities', () => {
    const densities = ['drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi', 'drawable'];
    for (const d of densities) {
      const logoDrawable = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', d, 'logo.png');
      assert.ok(fs.existsSync(logoDrawable), `Expected logo.png in ${d}`);
      assert.ok(fs.statSync(logoDrawable).size > 1000, `Expected non-empty logo drawable in ${d}`);
    }
  });
});

