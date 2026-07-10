const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
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

const updateClient = new UpdateClient(APPDATA_DIR);

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Vyla Home',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
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
  gap: 22px;
  user-select: none;
}

.spinner {
  width: 40px;
  height: 40px;
}

#status {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .02em;
  text-transform: uppercase;
  color: rgba(255,255,255,.4);
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
  <svg class="spinner" fill="#fff" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" rx="1" width="10" height="10"><animate id="spinner_c7A9" begin="0;spinner_23zP.end" attributeName="x" dur="0.2s" values="1;13" fill="freeze"/><animate id="spinner_Acnw" begin="spinner_ZmWi.end" attributeName="y" dur="0.2s" values="1;13" fill="freeze"/><animate id="spinner_iIcm" begin="spinner_zfQN.end" attributeName="x" dur="0.2s" values="13;1" fill="freeze"/><animate id="spinner_WX4U" begin="spinner_rRAc.end" attributeName="y" dur="0.2s" values="13;1" fill="freeze"/></rect><rect x="1" y="13" rx="1" width="10" height="10"><animate id="spinner_YLx7" begin="spinner_c7A9.end" attributeName="y" dur="0.2s" values="13;1" fill="freeze"/><animate id="spinner_vwnJ" begin="spinner_Acnw.end" attributeName="x" dur="0.2s" values="1;13" fill="freeze"/><animate id="spinner_KQuy" begin="spinner_iIcm.end" attributeName="y" dur="0.2s" values="1;13" fill="freeze"/><animate id="spinner_arKy" begin="spinner_WX4U.end" attributeName="x" dur="0.2s" values="13;1" fill="freeze"/></rect><rect x="13" y="13" rx="1" width="10" height="10"><animate id="spinner_ZmWi" begin="spinner_YLx7.end" attributeName="x" dur="0.2s" values="13;1" fill="freeze"/><animate id="spinner_zfQN" begin="spinner_vwnJ.end" attributeName="y" dur="0.2s" values="13;1" fill="freeze"/><animate id="spinner_rRAc" begin="spinner_KQuy.end" attributeName="x" dur="0.2s" values="1;13" fill="freeze"/><animate id="spinner_23zP" begin="spinner_arKy.end" attributeName="y" dur="0.2s" values="1;13" fill="freeze"/></rect></svg>
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

  const showUpdatePrompt = (currentVersion, newVersion) => {
    return new Promise((resolve) => {
      ipcMain.removeAllListeners('update-choice');
      ipcMain.once('update-choice', (event, choice) => {
        resolve(choice);
      });

      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Update Available</title>
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
  color: #0a84ff;
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

.buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
}

button {
  appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 11px 20px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity .15s ease, transform .15s ease;
  min-width: 120px;
}

button:hover:not(:disabled) {
  opacity: .85;
}

button:active:not(:disabled) {
  transform: scale(.97);
}

button:disabled {
  cursor: default;
  opacity: .35;
}

.primary {
  background: #fff;
  color: #000;
}

.secondary {
  background: rgba(255,255,255,.1);
  color: #fff;
}
</style>
</head>
<body>

<div class="container">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>

  <h1>Update Available</h1>

  <p>You're running version ${currentVersion}. Version ${newVersion} is available.\nInstalling will fetch the latest build.</p>

<div class="buttons">
  <button id="skipBtn" class="secondary" onclick="handleChoice('skip')">
    Skip For Now
  </button>
  <button id="installBtn" class="primary" onclick="handleChoice('install')">
    Install Update
  </button>
</div>

<script>
function handleChoice(choice) {
  document.getElementById('skipBtn').disabled = true;
  document.getElementById('installBtn').disabled = true;
  window.vylaHome.sendUpdateChoice(choice);
}
</script>

</body>
</html>
`));
    });
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

  const installBuild = async (release) => {
    const tempZipPath = path.join(APPDATA_DIR, 'download-temp.zip');
    let attempts = 0;
    let downloadSuccess = false;

    while (attempts < 3 && !downloadSuccess) {
      attempts++;
      try {
        await updateStatus(`Downloading version ${release.version} (Attempt ${attempts}/3)...`);
        await updateClient.downloadUpdate(release, tempZipPath, (downloaded, total) => {
          const percent = Math.round((downloaded / total) * 100);
          console.log(`[Update] Download progress: ${percent}%`);
        });

        await updateStatus('Verifying checksum...');
        if (!patcher.verifyChecksum(tempZipPath, release.sha256)) {
          throw new Error('SHA-256 checksum verification failed.');
        }

        await updateStatus('Extracting application files...');
        patcher.purgeOldCode();
        patcher.extractZipPayload(tempZipPath);

        if (!patcher.verifyExtraction()) {
          throw new Error('Extraction verification failed: critical startup files missing.');
        }

        patcher.applyPatches(replacementsConfig);
        patcher.bridgeCredentials(serviceManager.credentialManager);
        patcher.saveCurrentVersion(release.version);

        fs.unlinkSync(tempZipPath);
        downloadSuccess = true;
        console.log(`[Update] Successfully installed version ${release.version}`);
      } catch (err) {
        console.error(`[Update] Failed install attempt ${attempts}:`, err.message);
        if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
        if (attempts >= 3) {
          throw new Error(`Failed to download and verify build after 3 attempts: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  };

  try {
    const isFirstRun = !patcher.verifyExtraction();
    const localVersion = patcher.getCurrentVersion();

    await updateStatus('Checking for the latest version...');
    const release = await updateClient.checkForUpdates();

    if (isFirstRun) {
      await updateStatus('Setting up Vyla Home for the first time...');
      await installBuild(release);
    } else if (release.version !== localVersion) {
      const choice = await showUpdatePrompt(localVersion, release.version);
      if (choice === 'install') {
        await updateStatus('Installing update...');
        await installBuild(release);
      }
    }

    if (!patcher.verifyExtraction()) {
      throw new Error('No application files found. Check your internet connection and try again.');
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