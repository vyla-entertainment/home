const https = require('https');
const fs = require('fs');

const GITHUB_ORG = 'vyla-entertainment';
const GITHUB_REPO = 'home';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_ORG}/${GITHUB_REPO}/releases/latest`;

class UpdateClient {
  constructor(appDataPath) {
    this.appDataPath = appDataPath;
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'VylaHome-Client',
          'Accept': 'application/vnd.github+json'
        }
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
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

      req.end();
    });
  }

  downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl, redirectCount) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const urlObj = new URL(requestUrl);
        const requestOptions = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'VylaHome-Client',
            'Accept': 'application/octet-stream'
          }
        };

        const req = https.get(requestOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            doRequest(res.headers.location, redirectCount + 1);
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
      };

      doRequest(url, 0);
    });
  }

  async fetchAssetJson(url) {
    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl, redirectCount) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const urlObj = new URL(requestUrl);
        const requestOptions = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'VylaHome-Client',
            'Accept': 'application/octet-stream'
          }
        };

        const req = https.get(requestOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            return;
          }

          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON in manifest asset'));
            }
          });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      };

      doRequest(url, 0);
    });
  }

  async checkForUpdates() {
    const release = await this.fetchJson(RELEASES_API);

    const payloadAsset = (release.assets || []).find(a => a.name === 'update-payload.zip');
    const manifestAsset = (release.assets || []).find(a => a.name === 'manifest.json');

    if (!payloadAsset) {
      throw new Error('No update-payload.zip asset found on latest release.');
    }

    let sha256 = null;
    if (manifestAsset) {
      const manifest = await this.fetchAssetJson(manifestAsset.browser_download_url);
      sha256 = manifest.sha256 || null;
    }

    return {
      version: release.tag_name,
      url: payloadAsset.browser_download_url,
      sha256
    };
  }

  async downloadUpdate(release, destPath, onProgress) {
    await this.downloadFile(release.url, destPath, onProgress);
    return destPath;
  }
}

module.exports = UpdateClient;