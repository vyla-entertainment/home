const fs = require('fs');
const path = require('path');
const CryptoUtils = require('./crypto-utils');

class CredentialManager {
  constructor(appDataPath) {
    this.appDataPath = appDataPath;
    this.credentialsPath = path.join(appDataPath, 'vyla-credentials-store.json');
    this.machineKey = CryptoUtils.getMachineKey(appDataPath);
    this.encryptionKey = CryptoUtils.deriveKey(this.machineKey);
    this.credentials = {};
  }

  loadCredentials() {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const encryptedData = fs.readFileSync(this.credentialsPath, 'utf8');
        this.credentials = CryptoUtils.decryptObject(encryptedData, this.encryptionKey);
      } else {
        this.credentials = {};
      }
    } catch (error) {
      this.credentials = {};
    }
  }

  saveCredentials() {
    try {
      const encryptedData = CryptoUtils.encryptObject(this.credentials, this.encryptionKey);
      fs.writeFileSync(this.credentialsPath, encryptedData, 'utf8');
    } catch (error) {
      throw error;
    }
  }

  getCredential(service, key) {
    if (!this.credentials[service]) {
      return null;
    }
    return this.credentials[service][key] || null;
  }

  setCredential(service, key, value) {
    if (!this.credentials[service]) {
      this.credentials[service] = {};
    }
    this.credentials[service][key] = value;
    this.saveCredentials();
  }

  getServiceCredentials(service) {
    return this.credentials[service] || {};
  }

  setServiceCredentials(service, credentials) {
    this.credentials[service] = { ...credentials };
    this.saveCredentials();
  }

  hasServiceCredentials(service) {
    return !!this.credentials[service] && Object.keys(this.credentials[service]).length > 0;
  }

  deleteServiceCredentials(service) {
    delete this.credentials[service];
    this.saveCredentials();
  }

  initializeFromConfig(config) {
    let initialized = false;
    for (const [service, keys] of Object.entries(config)) {
      if (!this.hasServiceCredentials(service)) {
        this.setServiceCredentials(service, keys);
        initialized = true;
      }
    }
    return initialized;
  }

  getAllEnvVars() {
    const envVars = {};
    for (const [service, credentials] of Object.entries(this.credentials)) {
      envVars[service] = { ...credentials };
    }
    return envVars;
  }

  verifyIntegrity() {
    try {
      if (!fs.existsSync(this.credentialsPath)) {
        return false;
      }
      const encryptedData = fs.readFileSync(this.credentialsPath, 'utf8');
      CryptoUtils.decryptObject(encryptedData, this.encryptionKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  resetCredentials() {
    this.credentials = {};
    if (fs.existsSync(this.credentialsPath)) {
      fs.unlinkSync(this.credentialsPath);
    }
  }
}

module.exports = CredentialManager;