#!/usr/bin/env node
/**
 * scripts/release-manager.js
 *
 * Taskly Owner-Controlled Android Release Management Tool
 *
 * Strict Production Safeguards:
 * 1. Strictly requires signed production release APK (android/app/build/outputs/apk/release/app-release.apk).
 * 2. ZERO fallback to app-debug.apk. Debug APKs are explicitly rejected.
 * 3. Cryptographic signature verification via Android apksigner.
 * 4. Verification that certificate SHA-256 matches Taskly's production signing identity.
 * 5. Two-stage release gating: Stage A (Private Draft) vs Stage B (Explicit Owner Authorization).
 *
 * Usage:
 *   node scripts/release-manager.js status
 *   node scripts/release-manager.js checksum <path-to-apk>
 *   node scripts/release-manager.js verify-signature <path-to-apk>
 *   node scripts/release-manager.js prepare --version=1.4.0 --build=5 --notes="Release notes..."
 *   node scripts/release-manager.js publish --confirm-owner-approval
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const GRADLE_PATH = path.join(ROOT_DIR, 'android', 'app', 'build.gradle');
const MANIFEST_PATH = path.join(ROOT_DIR, 'releases', 'version-manifest.json');
const PUBLIC_MANIFEST_PATH = path.join(ROOT_DIR, 'public', 'version-manifest.json');
const DRAFT_PATH = path.join(ROOT_DIR, 'releases', 'draft-release.json');

// Expected Production Certificate Fingerprint (matches scripts/update-signing-password.py)
const EXPECTED_PROD_FINGERPRINT = 'D1:36:70:0B:CF:B2:85:28:FF:3B:83:56:60:4B:3F:06:8C:A6:2F:F7:80:EA:22:24:E1:DC:7E:CD:7A:3F:4F:CE';

/**
 * Standardize version string to SemVer (X.Y.Z)
 */
function standardizeVersion(ver) {
  if (!ver || typeof ver !== 'string') return '1.0.0';
  const clean = ver.trim().replace(/^v/i, '');
  const parts = clean.split('.');
  while (parts.length < 3) {
    parts.push('0');
  }
  return parts.slice(0, 3).join('.');
}

/**
 * Locate apksigner binary in Android SDK or PATH
 */
function findApksigner() {
  if (process.env.APKSIGNER_BIN && fs.existsSync(process.env.APKSIGNER_BIN)) {
    return process.env.APKSIGNER_BIN;
  }

  const possibleHomes = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.HOME || '', 'Library', 'Android', 'sdk'),
    '/Users/vimaljayganthan/Library/Android/sdk'
  ].filter(Boolean);

  for (const home of possibleHomes) {
    const buildTools = path.join(home, 'build-tools');
    if (fs.existsSync(buildTools)) {
      try {
        const versions = fs.readdirSync(buildTools).sort().reverse();
        for (const v of versions) {
          const bin = path.join(buildTools, v, 'apksigner');
          if (fs.existsSync(bin)) return bin;
        }
      } catch (_) {}
    }
  }

  try {
    const which = execSync('which apksigner 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which && fs.existsSync(which)) return which;
  } catch (_) {}

  return null;
}

/**
 * Compute SHA-256 and byte metrics of a file
 */
function computeSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return {
    sha256: hash.digest('hex'),
    bytes: fileBuffer.length,
    mb: (fileBuffer.length / (1024 * 1024)).toFixed(1) + ' MB'
  };
}

/**
 * Cryptographically verify APK signature using apksigner
 */
