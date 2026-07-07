const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const express = require('express');
const ServiceManager = require('./service-manager');
const Patcher = require('./patcher');
const UpdateClient = require('./update-client');

let mainWindow;
let serviceManager;
let expressApp;
let expressServer;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const APPDATA_DIR = path.join(app.getPath('userData'), 'vyla-home-files');
fs.mkdirSync(APPDATA_DIR, { recursive: true });

const envConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/env.json'), 'utf8'));
const replacementsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/replacements.json'), 'utf8'));
const updateConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/update.json'), 'utf8'));

const updateClient = new UpdateClient(updateConfig, APPDATA_DIR);

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Vyla Home',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Vyla Home</title>
<style>
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

body {
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  user-select: none;
}

.spinner {
  width: 22px;
  height: 22px;
  animation: spin 0.8s linear infinite;
}

.spinner circle {
  fill: none;
  stroke: rgba(255,255,255,.95);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 1, 200;
  stroke-dashoffset: 0;
  animation: dash 1.5s ease-in-out infinite;
}

#status {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255,.55);
  letter-spacing: -.01em;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dash {
  0% {
    stroke-dasharray: 1,200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 90,200;
    stroke-dashoffset: -35;
  }
  100% {
    stroke-dasharray: 90,200;
    stroke-dashoffset: -124;
  }
}
</style>
</head>
<body>

<div class="loader">
  <svg class="spinner" viewBox="25 25 50 50" aria-hidden="true">
    <circle cx="50" cy="50" r="20"></circle>
  </svg>
  <div id="status">Starting…</div>
</div>

</body>
</html>
`));

  const patcher = new Patcher(APPDATA_DIR);
  serviceManager = new ServiceManager(APPDATA_DIR, envConfig);

  const updateStatus = async (statusText) => {
    await mainWindow.webContents.executeJavaScript(`
      const el = document.getElementById('status');
      if (el) el.innerText = ${JSON.stringify(statusText)};
    `).catch(() => { });
  };

  const handleFatalError = (errMessage) => {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Startup Error</title>
<style>
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.container {
  max-width: 480px;
  text-align: center;
}

.icon {
  width: 38px;
  height: 38px;
  margin: 0 auto 22px;
  color: #ff453a;
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.02em;
}

p {
  margin: 14px 0 28px;
  color: rgba(255,255,255,.55);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

button {
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: #000;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity .2s ease;
}

button:hover {
  opacity: .82;
}

button:active {
  opacity: .65;
}
</style>
</head>
<body>

<div class="container">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="7" x2="12" y2="13"/>
    <circle cx="12" cy="17" r="1"/>
  </svg>

  <h1>Couldn't start Vyla Home</h1>

  <p>${errMessage}</p>

  <button onclick="location.reload()">
    Try Again
  </button>
</div>

</body>
</html>
`));
  };

  try {
    let manifest = null;
    let localVersion = patcher.getCurrentVersion();
    let hasManifestUpdate = false;

    try {
      console.log('[Update] Fetching manifest from update server...');
      manifest = await updateClient.checkForUpdates();
      if (manifest && manifest.version !== localVersion) {
        hasManifestUpdate = true;
      }
    } catch (err) {
      console.warn('[Update] Update manifest check failed, running off local cache/assets.', err.message);
    }

    const localZipPayload = path.join(__dirname, 'update-payload.zip');
    const localHasSource = patcher.verifyExtraction();

    if (!localHasSource && !hasManifestUpdate && fs.existsSync(localZipPayload)) {
      console.log('[Update] Extracting shipped local payload fallback...');
      await updateStatus('Extracting bundled payload fallback...');
      patcher.purgeOldCode();
      patcher.extractZipPayload(localZipPayload);
      patcher.applyPatches(replacementsConfig);
      patcher.saveCurrentVersion('1.0.0');
    }

    if (hasManifestUpdate && manifest) {
      const tempZipPath = path.join(APPDATA_DIR, 'download-temp.zip');
      let attempts = 0;
      let downloadSuccess = false;

      while (attempts < 3 && !downloadSuccess) {
        attempts++;
        try {
          await updateStatus(`Downloading update version ${manifest.version} (Attempt ${attempts}/3)...`);
          await updateClient.downloadUpdate(manifest, tempZipPath, (downloaded, total) => {
            const percent = Math.round((downloaded / total) * 100);
            console.log(`[Update] Download progress: ${percent}%`);
          });

          await updateStatus('Verifying checksum...');
          if (!patcher.verifyChecksum(tempZipPath, manifest.sha256)) {
            throw new Error('SHA-256 checksum verification failed.');
          }

          await updateStatus('Extracting application files...');
          patcher.purgeOldCode();
          patcher.extractZipPayload(tempZipPath);

          if (!patcher.verifyExtraction()) {
            throw new Error('Extraction verification failed: critical startup files missing.');
          }

          patcher.applyPatches(replacementsConfig);
          patcher.saveCurrentVersion(manifest.version);

          fs.unlinkSync(tempZipPath);
          downloadSuccess = true;
          console.log(`[Update] Successfully updated to version ${manifest.version}`);
        } catch (err) {
          console.error(`[Update] Failed update attempt ${attempts}:`, err.message);
          if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
          if (attempts >= 3) {
            if (patcher.verifyExtraction()) {
              console.warn('[Update] Update failed, falling back to existing operational version.');
              break;
            }
            throw new Error(`Failed to download and verify update payload after 3 attempts: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!patcher.verifyExtraction()) {
      throw new Error('Critical startup scripts are missing. App cannot boot.');
    }

    serviceManager.credentialManager.loadCredentials();

    await updateStatus('Starting backend services...');
    await serviceManager.startService('player', 'player');
    await serviceManager.startService('stream-api', 'stream-api');
    await serviceManager.startService('live-api-streampk', 'live-api-streampk');

    await updateStatus('Connecting...');
    await serviceManager.waitForPort(3000);
    await serviceManager.waitForPort(7860);
    await serviceManager.waitForPort(5000);

    const frontendDir = path.join(APPDATA_DIR, 'frontend');
    expressApp = express();
    expressApp.use(express.static(frontendDir));
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });

    const FRONTEND_PORT = 4890;
    expressServer = expressApp.listen(FRONTEND_PORT, () => {
      console.log(`[Main] Frontend served locally on http://localhost:${FRONTEND_PORT}`);
      mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
    });

  } catch (error) {
    console.error('[Main] Startup sequence aborted:', error);
    if (serviceManager) {
      await serviceManager.stopAll().catch(() => { });
    }
    handleFatalError(error.message);
  }
}

if (gotLock) {
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', async () => {
  if (expressServer) expressServer.close();
  if (serviceManager) {
    await serviceManager.stopAll();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});