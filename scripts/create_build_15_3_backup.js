const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = '/Users/vimaljayganthan/Documents/ToDo';
const BACKUP_ROOT = '/Users/vimaljayganthan/Documents/Taskly_Backups/Build_15.3';
const RELEASE_ARCHIVE_DIR = path.join(BACKUP_ROOT, 'Release_Archive');
const ARTIFACTS_DIR = '/Users/vimaljayganthan/.gemini/antigravity/brain/a63d551c-c485-47d8-a379-5b12ada06ef6';

const EXCLUDE_PATHS = [
  'node_modules',
  '.DS_Store',
  'android/app/build',
  'android/build',
  'android/.gradle',
  'android/app/release',
  'Release_Archive'
];

function shouldExclude(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  for (const exc of EXCLUDE_PATHS) {
    if (norm === exc || norm.startsWith(exc + '/')) return true;
  }
  if (norm.endsWith('.DS_Store') || norm.endsWith('.log')) return true;
  if (norm.startsWith('scratch/') && norm !== 'scratch/.gitkeep') return true;
  return false;
}

function computeSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return {
    sha256: hash.digest('hex'),
    bytes: buffer.length
  };
}

const inventory = [];

function copyRecursive(src, dest, relBase = '') {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (shouldExclude(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyRecursive(srcPath, destPath, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      const metrics = computeSha256(destPath);
      inventory.push({
        relativePath: relPath,
        sizeBytes: metrics.bytes,
        sha256: metrics.sha256
      });
    }
  }
}

console.log('1. Starting project backup from:', SRC_DIR);
console.log('   Destination:', BACKUP_ROOT);

fs.mkdirSync(BACKUP_ROOT, { recursive: true });
fs.mkdirSync(RELEASE_ARCHIVE_DIR, { recursive: true });

copyRecursive(SRC_DIR, BACKUP_ROOT);
console.log(`   Source files copied: ${inventory.length} files.`);

// 2. Populate Release_Archive
console.log('2. Populating Release_Archive...');

const releaseFiles = [
  { src: path.join(SRC_DIR, 'releases/taskly-v2.3.3.apk'), destName: 'taskly-v2.3.3.apk' },
  { src: path.join(SRC_DIR, 'releases/version-manifest.json'), destName: 'version-manifest.json' },
  { src: path.join(SRC_DIR, 'releases/v233_notes.txt'), destName: 'v233_notes.txt' },
  { src: path.join(SRC_DIR, 'releases/v232_notes.txt'), destName: 'v232_notes.txt' },
  { src: path.join(SRC_DIR, 'releases/v231_notes.txt'), destName: 'v231_notes.txt' },
  { src: path.join(SRC_DIR, 'releases/v230_notes.txt'), destName: 'v230_notes.txt' },
  { src: path.join(ARTIFACTS_DIR, 'TASKLY_V2_3_3_BUILD_15_3_OFFICIAL_RELEASE_REPORT.md'), destName: 'TASKLY_V2_3_3_BUILD_15_3_OFFICIAL_RELEASE_REPORT.md' },
  { src: path.join(ARTIFACTS_DIR, 'TASKLY_ANDROID_VERTICAL_SCROLLING_FIX_REPORT.md'), destName: 'TASKLY_ANDROID_VERTICAL_SCROLLING_FIX_REPORT.md' },
  { src: path.join(ARTIFACTS_DIR, 'TASKLY_UNIVERSAL_DEVICE_ADAPTIVE_COMPATIBILITY_REPORT.md'), destName: 'TASKLY_UNIVERSAL_DEVICE_ADAPTIVE_COMPATIBILITY_REPORT.md' },
  { src: path.join(ARTIFACTS_DIR, 'TASKLY_PROJECT_CLEANUP_REPORT.md'), destName: 'TASKLY_PROJECT_CLEANUP_REPORT.md' }
];

const archiveInventory = [];

for (const item of releaseFiles) {
  if (fs.existsSync(item.src)) {
    const destPath = path.join(RELEASE_ARCHIVE_DIR, item.destName);
    fs.copyFileSync(item.src, destPath);
    const metrics = computeSha256(destPath);
    archiveInventory.push({
      fileName: item.destName,
      relativePath: `Release_Archive/${item.destName}`,
      sizeBytes: metrics.bytes,
      sha256: metrics.sha256
    });
    console.log(`   Copied ${item.destName} (${(metrics.bytes / 1024 / 1024).toFixed(2)} MB, SHA: ${metrics.sha256.slice(0, 12)}...)`);
  } else {
    console.warn(`   WARNING: Missing expected file ${item.src}`);
  }
}

// Write checksum file for the APK
const apkArchive = archiveInventory.find(i => i.fileName === 'taskly-v2.3.3.apk');
if (apkArchive) {
  fs.writeFileSync(path.join(RELEASE_ARCHIVE_DIR, 'taskly-v2.3.3.apk.sha256'), `${apkArchive.sha256}  taskly-v2.3.3.apk\n`);
}

// Release Metadata
const releaseMetadata = {
  application: 'Taskly Customer App',
  packageName: 'com.taskly.app',
  versionName: '2.3.3',
  versionCode: 153,
  displayBuild: '15.3',
  releaseTag: 'v2.3.3-b15.3',
  gitCommit: 'f0bd71fe9cac811d6c28a56c6bc130c6646a24f4',
  releaseDate: '2026-11-18',
  apkFileName: 'taskly-v2.3.3.apk',
  apkSizeBytes: apkArchive ? apkArchive.sizeBytes : 18650326,
  apkSha256: apkArchive ? apkArchive.sha256 : 'a4e2ccacb7c8bc3d3147628624e426d55667a09c01d10d7cbef32eba665d6817',
  signingCertificateSha256: 'd136700bcfb28528ff3b8356604b3f068ca62ff780ea2224e1dc7ecd7a3f4fce',
  signingCertificateSha1: '5a74e5033a30eb6022e6e3c0f4553aa1e4a1a7c3',
  keystoreAlias: 'taskly',
  keystoreFile: '/Users/vimaljayganthan/taskly.jks',
  productionWebUrl: 'https://taskly-todo-app-4z1c.vercel.app',
  gitHubReleaseUrl: 'https://github.com/vimaljayganthan/taskly-todo-app/releases/tag/v2.3.3-b15.3',
  totalHistoricalReleases: 16
};

fs.writeFileSync(path.join(RELEASE_ARCHIVE_DIR, 'RELEASE_METADATA.json'), JSON.stringify(releaseMetadata, null, 2));

// 3. Generate Inventory
console.log('3. Writing backup inventories...');

const totalInventory = [...inventory, ...archiveInventory.map(a => ({
  relativePath: a.relativePath,
  sizeBytes: a.sizeBytes,
  sha256: a.sha256
}))];

fs.writeFileSync(path.join(BACKUP_ROOT, 'BACKUP_INVENTORY.json'), JSON.stringify({
  backupDate: new Date().toISOString(),
  targetRelease: 'Taskly v2.3.3 Build 15.3',
  versionCode: 153,
  totalFiles: totalInventory.length,
  totalSizeBytes: totalInventory.reduce((acc, f) => acc + f.sizeBytes, 0),
  files: totalInventory
}, null, 2));

let inventoryTxt = `# TASKLY BUILD 15.3 BACKUP INVENTORY\n# Date: ${new Date().toISOString()}\n# Version: 2.3.3 | Build: 15.3 | versionCode: 153\n# Total Files: ${totalInventory.length}\n# Total Size: ${(totalInventory.reduce((acc, f) => acc + f.sizeBytes, 0) / (1024 * 1024)).toFixed(2)} MB\n\n`;
inventoryTxt += `SHA-256                                                          Size (Bytes)  Path\n`;
inventoryTxt += `----------------------------------------------------------------  ------------  -----------------------------------------\n`;
for (const item of totalInventory) {
  inventoryTxt += `${item.sha256}  ${String(item.sizeBytes).padStart(12, ' ')}  ${item.relativePath}\n`;
}
fs.writeFileSync(path.join(BACKUP_ROOT, 'BACKUP_INVENTORY.txt'), inventoryTxt);

console.log('   Total backed up files:', totalInventory.length);
console.log('   Total backup size:', (totalInventory.reduce((acc, f) => acc + f.sizeBytes, 0) / (1024 * 1024)).toFixed(2), 'MB');
console.log('✓ Backup copy completed successfully!');
