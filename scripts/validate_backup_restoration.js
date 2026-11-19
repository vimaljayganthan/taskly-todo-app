const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_SRC = '/Users/vimaljayganthan/Documents/Taskly_Backups/Build_15.3';
const TEST_DIR = '/tmp/taskly_backup_test';

console.log('=== TASKLY RECOVERY VALIDATION ===');
console.log('Target temp directory:', TEST_DIR);

if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

// Step 1: Copy from backup
console.log('1. Copying project from backup to /tmp/taskly_backup_test...');
execSync(`rsync -a --exclude="Release_Archive" --exclude="BACKUP_INVENTORY.*" --exclude="RESTORE_GUIDE.md" "${BACKUP_SRC}/" "${TEST_DIR}/"`);
console.log('   ✓ Project files copied.');

const env = {
  ...process.env,
  JAVA_HOME: '/opt/homebrew/opt/openjdk@21',
  PATH: `/opt/homebrew/opt/openjdk@21/bin:${process.env.PATH || ''}`
};

// Step 2: npm ci
console.log('2. Running npm ci from restored package-lock.json...');
const npmCiOut = execSync('npm ci', { cwd: TEST_DIR, env, encoding: 'utf8' });
console.log('   ✓ npm ci completed cleanly.');

// Step 3: Syntax check
console.log('3. Running JavaScript syntax check on restored files...');
function checkSyntax(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'releases') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      checkSyntax(full);
    } else if (item.name.endsWith('.js')) {
      execSync(`node --check "${full}"`);
    }
  }
}
checkSyntax(TEST_DIR);
console.log('   ✓ JavaScript syntax verified 100% clean.');

// Step 4: Capacitor copy
console.log('4. Running Capacitor Android synchronization...');
execSync('npx cap copy android', { cwd: TEST_DIR, env, encoding: 'utf8' });
console.log('   ✓ Capacitor synchronization successful.');

// Step 5: Android Debug Build
console.log('5. Running Android debug build in restored project...');
const buildOut = execSync('cd android && ./gradlew assembleDebug', { cwd: TEST_DIR, env, encoding: 'utf8' });
console.log('   ✓ Android debug APK built successfully.');

const debugApk = path.join(TEST_DIR, 'android/app/build/outputs/apk/debug/app-debug.apk');
if (fs.existsSync(debugApk)) {
  const size = fs.statSync(debugApk).size;
  console.log(`   ✓ Verified debug APK exists (${(size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  throw new Error('Debug APK was not found at expected output path');
}

// Step 6: Automated tests
console.log('6. Running test suite in restored project...');
const testOut = execSync('node --test tests/version_preview_and_native_detection.test.js tests/device_adaptive_ui_compatibility.test.js tests/in_app_apk_update_system.test.js', { cwd: TEST_DIR, env, encoding: 'utf8' });
console.log('   ✓ Selected key test suites passed 100%.');

// Step 7: Clean up temp directory
console.log('7. Cleaning up temporary restoration directory...');
fs.rmSync(TEST_DIR, { recursive: true, force: true });
console.log('   ✓ Temporary directory cleaned.');

console.log('=== ALL RECOVERY VALIDATION CHECKS PASSED ===');
