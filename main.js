const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const ServiceManager = require('./service-manager');
const CredentialManager = require('./credential-manager');
const GitHubClient = require('./github-client');
const { applyPatches } = require('./patcher');

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

  const credentialManager = new CredentialManager(APPDATA_DIR);
  credentialManager.loadCredentials();
  const githubClient = new GitHubClient(APPDATA_DIR, credentialManager);
  serviceManager = new ServiceManager(APPDATA_DIR, envConfig);

  const updateStatus = async (statusText) => {
    await mainWindow.webContents.executeJavaScript(`
      const el = document.getElementById('status');
      if (el) el.innerText = ${JSON.stringify(statusText)};
    `).catch(() => { });
  };

  const promptForToken = () => {
    return new Promise((resolve) => {
      ipcMain.removeAllListeners('token-submit');
      ipcMain.once('token-submit', (event, token) => {
        resolve(token);
      });

      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GitHub Access Required</title>
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
  width: 100%;
}

.icon {
  width: 38px;
  height: 38px;
  margin: 0 auto 22px;
  color: rgba(255,255,255,.85);
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.02em;
}

p {
  margin: 14px 0 24px;
  color: rgba(255,255,255,.55);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

input {
  width: 100%;
  appearance: none;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 10px;
  background: rgba(255,255,255,.06);
  color: #fff;
  padding: 12px 14px;
  font-size: 13px;
  font-family: inherit;
  margin-bottom: 16px;
  outline: none;
}

input:focus {
  border-color: rgba(255,255,255,.4);
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

#error {
  margin-top: 12px;
  color: #ff453a;
  font-size: 12px;
  min-height: 16px;
}
</style>
</head>
<body>

<div class="container">
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 2C6.48 2 2 6.58 2 12.253c0 4.537 2.865 8.383 6.839 9.741.5.094.682-.223.682-.494 0-.243-.009-.888-.014-1.744-2.782.62-3.369-1.373-3.369-1.373-.454-1.176-1.11-1.489-1.11-1.489-.908-.632.069-.619.069-.619 1.003.072 1.531 1.049 1.531 1.049.892 1.573 2.341 1.119 2.91.856.092-.665.35-1.119.636-1.377-2.221-.259-4.556-1.138-4.556-5.062 0-1.118.39-2.033 1.029-2.75-.103-.259-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.05a9.29 9.29 0 0 1 2.5-.345c.849.004 1.704.117 2.5.345 1.909-1.326 2.747-1.05 2.747-1.05.546 1.412.202 2.455.1 2.714.64.717 1.028 1.632 1.028 2.75 0 3.934-2.339 4.8-4.566 5.054.359.316.678.94.678 1.894 0 1.368-.012 2.471-.012 2.808 0 .273.18.593.688.492A10.03 10.03 0 0 0 22 12.253C22 6.58 17.52 2 12 2z"/>
  </svg>

  <h1>GitHub Access Required</h1>

  <p>Vyla Home needs a GitHub token to clone the private repos it runs on.\nThis is stored locally and encrypted, never sent anywhere else.</p>

  <input id="token" type="password" placeholder="ghp_..." autocomplete="off" spellcheck="false" />

  <button onclick="submitToken()">
    Continue
  </button>

  <div id="error"></div>
</div>

<script>
function submitToken() {
  const value = document.getElementById('token').value.trim();
  if (!value) {
    document.getElementById('error').innerText = 'Enter a token to continue.';
    return;
  }
  window.vylaHome.sendToken(value);
}

document.getElementById('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitToken();
});
</script>

</body>
</html>
`));
    });
  };

  const showUpdatePrompt = (outdatedRepos) => {
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
  border-radius: 999px;
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

.primary {
  background: #fff;
  color: #000;
}

.secondary {
  background: rgba(255,255,255,.12);
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

  <p>New changes are available for: ${outdatedRepos.join(', ')}.\nInstalling will pull the latest code and reinstall dependencies.</p>

  <div class="buttons">
    <button class="secondary" onclick="window.vylaHome.sendUpdateChoice('skip')">
      Skip For Now
    </button>
    <button class="primary" onclick="window.vylaHome.sendUpdateChoice('install')">
      Install Update
    </button>
  </div>
</div>

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

  try {
    const isFirstRun = !githubClient.allReposCloned();

    if (isFirstRun && !githubClient.hasToken()) {
      await updateStatus('Waiting for GitHub token...');
      const token = await promptForToken();
      githubClient.setToken(token);
    }

    if (isFirstRun) {
      await updateStatus('Cloning repositories...');
      githubClient.cloneAll((msg) => updateStatus(msg));

      await updateStatus('Installing dependencies...');
      githubClient.installAllDependencies((msg) => updateStatus(msg));

      await updateStatus('Applying local configuration...');
      applyPatches(APPDATA_DIR, replacementsConfig);
    } else {
      await updateStatus('Checking for updates...');
      const outdatedRepos = githubClient.checkForUpdates();

      if (outdatedRepos.length > 0) {
        const choice = await showUpdatePrompt(outdatedRepos);
        if (choice === 'install') {
          await updateStatus('Installing update...');
          githubClient.updateAll(outdatedRepos, (msg) => updateStatus(msg));
          applyPatches(APPDATA_DIR, replacementsConfig);
        }
      }
    }

    if (!githubClient.allReposCloned()) {
      throw new Error('Repository setup incomplete. Check your internet connection and GitHub token, then try again.');
    }

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