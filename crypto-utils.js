const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

class CryptoUtils {
  static getMachineKey(cacheDir) {
    if (this._cachedMachineKey) {
      return this._cachedMachineKey;
    }

    const cachePath = cacheDir ? require('path').join(cacheDir, '.machine-key-cache') : null;
    if (cachePath && require('fs').existsSync(cachePath)) {
      try {
        const cached = require('fs').readFileSync(cachePath, 'utf8').trim();
        if (cached) {
          this._cachedMachineKey = cached;
          return cached;
        }
      } catch (e) {
      }
    }

    let key;
    try {
      const machineId = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0].model,
        this.getMachineId(),
        process.env.COMPUTERNAME || '',
        process.env.USERNAME || ''
      ].join('|');

      const hash = crypto.createHash('sha256');
      hash.update(machineId);
      key = hash.digest('hex');
    } catch (error) {
      const fallback = crypto.createHash('sha256');
      fallback.update(os.hostname() + Date.now());
      key = fallback.digest('hex');
    }

    this._cachedMachineKey = key;
    if (cachePath) {
      try {
        require('fs').writeFileSync(cachePath, key, 'utf8');
      } catch (e) {
      }
    }
    return key;
  }

  static getMachineId() {
    try {
      if (os.platform() === 'win32') {
        return execSync('wmic csproduct get uuid').toString().split('\n')[1].trim();
      } else if (os.platform() === 'darwin') {
        return execSync('ioreg -rd1 -c IOPlatformExpertDevice | awk -F\'"\' \'/IOPlatformUUID/{print $4}\'').toString().trim();
      } else {
        return execSync('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null').toString().trim();
      }
    } catch (error) {
      return 'unknown-machine';
    }
  }

  static deriveKey(machineKey, salt = 'vyla-home-salt') {
    const hash = crypto.createHash('sha256');
    hash.update(machineKey + salt);
    return hash.digest();
  }

  static encrypt(plaintext, key) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  static decrypt(encryptedData, key) {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  static encryptObject(obj, key) {
    const json = JSON.stringify(obj);
    return this.encrypt(json, key);
  }

  static decryptObject(encryptedData, key) {
    const json = this.decrypt(encryptedData, key);
    return JSON.parse(json);
  }

  static hashData(data) {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  static verifyHash(data, expectedHash) {
    const actualHash = this.hashData(data);
    return actualHash === expectedHash;
  }
}

module.exports = CryptoUtils;