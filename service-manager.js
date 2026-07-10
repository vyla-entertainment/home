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
    this.processes = {};
    this.restartCounts = {};
    this.stableTimers = {};
    this.isStopping = false;

    this.logsDir = path.join(appDataPath, 'logs');
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  logToFile(name, line) {
    try {
      const logPath = path.join(this.logsDir, `${name}.log`);
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] ${line}\n`, 'utf8');
    } catch (e) {
    }
  }

  async startService(name, relativeDir, startScript = 'server.js') {
    if (this.processes[name]) {
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
      ...(this.credentialManager.getServiceCredentials(name) || {}),
      ELECTRON_RUN_AS_NODE: '1'
    };

    this.logToFile(name, `--- Starting ${name} in ${serviceDir} ---`);

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

    if (this.stableTimers[name]) {
      clearTimeout(this.stableTimers[name]);
    }
    this.stableTimers[name] = setTimeout(() => {
      this.restartCounts[name] = 0;
    }, 60000);

    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      this.logToFile(name, `STDOUT: ${text}`);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      this.logToFile(name, `STDERR: ${text}`);
    });

    child.on('exit', (code, signal) => {
      this.logToFile(name, `EXITED: code=${code} signal=${signal}`);
      this.processes[name] = null;

      if (this.stableTimers[name]) {
        clearTimeout(this.stableTimers[name]);
        this.stableTimers[name] = null;
      }

      if (!this.isStopping) {
        this.restartCounts[name] = (this.restartCounts[name] || 0) + 1;
        if (this.restartCounts[name] > 5) {
          this.logToFile(name, `Crashed too many times, giving up.`);
          return;
        }
        setTimeout(() => {
          this.startService(name, relativeDir, startScript).catch(err => {
            this.logToFile(name, `Failed to restart: ${err.message}`);
          });
        }, 3000);
      }
    });
  }

  async startServices(services) {
    await Promise.all(services.map(({ name, relativeDir, startScript }) =>
      this.startService(name, relativeDir, startScript)
    ));
  }

  async waitForPorts(ports, timeoutMs = 30000) {
    await Promise.all(ports.map((port) => this.waitForPort(port, timeoutMs)));
  }

  async stopAll() {
    this.isStopping = true;
    for (const name of Object.keys(this.stableTimers)) {
      if (this.stableTimers[name]) {
        clearTimeout(this.stableTimers[name]);
      }
    }
    this.stableTimers = {};
    const killPromises = Object.keys(this.processes).map((name) => {
      const procInfo = this.processes[name];
      if (procInfo && procInfo.child) {
        this.logToFile(name, `Killing service`);
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