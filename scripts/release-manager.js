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
  // 1. Strict Filename Check: Reject any debug APK
  const baseName = path.basename(apkPath).toLowerCase();
  if (baseName.includes('debug')) {
    throw new Error(`Security Violation: Debug APK '${path.basename(apkPath)}' cannot be published to production. Only production-signed release APKs (app-release.apk) are allowed.`);
  }

  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK file not found: ${apkPath}`);
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
  if (!fs.existsSync(GRADLE_PATH)) return { versionName: '1.4.0', versionCode: 5, packageName: 'com.taskly.app' };
  const content = fs.readFileSync(GRADLE_PATH, 'utf8');
  const codeMatch = content.match(/versionCode\s+(\d+)/);
  const nameMatch = content.match(/versionName\s+["']([^"']+)["']/);
  const pkgMatch = content.match(/applicationId\s+["']([^"']+)["']/);
  return {
    versionCode: codeMatch ? parseInt(codeMatch[1], 10) : 5,
    versionName: nameMatch ? standardizeVersion(nameMatch[1]) : '1.4.0',
    packageName: pkgMatch ? pkgMatch[1] : 'com.taskly.app'
  };
}

/**
 * Validate manifest schema and historical entries integrity.
 * Throws a fatal Error if any required property, version identifier, or history entry is invalid.
 */
function validateManifestData(data, sourceDesc = 'manifest') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Fatal Validation Error: Manifest at '${sourceDesc}' must be a valid JSON object.`);
  }

  if (data.latestVersion == null || typeof data.latestVersion !== 'string' || !data.latestVersion.trim()) {
    throw new Error(`Fatal Validation Error: Manifest at '${sourceDesc}' is missing a valid 'latestVersion'.`);
  }

  if (data.versionCode == null || isNaN(parseInt(data.versionCode, 10)) || parseInt(data.versionCode, 10) <= 0) {
    throw new Error(`Fatal Validation Error: Manifest at '${sourceDesc}' is missing a valid numeric 'versionCode'.`);
  }

  if (data.history !== undefined) {
    if (!Array.isArray(data.history)) {
      throw new Error(`Fatal Validation Error: Manifest at '${sourceDesc}' history property must be an array.`);
    }

    const seenCodes = new Set();
    const seenVersions = new Set();

    data.history.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Fatal Validation Error: History entry at index ${idx} in '${sourceDesc}' is invalid.`);
      }
      if (entry.versionCode == null || isNaN(parseInt(entry.versionCode, 10)) || parseInt(entry.versionCode, 10) <= 0) {
        throw new Error(`Fatal Validation Error: History entry at index ${idx} in '${sourceDesc}' has an invalid versionCode.`);
      }
      const code = parseInt(entry.versionCode, 10);
      if (seenCodes.has(code)) {
        throw new Error(`Fatal Validation Error: Duplicate versionCode ${code} found in history of '${sourceDesc}'.`);
      }
      seenCodes.add(code);

      const verName = (entry.version || entry.versionName || '').trim();
      if (!verName) {
        throw new Error(`Fatal Validation Error: History entry at index ${idx} (versionCode: ${code}) is missing a version identifier.`);
      }
      if (seenVersions.has(verName)) {
        throw new Error(`Fatal Validation Error: Duplicate version identifier '${verName}' found in history of '${sourceDesc}'.`);
      }
      seenVersions.add(verName);
    });
  }

  return true;
}

/**
 * Read and validate production manifest.
 * Returns null ONLY when the file genuinely does not exist on disk.
 * Throws a fatal Error if the file exists but cannot be read or parsed, or fails schema validation.
 */
function readProductionManifest(manifestPath = MANIFEST_PATH) {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  let content;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (readErr) {
    throw new Error(`Fatal I/O Error: Production manifest exists at '${manifestPath}' but cannot be read: ${readErr.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    throw new Error(`Fatal Syntax Error: Production manifest at '${manifestPath}' is corrupted or contains invalid JSON: ${parseErr.message}`);
  }

  validateManifestData(parsed, manifestPath);
  return parsed;
}

