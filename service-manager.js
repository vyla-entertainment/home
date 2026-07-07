const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const CredentialManager = require('./credential-manager');

class ServiceManager {
  constructor(appDataPath, envConfig) {
    this.appDataPath = appDataPath;
    this.envConfig = envConfig;
    this.credentialManager = new CredentialManager(appDataPath);
    this.credentialManager.loadCredentials();
    this.processes = {};
    this.isStopping = false;
  }

  async startService(name, relativeDir, startScript = 'server.js') {
    if (this.processes[name]) {
      console.log(`[ServiceManager] Service "${name}" is already running.`);
      return;
    }

    const serviceDir = path.join(this.appDataPath, relativeDir);
    const scriptPath = path.join(serviceDir, startScript);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Service script not found: ${scriptPath}`);
    }

    const env = {
      ...process.env,
      ...(this.envConfig[name] || {}),
      ...(this.credentialManager.getServiceCredentials(name) || {})
    };

    console.log(`[ServiceManager] Starting ${name} in ${serviceDir}...`);

    const child = spawn(process.execPath, [scriptPath], {
      cwd: serviceDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.processes[name] = {
      child,
      relativeDir,
      startScript,
      status: 'starting'
    };

    child.stdout.on('data', (data) => {
      console.log(`[${name} STDOUT]: ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[${name} STDERR]: ${data.toString().trim()}`);
    });

    child.on('exit', (code, signal) => {
      console.log(`[ServiceManager] Service "${name}" exited with code ${code}, signal ${signal}`);
      this.processes[name] = null;

      if (!this.isStopping) {
        console.log(`[ServiceManager] Restarting crashed service "${name}" in 3 seconds...`);
        setTimeout(() => {
          this.startService(name, relativeDir, startScript).catch(err => {
            console.error(`[ServiceManager] Failed to restart service "${name}":`, err);
          });
        }, 3000);
      }
    });
  }

  async stopAll() {
    this.isStopping = true;
    const killPromises = Object.keys(this.processes).map((name) => {
      const procInfo = this.processes[name];
      if (procInfo && procInfo.child) {
        console.log(`[ServiceManager] Killing service "${name}"`);
        return new Promise((resolve) => {
          procInfo.child.removeAllListeners('exit');
          procInfo.child.on('exit', () => resolve());
          procInfo.child.kill();
        });
      }
      return Promise.resolve();
    });

    await Promise.all(killPromises);
    this.processes = {};
    console.log('[ServiceManager] All services stopped.');
  }

  async waitForPort(port, timeoutMs = 30000) {
    const start = Date.now();
    const net = require('net');

    while (Date.now() - start < timeoutMs) {
      if (this.isStopping) return false;
      const connected = await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, '127.0.0.1');
      });

      if (connected) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Timeout waiting for port ${port}`);
  }

  async checkHealth(port, path = '/', timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isStopping) return false;
      const ok = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 1000 }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Health check failed on port ${port} path ${path}`);
  }
}

module.exports = ServiceManager;