function verifyApkSigning(apkPath, expectedFingerprint = EXPECTED_PROD_FINGERPRINT) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK file not found: ${apkPath}`);
  }

  // 1. Strict Filename Check: Reject any debug APK
  const baseName = path.basename(apkPath).toLowerCase();
  if (baseName.includes('debug')) {
    throw new Error(`Security Violation: Debug APK '${path.basename(apkPath)}' cannot be published to production. Only production-signed release APKs (app-release.apk) are allowed.`);
  }

  const apksignerBin = findApksigner();
  if (!apksignerBin) {
    throw new Error('Android apksigner tool could not be located in Android SDK build-tools or PATH.');
  }

  let verifyOutput = '';
  try {
    verifyOutput = execSync(`"${apksignerBin}" verify --verbose --print-certs "${apkPath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    throw new Error(`Security Violation: APK signature verification failed for '${path.basename(apkPath)}': ${stderr || stdout || err.message}`);
  }

  // 2. Reject Android Debug Signing Identity
  if (verifyOutput.includes('CN=Android Debug') || verifyOutput.includes('O=Android')) {
    throw new Error(`Security Violation: APK '${path.basename(apkPath)}' is signed with Android Debug certificate. Debug-signed builds are prohibited in production.`);
  }

  // 3. Extract SHA-256 Digest
  const match = verifyOutput.match(/Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/);
  if (!match) {
    throw new Error(`Security Violation: Could not extract certificate SHA-256 digest from apksigner output.`);
  }

  const extractedDigest = match[1].toLowerCase().trim();
  const normalizedExpected = expectedFingerprint.replace(/[^a-fA-F0-9]/g, '').toLowerCase().trim();

  // 4. Verify Identity Parity
  if (extractedDigest !== normalizedExpected) {
    throw new Error(`Security Violation: APK certificate fingerprint mismatch!\n  Expected Production: ${normalizedExpected}\n  Found in APK:        ${extractedDigest}`);
  }

  return {
    verified: true,
    fingerprint: extractedDigest,
    tool: apksignerBin
  };
}

function readGradleVersion() {
  if (!fs.existsSync(GRADLE_PATH)) return { versionName: '1.4.0', versionCode: 5 };
  const content = fs.readFileSync(GRADLE_PATH, 'utf8');
  const codeMatch = content.match(/versionCode\s+(\d+)/);
  const nameMatch = content.match(/versionName\s+["']([^"']+)["']/);
  return {
    versionCode: codeMatch ? parseInt(codeMatch[1], 10) : 5,
    versionName: nameMatch ? standardizeVersion(nameMatch[1]) : '1.4.0'
  };
}

function readProductionManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    console.error('Error parsing production manifest:', e.message);
    return null;
  }
}

function showStatus() {
  const gradle = readGradleVersion();
  const manifest = readProductionManifest();

  console.log('\n======================================================');
  console.log('       TASKLY RELEASE STATUS & INTEGRITY CHECK        ');
  console.log('======================================================\n');
  console.log(`[Android Gradle Configuration]:`);
  console.log(`  - Package Name:  com.taskly.app`);
  console.log(`  - Version Name:  ${gradle.versionName}`);
  console.log(`  - Version Code:  ${gradle.versionCode}`);

  console.log(`\n[Production Remote Manifest]:`);
  if (manifest) {
    console.log(`  - Latest Approved:  v${manifest.latestVersion} (Build ${manifest.versionCode})`);
    console.log(`  - Release Date:     ${manifest.releaseDate}`);
    console.log(`  - File Size:        ${manifest.fileSize}`);
    console.log(`  - SHA-256:          ${manifest.sha256}`);
    console.log(`  - Download URL:     ${manifest.apkDownloadUrl}`);
  } else {
    console.log(`  - Status: No production manifest found at ${MANIFEST_PATH}`);
  }

  const isDevAhead = manifest && gradle.versionCode > manifest.versionCode;
  console.log(`\n[Release Separation Status]:`);
  if (isDevAhead) {
    console.log(`  ⚠️  Development versionCode (${gradle.versionCode}) is ahead of production (${manifest.versionCode}).`);
    console.log(`     DEVELOPMENT STAGE: This build is strictly PRIVATE and will NOT trigger`);
    console.log(`     any update notification for existing users until explicitly published.`);
  } else {
    console.log(`  ✓  Production manifest matches current release version.`);
    console.log(`     Existing users are up to date.`);
  }

  // Check APK existence
  const releaseApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const debugApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  console.log(`\n[Local APK Build Artifacts]:`);
  if (fs.existsSync(releaseApk)) {
    const info = computeSha256(releaseApk);
    console.log(`  ✓ Release APK: ${releaseApk} (${info.mb}) [SHA: ${info.sha256.slice(0, 16)}...]`);
  } else {
    console.log(`  - Release APK: Not built yet (${releaseApk})`);
  }
  if (fs.existsSync(debugApk)) {
    const info = computeSha256(debugApk);
    console.log(`  ✓ Debug APK (Internal Only): ${debugApk} (${info.mb})`);
  } else {
    console.log(`  - Debug APK:   Not built yet (${debugApk})`);
  }
  console.log('\n======================================================\n');
}

