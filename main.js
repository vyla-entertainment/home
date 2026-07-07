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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <html>
      <head>
        <title>Vyla Home</title>
        <style>
          body {
            background: #000000;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
          }
          .loader {
            text-align: center;
          }
          .spinner {
            border: 2px solid rgba(255,255,255,0.1);
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border-left-color: #ffffff;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 16px;
          }
          #status {
            font-size: 13px;
            color: #888888;
            letter-spacing: 0.05em;
            text-transform: uppercase;
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="loader">
          <div class="spinner"></div>
          <div id="status">Connecting...</div>
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
      <body style="background:#111;color:#f33;font-family:sans-serif;padding:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;">
        <h2 style="margin-bottom:10px;">Startup Failure</h2>
        <p style="color:#aaa;max-width:600px;text-align:center;margin-bottom:20px;">${errMessage}</p>
        <button onclick="window.location.reload()" style="background:#f33;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-weight:bold;">Retry Boot</button>
      </body>
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