const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitHubToken() {
  const cred = execSync('printf "host=github.com\\nprotocol=https\\n\\n" | git credential fill', { encoding: 'utf8' });
  const match = cred.match(/password=(.+)/);
  if (!match) throw new Error('Could not retrieve GitHub token from git credential helper');
  return match[1].trim();
}

async function createRelease() {
  const token = getGitHubToken();
  const repo = 'vimaljayganthan/taskly-todo-app';
  const tag = 'v2.1.0';
  const title = 'Taskly v2.1.0 – Reliability & Smart Lists Update';
  const notesFile = path.join(__dirname, '../releases/v210_notes.txt');
  const releaseNotes = fs.readFileSync(notesFile, 'utf8');

  console.log(`Checking if release ${tag} exists...`);
  const checkRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json'
    }
  });

  let releaseData;
  if (checkRes.ok) {
    releaseData = await checkRes.json();
    console.log(`Release ${tag} already exists with ID: ${releaseData.id}`);
  } else {
    console.log(`Creating GitHub release ${tag}...`);
    const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'main',
        name: title,
        body: releaseNotes,
        draft: false,
        prerelease: false
      })
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${errText}`);
    }
    releaseData = await createRes.json();
    console.log(`Release ${tag} created with ID: ${releaseData.id}`);
  }

  // Upload APK asset
  const apkPath = path.join(__dirname, '../releases/taskly-v2.1.0.apk');
  const apkStats = fs.statSync(apkPath);
  const apkBuffer = fs.readFileSync(apkPath);
  const assetName = 'taskly-v2.1.0.apk';

  // Check existing assets
  if (releaseData.assets && releaseData.assets.length > 0) {
    const existing = releaseData.assets.find(a => a.name === assetName);
    if (existing) {
      console.log(`Deleting existing asset ${assetName} (ID: ${existing.id})...`);
      await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
    }
  }

  console.log(`Uploading ${assetName} (${(apkStats.size / (1024 * 1024)).toFixed(1)} MB)...`);
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseData.id}/assets?name=${assetName}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': apkStats.size.toString()
    },
    body: apkBuffer
  });

  if (!uploadRes.ok) {
    const uploadErr = await uploadRes.text();
    throw new Error(`Failed to upload asset: ${uploadRes.status} ${uploadErr}`);
  }

  const assetData = await uploadRes.json();
  console.log(`✓ APK asset uploaded successfully!`);
  console.log(`  Asset ID: ${assetData.id}`);
  console.log(`  Download URL: ${assetData.browser_download_url}`);
  console.log(`  Release URL: ${releaseData.html_url}`);
}

createRelease().catch(err => {
  console.error('Error creating release:', err);
  process.exit(1);
});