/**
 * Prepare a candidate production release draft (Stage A - Strictly Private).
 * Guarantees zero fallback to debug APK.
 */
function prepareRelease(args = {}) {
  console.log('\n[Stage A] Preparing Candidate Release (Private Draft)...');
  const gradle = readGradleVersion();
  const version = standardizeVersion(args.version || gradle.versionName);
  const build = args.build ? parseInt(args.build, 10) : gradle.versionCode;
  const notes = args.notes || 'Performance enhancements and stability improvements.';

  // Target APK MUST be app-release.apk (or custom path explicitly specified)
  const defaultReleaseApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const targetApk = args.apk || defaultReleaseApk;

  // 1. Strict Failure if Release APK does not exist (NO FALLBACK TO DEBUG APK)
  if (!fs.existsSync(targetApk)) {
    console.error(`\n❌ ERROR: Production release preparation failed!`);
    console.error(`   Required signed release APK not found at: ${targetApk}`);
    console.error(`   Automatic fallback to debug APK has been permanently removed.`);
    console.error(`   To build a signed release APK:`);
    console.error(`   cd android && JAVA_HOME="/opt/homebrew/opt/openjdk@21" ./gradlew assembleRelease\n`);
    throw new Error(`Production release APK not found at ${targetApk}. Fallback to debug APK is prohibited.`);
  }

  // 2. Reject if filename contains 'debug'
  const baseName = path.basename(targetApk).toLowerCase();
  if (baseName.includes('debug')) {
    throw new Error(`Security Violation: Debug APK '${targetApk}' cannot be used for production release preparation.`);
  }

  // 3. Cryptographic Signature Verification
  console.log(`[Integrity Check] Verifying APK signature with apksigner...`);
  const certInfo = verifyApkSigning(targetApk, EXPECTED_PROD_FINGERPRINT);
  console.log(`  ✓ Signature valid: Production Certificate verified (${certInfo.fingerprint.slice(0, 16)}...)`);

  // 4. Compute metrics
  const apkMetrics = computeSha256(targetApk);
  const draftManifest = {
    latestVersion: version,
    versionCode: build,
    apkDownloadUrl: `https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v${version}/taskly-v${version}.apk`,
    releaseNotes: notes,
    releaseDate: new Date().toISOString().split('T')[0],
    minimumSupportedVersion: '1.0.0',
    fileSize: apkMetrics.mb,
    fileSizeBytes: apkMetrics.bytes,
    sha256: apkMetrics.sha256,
    mandatoryUpdate: false,
    apkSourceFile: path.relative(ROOT_DIR, targetApk)
  };

  fs.writeFileSync(DRAFT_PATH, JSON.stringify(draftManifest, null, 2));
  console.log(`✓ Draft prepared successfully: ${DRAFT_PATH}`);
  console.log(`  Version: v${version} (Build ${build})`);
  console.log(`  SHA-256: ${apkMetrics.sha256}`);
  console.log(`  Size:    ${apkMetrics.mb} (${apkMetrics.bytes} bytes)`);
  console.log('\n⚠️  IMPORTANT: This release candidate has NOT been published.');
  console.log('   The production update manifest has NOT been modified.');
  console.log('   Existing users will NOT see this update until explicitly approved.');
  console.log('\nTo publish this version to production, run:');
  console.log('   node scripts/release-manager.js publish --confirm-owner-approval\n');
  return draftManifest;
}

/**
 * Publish candidate release to production manifest (Stage B - Owner Authorized).
 */
