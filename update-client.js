const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class UpdateClient {
  constructor(config, appDataPath) {
    this.config = config;
    this.appDataPath = appDataPath;
    this.apiKey = this.getApiKey();
    this.licenseKey = this.getLicenseKey();
  }

  getApiKey() {
    return process.env.VYLA_UPDATE_API_KEY || this.config.apiKey || null;
  }

  getLicenseKey() {
    const licensePath = path.join(this.appDataPath, 'license.key');
    if (fs.existsSync(licensePath)) {
      return fs.readFileSync(licensePath, 'utf8').trim();
    }
    return null;
  }

  setLicenseKey(licenseKey) {
    const licensePath = path.join(this.appDataPath, 'license.key');
    fs.writeFileSync(licensePath, licenseKey, 'utf8');
    this.licenseKey = licenseKey;
  }

  getAuthHeaders() {
    const headers = {
      'User-Agent': 'VylaHome-Client',
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    if (this.licenseKey) {
      headers['X-License-Key'] = this.licenseKey;
      const timestamp = Date.now().toString();
      const signature = this.generateSignature(this.licenseKey, timestamp);
      headers['X-Timestamp'] = timestamp;
      headers['X-Signature'] = signature;
    }

    return headers;
  }

  generateSignature(key, timestamp) {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(timestamp);
    return hmac.digest('hex');
  }

  fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
      const headers = {
        ...this.getAuthHeaders(),
        ...options.headers
      };

      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401) {
            reject(new Error('Authentication failed. Invalid API key or license.'));
            return;
          }
          if (res.statusCode === 403) {
            reject(new Error('Access denied. License may be expired or invalid.'));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const headers = this.getAuthHeaders();
      const urlObj = new URL(url);

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers
      };

      const req = https.get(requestOptions, (res) => {
        if (res.statusCode === 401) {
          reject(new Error('Authentication failed. Invalid API key or license.'));
          return;
        }
        if (res.statusCode === 403) {
          reject(new Error('Access denied. License may be expired or invalid.'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'], 10);
        let downloadedSize = 0;

        const file = fs.createWriteStream(destPath);
        res.pipe(file);

        res.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize) {
            onProgress(downloadedSize, totalSize);
          }
        });

        file.on('finish', () => {
          file.close(resolve);
        });

        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });

      req.setTimeout(120000, () => {
        req.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error('Download timeout'));
      });
    });
  }

  async checkForUpdates() {
    try {
      console.log('[UpdateClient] Checking for updates...');
      const manifest = await this.fetchJson(this.config.manifestUrl);
      console.log('[UpdateClient] Latest version:', manifest.version);
      return manifest;
    } catch (error) {
      console.error('[UpdateClient] Update check failed:', error.message);
      throw error;
    }
  }

  async downloadUpdate(manifest, destPath, onProgress) {
    try {
      console.log('[UpdateClient] Downloading update...');
      const downloadUrl = manifest.url || this.config.payloadUrl;
      await this.downloadFile(downloadUrl, destPath, onProgress);
      console.log('[UpdateClient] Download completed');
      return destPath;
    } catch (error) {
      console.error('[UpdateClient] Download failed:', error.message);
      throw error;
    }
  }

  verifyLicense(licenseKey) {
    return this.fetchJson(this.config.licenseVerifyUrl, {
      method: 'POST',
      body: { licenseKey }
    });
  }
}

module.exports = UpdateClient;