function showStatus() {
  const gradle = readGradleVersion();
  let manifest = null;
  try {
    manifest = readProductionManifest();
  } catch (err) {
    console.error(`\n❌ Warning: Failed to read production manifest: ${err.message}\n`);
  }

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

function parseCategoryItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
    }
    return trimmed.split(/\r?\n|,\s*/).map(s => s.trim()).filter(Boolean);
  }
  return [];
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

  // Target APK MUST be app-release.apk (or custom path explicitly specified)
  const defaultReleaseApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const targetApk = args.apk || defaultReleaseApk;

  // 1. Reject if filename contains 'debug' (strictly prohibit debug APK targets)
  const baseName = path.basename(targetApk).toLowerCase();
  if (baseName.includes('debug')) {
    throw new Error(`Security Violation: Debug APK '${targetApk}' cannot be used for production release preparation.`);
  }

  // 2. Strict Failure if Release APK does not exist (NO FALLBACK TO DEBUG APK)
  if (!fs.existsSync(targetApk)) {
    console.error(`\n❌ ERROR: Production release preparation failed!`);
    console.error(`   Required signed release APK not found at: ${targetApk}`);
    console.error(`   Automatic fallback to debug APK has been permanently removed.`);
    console.error(`   To build a signed release APK:`);
    console.error(`   cd android && JAVA_HOME="/opt/homebrew/opt/openjdk@21" ./gradlew assembleRelease\n`);
    throw new Error(`Production release APK not found at ${targetApk}. Fallback to debug APK is prohibited.`);
  }

  // 3. Validate Version Progression
  const currentManifest = readProductionManifest();
  if (currentManifest && currentManifest.versionCode != null) {
    if (build <= currentManifest.versionCode) {
      throw new Error(`Progression Violation: Candidate versionCode (${build}) must be strictly greater than current production versionCode (${currentManifest.versionCode}).`);
    }
  }

  // 4. Explicit Title & Release Notes Validation
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) {
    throw new Error('Validation Error: Explicit release title (--title) is required for production release preparation.');
  }

  let notes = typeof args.notes === 'string' ? args.notes.trim() : (typeof args.summary === 'string' ? args.summary.trim() : '');
  if (!notes && args['notes-file']) {
    const notesFile = path.resolve(ROOT_DIR, args['notes-file']);
    if (fs.existsSync(notesFile)) {
      notes = fs.readFileSync(notesFile, 'utf8').trim();
    }
  }
  if (!notes) {
    throw new Error('Validation Error: Explicit release notes (--notes, --summary, or --notes-file) are required for production release preparation.');
  }

  // 5. Cryptographic Signature Verification
  console.log(`[Integrity Check] Verifying APK signature with apksigner...`);
  const certInfo = verifyApkSigning(targetApk, EXPECTED_PROD_FINGERPRINT);
  console.log(`  ✓ Signature valid: Production Certificate verified (${certInfo.fingerprint.slice(0, 16)}...)`);

  const features = parseCategoryItems(args.features);
  const improvements = parseCategoryItems(args.improvements);
  const performance = parseCategoryItems(args.performance);
  const fixes = parseCategoryItems(args.fixes);
  const security = parseCategoryItems(args.security);

  if (features.length === 0 && improvements.length === 0 && performance.length === 0 && fixes.length === 0 && security.length === 0) {
    features.push(notes);
  }

  // 6. Compute metrics
  const apkMetrics = computeSha256(targetApk);
  const draftManifest = {
    latestVersion: version,
    versionCode: build,
    title: title,
    apkDownloadUrl: `https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v${version}/taskly-v${version}.apk`,
    releaseNotes: notes,
    summary: notes,
    releaseDate: new Date().toISOString().split('T')[0],
    minimumSupportedVersion: '1.0.0',
    fileSize: apkMetrics.mb,
    fileSizeBytes: apkMetrics.bytes,
    sha256: apkMetrics.sha256,
    mandatoryUpdate: Boolean(args.mandatory),
    apkSourceFile: path.relative(ROOT_DIR, targetApk),
    features: features,
    improvements: improvements,
    performance: performance,
    fixes: fixes,
    security: security
  };

  fs.writeFileSync(DRAFT_PATH, JSON.stringify(draftManifest, null, 2));
  console.log(`✓ Draft prepared successfully: ${DRAFT_PATH}`);
  console.log(`  Version: v${version} (Build ${build})`);
  console.log(`  Title:   ${title}`);
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
 * Implements a staged dual-manifest replacement strategy with validation, atomic renames,
 * and recovery-safe rollback protection.
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

  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(DRAFT_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Fatal Error: Release draft file at '${DRAFT_PATH}' is corrupted or unreadable: ${err.message}`);
  }

  // Strict check: draft must not be derived from a debug APK
  if (draft.apkSourceFile && draft.apkSourceFile.toLowerCase().includes('debug')) {
    throw new Error(`Security Violation: Draft specifies a debug APK source file (${draft.apkSourceFile}). Publishing rejected.`);
  }

  // Read and validate current production manifest
  const currentManifest = readProductionManifest(MANIFEST_PATH);
  let history = [];

  if (currentManifest) {
    if (!Array.isArray(currentManifest.history)) {
      throw new Error(`Fatal: Current production manifest at '${MANIFEST_PATH}' has an invalid or missing history array.`);
    }
    history = [...currentManifest.history];

    if (currentManifest.versionCode != null && draft.versionCode <= currentManifest.versionCode) {
      throw new Error(`Progression Violation: Draft versionCode (${draft.versionCode}) must be strictly greater than current production versionCode (${currentManifest.versionCode}).`);
    }
  } else {
    // Explicit first-release initialization path only
    console.warn(`[Release Manager] No previous production manifest found at ${MANIFEST_PATH}. Initializing initial release.`);
  }

  // Construct new historical release entry
  const newHistoricalEntry = {
    version: draft.latestVersion,
    versionName: draft.latestVersion,
    versionCode: draft.versionCode,
    releaseDate: draft.releaseDate,
    title: draft.title || `Taskly v${draft.latestVersion}`,
    summary: draft.releaseNotes || draft.summary || '',
    features: (Array.isArray(draft.features) && draft.features.length > 0) ? draft.features : [draft.releaseNotes || 'Approved production release'],
    improvements: Array.isArray(draft.improvements) ? draft.improvements : [],
    performance: Array.isArray(draft.performance) ? draft.performance : [],
    fixes: Array.isArray(draft.fixes) ? draft.fixes : [],
    security: Array.isArray(draft.security) ? draft.security : [],
    apkFileName: path.basename(draft.apkDownloadUrl || `taskly-v${draft.latestVersion}.apk`),
    fileSize: draft.fileSize,
    fileSizeBytes: draft.fileSizeBytes,
    sha256: draft.sha256,
    downloadUrl: draft.apkDownloadUrl,
    minSdkVersion: draft.minSdkVersion || '24',
    targetSdkVersion: draft.targetSdkVersion || '34'
  };

  // Filter out any duplicate versionCode if re-publishing a draft, then unshift
  const filteredHistory = history.filter(h => h.versionCode !== newHistoricalEntry.versionCode);
  filteredHistory.unshift(newHistoricalEntry);

  // Strictly sort history by versionCode descending (newest first)
  filteredHistory.sort((a, b) => (parseInt(b.versionCode, 10) || 0) - (parseInt(a.versionCode, 10) || 0));

  const productionManifest = {
    latestVersion: draft.latestVersion,
    versionCode: draft.versionCode,
    title: newHistoricalEntry.title,
    apkDownloadUrl: draft.apkDownloadUrl,
    releaseNotes: draft.releaseNotes,
    releaseDate: draft.releaseDate,
    minimumSupportedVersion: draft.minimumSupportedVersion,
    fileSize: draft.fileSize,
    fileSizeBytes: draft.fileSizeBytes,
    sha256: draft.sha256,
    mandatoryUpdate: draft.mandatoryUpdate,
    history: filteredHistory
  };

  // Validate complete constructed manifest data before touching filesystem
  validateManifestData(productionManifest, 'generated payload');
  const payload = JSON.stringify(productionManifest, null, 2) + '\n';

  // --------------------------------------------------------------------------
  // Staged Two-Phase Manifest Replacement Strategy with Rollback & Recovery
  // --------------------------------------------------------------------------
  const manifestDir = path.dirname(MANIFEST_PATH);
  const publicDir = path.dirname(PUBLIC_MANIFEST_PATH);

  const timestamp = Date.now();
  const manifestStagePath = path.join(manifestDir, `.version-manifest.stage.${timestamp}.tmp`);
  const publicStagePath = path.join(publicDir, `.version-manifest.stage.${timestamp}.tmp`);

  const manifestBackupPath = path.join(manifestDir, `.version-manifest.backup.${timestamp}.bak`);
  const publicBackupPath = path.join(publicDir, `.version-manifest.backup.${timestamp}.bak`);

  let manifestBackupCreated = false;
  let publicBackupCreated = false;
  let manifestRenamed = false;
  let publicRenamed = false;

  try {
    // Stage 1: Preserve recoverable backups of existing manifests
    if (fs.existsSync(MANIFEST_PATH)) {
      fs.copyFileSync(MANIFEST_PATH, manifestBackupPath);
      manifestBackupCreated = true;
    }
    if (fs.existsSync(PUBLIC_MANIFEST_PATH)) {
      fs.copyFileSync(PUBLIC_MANIFEST_PATH, publicBackupPath);
      publicBackupCreated = true;
    }

    // Failure injection hook: before writing stage files
    if (args._failAtStage === 'beforeWriteStageFiles') {
      throw new Error('Simulated failure during stage file creation.');
    }

    // Stage 2: Write temporary stage files in the same directories as targets
    fs.writeFileSync(manifestStagePath, payload, 'utf8');
    fs.writeFileSync(publicStagePath, payload, 'utf8');

    // Stage 3: Validate staged JSON before replacement
    const staged1Content = fs.readFileSync(manifestStagePath, 'utf8');
    const staged2Content = fs.readFileSync(publicStagePath, 'utf8');
    if (staged1Content !== payload || staged2Content !== payload) {
      throw new Error('Validation Error: Staged files do not match generated payload.');
    }
    validateManifestData(JSON.parse(staged1Content), manifestStagePath);
    validateManifestData(JSON.parse(staged2Content), publicStagePath);

    // Failure injection hook: before replacing first manifest
    if (args._failAtStage === 'beforeRenameTarget1') {
      throw new Error('Simulated failure before replacing first manifest.');
    }

    // Stage 4: Replace first manifest using atomic filesystem rename
    fs.renameSync(manifestStagePath, MANIFEST_PATH);
    manifestRenamed = true;

    // Failure injection hook: before replacing second manifest
    if (args._failAtStage === 'beforeRenameTarget2' || args._failAtStage === 'duringRollback') {
      throw new Error('Simulated failure before replacing second manifest.');
    }

    // Stage 5: Replace second manifest using atomic filesystem rename
    fs.renameSync(publicStagePath, PUBLIC_MANIFEST_PATH);
    publicRenamed = true;

    // Stage 6: Post-replacement dual consistency verification
    const final1 = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const final2 = fs.readFileSync(PUBLIC_MANIFEST_PATH, 'utf8');
    if (final1 !== final2 || final1 !== payload) {
      throw new Error('Post-publishing verification failed: Target manifests are not identical to generated payload.');
    }

    // Stage 7: Clean up backups
    if (manifestBackupCreated && fs.existsSync(manifestBackupPath)) fs.unlinkSync(manifestBackupPath);
    if (publicBackupCreated && fs.existsSync(publicBackupPath)) fs.unlinkSync(publicBackupPath);

    // Stage 8: Delete draft ONLY after successful dual verification
    if (fs.existsSync(DRAFT_PATH)) {
      fs.unlinkSync(DRAFT_PATH);
    }
  } catch (publishErr) {
    console.error(`\n⚠️ Publishing encountered an error: ${publishErr.message}`);
    console.error('Initiating staged rollback to preserve manifest integrity...');

    let rollbackErrors = [];

    // Simulate failure during rollback if requested
    if (args._failAtStage === 'duringRollback') {
      rollbackErrors.push('Simulated failure during rollback operation.');
    } else {
      // Roll back targets if they were renamed
      if (manifestRenamed && manifestBackupCreated && fs.existsSync(manifestBackupPath)) {
        try {
          fs.copyFileSync(manifestBackupPath, MANIFEST_PATH);
        } catch (rbErr) {
          rollbackErrors.push(`Failed to restore ${MANIFEST_PATH}: ${rbErr.message}`);
        }
      }
      if (publicRenamed && publicBackupCreated && fs.existsSync(publicBackupPath)) {
        try {
          fs.copyFileSync(publicBackupPath, PUBLIC_MANIFEST_PATH);
        } catch (rbErr) {
          rollbackErrors.push(`Failed to restore ${PUBLIC_MANIFEST_PATH}: ${rbErr.message}`);
        }
      }
    }

    // Clean up temporary stage files if still present
    if (fs.existsSync(manifestStagePath)) try { fs.unlinkSync(manifestStagePath); } catch (_) {}
    if (fs.existsSync(publicStagePath)) try { fs.unlinkSync(publicStagePath); } catch (_) {}

    if (rollbackErrors.length > 0) {
      // Recovery preservation: Keep backup files and halt with critical error
      const recoveryMsg = `CRITICAL: Staged publishing failed AND rollback failed! Recovery backups preserved at:\n` +
        `  - ${manifestBackupCreated ? manifestBackupPath : 'none'}\n` +
        `  - ${publicBackupCreated ? publicBackupPath : 'none'}\n` +
        `Rollback errors: ${rollbackErrors.join('; ')}\n` +
        `Original error: ${publishErr.message}`;
      console.error('\n🛑 ' + recoveryMsg + '\n');
      throw new Error(recoveryMsg);
    }

    // Rollback succeeded cleanly — clean up backups
    if (manifestBackupCreated && fs.existsSync(manifestBackupPath)) {
      try { fs.unlinkSync(manifestBackupPath); } catch (_) {}
    }
    if (publicBackupCreated && fs.existsSync(publicBackupPath)) {
      try { fs.unlinkSync(publicBackupPath); } catch (_) {}
    }

    // Note: DRAFT_PATH is preserved so draft is never lost!
    throw new Error(`Staged publishing failed (safely rolled back to previous manifests): ${publishErr.message}`);
  }

  console.log('\n======================================================');
  console.log('   ✓ PRODUCTION UPDATE MANIFEST PUBLISHED BY OWNER    ');
  console.log('======================================================');
  console.log(`  Latest Version: v${productionManifest.latestVersion}`);
  console.log(`  Version Code:   ${productionManifest.versionCode}`);
  console.log(`  Title:          ${productionManifest.title}`);
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
  parseCategoryItems,
  readProductionManifest,
  validateManifestData,
  EXPECTED_PROD_FINGERPRINT,
  DRAFT_PATH,
  MANIFEST_PATH,
  PUBLIC_MANIFEST_PATH
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
        const key = arg.slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          parsedArgs[key] = argv[++i];
        } else {
          parsedArgs[key] = true;
        }
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