function publishRelease(args = {}) {
  if (!args['confirm-owner-approval']) {
    console.error('\n🛑 ACTION BLOCKED: Owner authorization required!');
    console.error('Building or preparing an APK must never automatically publish it to existing users.');
    console.error('To explicitly approve this release for production, pass:');
    console.error('   --confirm-owner-approval\n');
    throw new Error('Explicit owner authorization required: --confirm-owner-approval');
  }

  if (!fs.existsSync(DRAFT_PATH)) {
    console.error(`Error: No draft release found at ${DRAFT_PATH}. Run prepare first.`);
    throw new Error(`Draft release file not found at ${DRAFT_PATH}`);
  }

  const draft = JSON.parse(fs.readFileSync(DRAFT_PATH, 'utf8'));

  // Strict check: draft must not be derived from a debug APK
  if (draft.apkSourceFile && draft.apkSourceFile.toLowerCase().includes('debug')) {
    throw new Error(`Security Violation: Draft specifies a debug APK source file (${draft.apkSourceFile}). Publishing rejected.`);
  }

  const currentManifest = readProductionManifest() || { history: [] };

  // Prepend current release to history
  const history = currentManifest.history ? [...currentManifest.history] : [];
  history.unshift({
    version: draft.latestVersion,
    versionCode: draft.versionCode,
    releaseDate: draft.releaseDate,
    summary: draft.releaseNotes,
    features: ['Approved production release'],
    improvements: [],
    fixes: []
  });

  const productionManifest = {
    latestVersion: draft.latestVersion,
    versionCode: draft.versionCode,
    apkDownloadUrl: draft.apkDownloadUrl,
    releaseNotes: draft.releaseNotes,
    releaseDate: draft.releaseDate,
    minimumSupportedVersion: draft.minimumSupportedVersion,
    fileSize: draft.fileSize,
    fileSizeBytes: draft.fileSizeBytes,
    sha256: draft.sha256,
    mandatoryUpdate: draft.mandatoryUpdate,
    history: history
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(productionManifest, null, 2));
  fs.writeFileSync(PUBLIC_MANIFEST_PATH, JSON.stringify(productionManifest, null, 2));
  fs.unlinkSync(DRAFT_PATH);

  console.log('\n======================================================');
  console.log('   ✓ PRODUCTION UPDATE MANIFEST PUBLISHED BY OWNER    ');
  console.log('======================================================');
  console.log(`  Latest Version: v${productionManifest.latestVersion}`);
  console.log(`  Version Code:   ${productionManifest.versionCode}`);
  console.log(`  APK URL:        ${productionManifest.apkDownloadUrl}`);
  console.log(`  SHA-256:        ${productionManifest.sha256}`);
  console.log('\nNext steps to complete distribution:');
  console.log(`1. Upload the APK to GitHub Releases for tag v${productionManifest.latestVersion}:`);
  console.log(`   gh release create v${productionManifest.latestVersion} <path-to-apk> --title "Taskly v${productionManifest.latestVersion}"`);
  console.log('2. Commit and push the updated releases/version-manifest.json to GitHub repository.');
  console.log('3. Existing Taskly users will now detect the update when opening Profile → Version!\n');
  return productionManifest;
}

// Module Exports for Automated Testing
module.exports = {
  computeSha256,
  verifyApkSigning,
  findApksigner,
  prepareRelease,
  publishRelease,
  readGradleVersion,
  standardizeVersion,
  EXPECTED_PROD_FINGERPRINT
};

// CLI Execution (when executed directly from terminal)
if (require.main === module) {
  const argv = process.argv.slice(2);
  const command = argv[0] || 'status';
  const parsedArgs = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        parsedArgs[key] = val;
      } else {
        parsedArgs[arg.slice(2)] = true;
      }
    }
  }

  try {
    switch (command) {
      case 'status':
        showStatus();
        break;
      case 'checksum':
        if (!argv[1]) {
          console.error('Please specify APK file path: node scripts/release-manager.js checksum <path>');
          process.exit(1);
        }
        const info = computeSha256(argv[1]);
        console.log(`\nFile:    ${argv[1]}`);
        console.log(`Size:    ${info.mb} (${info.bytes} bytes)`);
        console.log(`SHA-256: ${info.sha256}\n`);
        break;
      case 'verify-signature':
        if (!argv[1]) {
          console.error('Please specify APK file path: node scripts/release-manager.js verify-signature <path>');
          process.exit(1);
        }
        const res = verifyApkSigning(argv[1]);
        console.log(`\n✓ Verification SUCCESS: ${argv[1]}`);
        console.log(`  SHA-256 Fingerprint: ${res.fingerprint}`);
        console.log(`  apksigner:           ${res.tool}\n`);
        break;
      case 'prepare':
        prepareRelease(parsedArgs);
        break;
      case 'publish':
        publishRelease(parsedArgs);
        break;
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Available commands: status, checksum, verify-signature, prepare, publish');
        break;
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}
