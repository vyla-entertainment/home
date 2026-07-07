const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class IntegrityVerifier {
  constructor() {
    this.appPath = path.dirname(process.execPath);
    this.resourcesPath = process.resourcesPath || this.appPath;
  }

  verifyAppIntegrity(expectedHashes) {
    console.log('[Integrity] Starting application integrity check...');

    const results = {
      valid: true,
      verifiedFiles: [],
      failedFiles: [],
      missingFiles: []
    };

    for (const [filePath, expectedHash] of Object.entries(expectedHashes)) {
      const fullPath = path.join(this.resourcesPath, filePath);

      if (!fs.existsSync(fullPath)) {
        results.valid = false;
        results.missingFiles.push(filePath);
        console.error(`[Integrity] Missing critical file: ${filePath}`);
        continue;
      }

      const actualHash = this.hashFile(fullPath);
      if (actualHash !== expectedHash) {
        results.valid = false;
        results.failedFiles.push({ filePath, expected: expectedHash, actual: actualHash });
        console.error(`[Integrity] Hash mismatch for ${filePath}`);
      } else {
        results.verifiedFiles.push(filePath);
        console.log(`[Integrity] Verified: ${filePath}`);
      }
    }

    return results;
  }

  hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest('hex');
  }

  generateDirectoryHashes(dirPath, relativePath = '') {
    const hashes = {};

    if (!fs.existsSync(dirPath)) {
      return hashes;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      const relativeFilePath = path.join(relativePath, file).replace(/\\/g, '/');

      if (stat.isDirectory()) {
        if (file === 'node_modules' || file === '.git') continue;
        Object.assign(hashes, this.generateDirectoryHashes(fullPath, relativeFilePath));
      } else {
        hashes[relativeFilePath] = this.hashFile(fullPath);
      }
    }

    return hashes;
  }

  verifyWindowsSignature() {
    if (process.platform !== 'win32') {
      return { valid: true, message: 'Not Windows, skipping signature check' };
    }

    try {
      const { execSync } = require('child_process');
      const command = `Get-AuthenticodeSignature "${process.execPath}" | Select-Object -ExpandProperty Status`;
      const result = execSync(`powershell -Command "${command}"`, { encoding: 'utf8' }).trim();

      const isValid = result === 'Valid';
      return {
        valid: isValid,
        message: isValid ? 'Signature valid' : `Signature invalid: ${result}`
      };
    } catch (error) {
      console.warn('[Integrity] Signature check failed:', error.message);
      return { valid: false, message: error.message };
    }
  }

  verifyProductionMode() {
    const isDev = process.defaultApp || /electron/i.test(process.execPath);

    return {
      valid: !isDev,
      message: isDev ? 'Running in development mode' : 'Running in production mode'
    };
  }

  performFullVerification(baselineHashes) {
    console.log('[Integrity] Performing full security verification...');

    const results = {
      appIntegrity: null,
      signature: null,
      productionMode: null,
      overallValid: true
    };

    if (baselineHashes) {
      results.appIntegrity = this.verifyAppIntegrity(baselineHashes);
      if (!results.appIntegrity.valid) {
        results.overallValid = false;
      }
    }

    results.signature = this.verifyWindowsSignature();
    if (!results.signature.valid) {
      console.warn('[Integrity] Code signature verification failed');
    }

    results.productionMode = this.verifyProductionMode();
    if (!results.productionMode.valid) {
      console.warn('[Integrity] Not running in production mode');
    }

    return results;
  }

  generateIntegrityReport(buildDir) {
    console.log('[Integrity] Generating integrity report for build...');

    const hashes = this.generateDirectoryHashes(buildDir);

    const configFiles = [
      'config/env.json',
      'config/replacements.json',
      'config/update.json'
    ];

    for (const configFile of configFiles) {
      const fullPath = path.join(buildDir, configFile);
      if (fs.existsSync(fullPath)) {
        hashes[configFile] = this.hashFile(fullPath);
      }
    }

    const report = {
      version: require('./package.json').version,
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      hashes: hashes
    };

    return report;
  }
}

module.exports = IntegrityVerifier;