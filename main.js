const { app, BrowserWindow, ipcMain, Menu } = require('electron');
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
  const asciiLogo = fs.readFileSync(path.join(__dirname, 'build', 'logo.txt'), 'utf8');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Vyla Home',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 40
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);

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
  overflow: hidden;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

body {
  -webkit-app-region: no-drag;
}

.titlebar-drag {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  -webkit-app-region: drag;
  z-index: 10;
}

button, a, input, .no-drag {
  -webkit-app-region: no-drag;
}

canvas {
  position: fixed;
  inset: 0;
  display: block;
  width: 100vw;
  height: 100vh;
}

.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  pointer-events: none;
}

#ascii-logo {
  font-family: "Cascadia Mono", "Consolas", monospace;
  font-size: 11px;
  line-height: 1.15;
  color: rgba(255,255,255,.75);
  white-space: pre;
  margin: 0;
  user-select: none;
  text-shadow: 0 4px 12px rgba(0,0,0,.6);
  transform: scale(0.4);
  opacity: 0;
  animation: logoIn 1.1s cubic-bezier(.16,1,.3,1) forwards;
}

#status {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(255,255,255,.4);
  opacity: 0;
  animation: statusIn .6s ease forwards .7s;
}

@keyframes logoIn {
  0% {
    transform: scale(0.4);
    opacity: 0;
    filter: blur(6px);
  }
  60% {
    opacity: 1;
    filter: blur(0);
  }
  100% {
    transform: scale(1);
    opacity: 1;
    filter: blur(0);
  }
}

@keyframes statusIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
</head>
<body>

<div class="titlebar-drag"></div>
<canvas id="c"></canvas>

<div class="overlay">
  <pre id="ascii-logo">${asciiLogo.replace(/`/g, '\\`').replace(/\$/g, '\\$')}</pre>
</div>

<script>
const CHARS = ' .:-=+*#%@';
const FONT_SIZE = 50;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let CW, CH;
let cols, rows;
let t = 0;

let mouseX = -9999;
let mouseY = -9999;
let lastMouseMove = 0;
let mouseStrength = 0;

const FADE_TIME = 250;
const SMOOTHING = 0.08;

function initFont() {
  ctx.font = FONT_SIZE + 'px "Courier New", monospace';
  CW = Math.ceil(ctx.measureText('M').width);
  CH = FONT_SIZE + 2;
  ctx.textBaseline = 'top';
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initFont();
  cols = Math.ceil(canvas.width / CW) + 1;
  rows = Math.ceil(canvas.height / CH) + 1;
}

window.addEventListener('resize', resize);

window.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  lastMouseMove = performance.now();
});

function plasma(cx, cy, tt) {
  const x = cx + Math.sin(cy * 3 + tt * 0.7) * 0.07;
  const y = cy + Math.cos(cx * 3 + tt * 0.5) * 0.07;

  let v =
    Math.sin(x * 10 + tt) +
    Math.sin(y * 10 + tt) +
    Math.sin((x + y) * 7 + tt) +
    Math.sin(Math.sqrt(x * x + y * y) * 12 - tt * 1.2) +
    Math.sin(x * 6 - tt * 0.8) +
    Math.sin(y * 8 + tt * 0.9);

  return (v / 6 + 1) / 2;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  t += 0.03;

  const elapsed = performance.now() - lastMouseMove;
  const targetStrength = Math.max(0, 1 - elapsed / FADE_TIME);
  mouseStrength += (targetStrength - mouseStrength) * SMOOTHING;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * CW;
      const y = row * CH;
      const dx = x - mouseX;
      const dy = y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = (7000 / (dist * dist + 1500)) * mouseStrength;
      const offsetX = dx * force;
      const offsetY = dy * force;

      const v = plasma(col / cols, row / rows, t);
      const brightness = Math.round(v * 60);
      const charIdx = Math.floor(v * (CHARS.length - 0.001));
      const ch = CHARS[charIdx];

      ctx.fillStyle = 'rgb(' + brightness + ',' + brightness + ',' + brightness + ')';
      ctx.fillText(ch, x + offsetX, y + offsetY);
    }
  }

  requestAnimationFrame(render);
}

resize();
render();
</script>

</body>
</html>
`));

  const patcher = new Patcher(APPDATA_DIR);
  serviceManager = new ServiceManager(APPDATA_DIR, envConfig);

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
        await updateClient.downloadUpdate(release, tempZipPath, (downloaded, total) => {
          const percent = Math.round((downloaded / total) * 100);
        });

        if (!patcher.verifyChecksum(tempZipPath, release.sha256)) {
          throw new Error('SHA-256 checksum verification failed.');
        }

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
      } catch (err) {
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

    const release = await updateClient.checkForUpdates();

    if (isFirstRun) {
      await installBuild(release);
    } else if (release.version !== localVersion) {
      const choice = await showUpdatePrompt(localVersion, release.version);
      if (choice === 'install') {
        await installBuild(release);
      }
    }

    if (!patcher.verifyExtraction()) {
      throw new Error('No application files found. Check your internet connection and try again.');
    }

    serviceManager.credentialManager.loadCredentials();

    await serviceManager.startService('player', 'player');
    await serviceManager.startService('stream-api', 'stream-api');
    await serviceManager.startService('live-api-streampk', 'live-api-streampk');

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
      mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
    });

  } catch (error) {
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