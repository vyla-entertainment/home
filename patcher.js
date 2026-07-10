const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const CryptoUtils = require('./crypto-utils');

class Patcher {
  constructor(appDataPath) {
    this.appDataPath = appDataPath;
  }

  getCurrentVersion() {
    const versionFile = path.join(this.appDataPath, 'version.json');
    if (fs.existsSync(versionFile)) {
      try {
        return JSON.parse(fs.readFileSync(versionFile, 'utf8')).version;
      } catch (e) {
        return '0.0.0';
      }
    }
    return '0.0.0';
  }

  bridgeCredentials(credentialManager) {
    const encryptedPath = path.join(this.appDataPath, 'encrypted-credentials.json');
    if (!fs.existsSync(encryptedPath)) {
      return false;
    }

    const buildKey = CryptoUtils.deriveKey('vyla-home-build-key', 'vyla-home-payload-salt-v1');
    const encryptedData = fs.readFileSync(encryptedPath, 'utf8');
    const credentials = CryptoUtils.decryptObject(encryptedData, buildKey);

    for (const [service, keys] of Object.entries(credentials)) {
      credentialManager.setServiceCredentials(service, keys);
    }

    fs.unlinkSync(encryptedPath);
    return true;
  }

  saveCurrentVersion(version) {
    const versionFile = path.join(this.appDataPath, 'version.json');
    fs.mkdirSync(this.appDataPath, { recursive: true });
    fs.writeFileSync(versionFile, JSON.stringify({ version }, null, 2), 'utf8');
  }

  purgeOldCode() {
    const dirs = ['frontend', 'player', 'stream-api', 'live-api-streampk'];
    for (const dir of dirs) {
      const fullPath = path.join(this.appDataPath, dir);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  extractZipPayload(zipPath) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(this.appDataPath, true);
  }

  verifyChecksum(zipPath, expectedSha256) {
    if (!expectedSha256) return true;
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(zipPath);
    hash.update(data);
    const calculated = hash.digest('hex');
    return calculated === expectedSha256;
  }

  verifyExtraction() {
    const requiredFiles = [
      'player/server.js',
      'stream-api/server.js',
      'live-api-streampk/server.js',
      'frontend/index.html'
    ];
    for (const file of requiredFiles) {
      const fullPath = path.join(this.appDataPath, file);
      if (!fs.existsSync(fullPath)) {
        return false;
      }
      const stat = fs.statSync(fullPath);
      if (stat.size === 0) {
        return false;
      }
      const buffer = fs.readFileSync(fullPath);
      if (buffer.every(byte => byte === 0)) {
        return false;
      }
    }
    return true;
  }

  processDirectory(dir, replacementList) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (file === 'node_modules' || file === '.git') continue;
        this.processDirectory(fullPath, replacementList);
      } else if (stat.isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        if (['.js', '.html', '.css', '.json', '.xml', '.txt'].includes(ext)) {
          let content = fs.readFileSync(fullPath, 'utf8');
          let modified = false;

          for (const rep of replacementList) {
            if (content.includes(rep.find)) {
              content = content.split(rep.find).join(rep.replace);
              modified = true;
            }
          }

          if (modified) {
            fs.writeFileSync(fullPath, content, 'utf8');
          }
        }
      }
    }
  }

  applyPatches(replacements) {
    for (const [componentName, replacementList] of Object.entries(replacements)) {
      if (!replacementList || replacementList.length === 0) continue;

      const componentDir = path.join(this.appDataPath, componentName);
      if (!fs.existsSync(componentDir)) continue;

      this.processDirectory(componentDir, replacementList);
    }
  }
}

module.exports = Patcher;