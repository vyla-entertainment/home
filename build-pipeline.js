const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');

const BUILD_DIR = path.join(__dirname, 'dist-build');
const REPOS = ['frontend', 'player', 'stream-api', 'live-api-streampk'];
const TEMP_EXTRACT_DIR = path.join(__dirname, 'temp-validation-extract');

const GITHUB_ORG = 'vyla-entertainment';
const REPO_CONFIG = {
  'frontend': { name: 'frontend', branch: 'main' },
  'player': { name: 'player', branch: 'main' },
  'stream-api': { name: 'stream-api', branch: 'main' },
  'live-api-streampk': { name: 'live-api-streampk', branch: 'main' }
};

function getGitHubToken() {
  const token = process.env.GITHUB_TOKEN || process.env.VYLA_GITHUB_TOKEN;
  if (!token) {
    throw new Error('GitHub token not found. Set GITHUB_TOKEN or VYLA_GITHUB_TOKEN environment variable.');
  }
  return token;
}

function clonePrivateRepo(repoConfig, targetDir) {
  const token = getGitHubToken();
  const repoUrl = `https://${token}@github.com/${GITHUB_ORG}/${repoConfig.name}.git`;

  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    execSync(`git clone --depth 1 --branch ${repoConfig.branch} ${repoUrl} ${targetDir}`, {
      stdio: 'inherit',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });

  } catch (error) {
    throw new Error(`Failed to clone ${repoConfig.name}: ${error.message}`);
  }
}

function cloneAllRepos() {
  for (const [key, config] of Object.entries(REPO_CONFIG)) {
    const targetDir = path.join(__dirname, key);
    clonePrivateRepo(config, targetDir);
  }
}

function installDependencies() {
  for (const repo of REPOS) {
    const repoDir = path.join(__dirname, repo);
    const pkgJsonPath = path.join(repoDir, 'package.json');

    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }
    try {
      execSync('npm install --omit=dev', {
        cwd: repoDir,
        stdio: 'inherit'
      });

      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const hasNativeDeps = pkg.dependencies && Object.keys(pkg.dependencies).some(dep =>
        ['better-sqlite3', 'bcrypt', 'sharp', 'sqlite3'].includes(dep)
      );

      if (hasNativeDeps) {
        const electronVersion = JSON.parse(
          fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
        ).devDependencies.electron.replace(/[\^~]/, '');

        const rebuildBin = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild');

        execSync(`"${rebuildBin}" -f -v ${electronVersion} -m "${repoDir}"`, {
          cwd: __dirname,
          stdio: 'inherit'
        });
      }
    } catch (error) {
      throw new Error(`npm install failed for ${repo}: ${error.message}`);
    }
  }
}

function cleanBuildDir() {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

function obfuscateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(content, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    numbersToExpressions: false,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 0.75
  });
  fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
}

function encryptCredentialsFile() {
  const CryptoUtils = require('./crypto-utils');

  const credentialsTemplate = path.join(__dirname, 'config/credentials-template.json');
  const encryptedOutput = path.join(__dirname, 'config/encrypted-credentials.json');

  if (!fs.existsSync(credentialsTemplate)) {
    return null;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsTemplate, 'utf8'));

    const hasPlaceholders = Object.values(credentials).some(service =>
      Object.values(service).some(value =>
        value && value.includes('YOUR_') && value.includes('_HERE')
      )
    );

    if (hasPlaceholders) {
      const envCredentials = {};
      for (const [service, keys] of Object.entries(credentials)) {
        envCredentials[service] = {};
        for (const key of Object.keys(keys)) {
          const envVarName = `${service.toUpperCase().replace(/-/g, '_')}_${key.toUpperCase()}`;
          if (process.env[envVarName]) {
            envCredentials[service][key] = process.env[envVarName];
          }
        }
      }

      if (Object.values(envCredentials).some(s => Object.keys(s).length > 0)) {
        Object.assign(credentials, envCredentials);
      }
    }

    const buildKey = CryptoUtils.deriveKey('vyla-home-build-key', 'vyla-home-payload-salt-v1');
    const encryptedData = CryptoUtils.encryptObject(credentials, buildKey);

    fs.writeFileSync(encryptedOutput, encryptedData, 'utf8');

    return encryptedOutput;
  } catch (error) {
    throw error;
  }
}

function processFolder(src, dest) {
  const files = fs.readdirSync(src);
  fs.mkdirSync(dest, { recursive: true });

  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === '.github') continue;
      processFolder(srcPath, destPath);
    } else if (stat.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      const ext = path.extname(srcPath).toLowerCase();
      if (ext === '.js') {
        try {
          obfuscateFile(destPath);
        } catch (e) {
        }
      }
    }
  }
}

function getFileChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function validatePayload(zipPath) {
  if (fs.existsSync(TEMP_EXTRACT_DIR)) {
    fs.rmSync(TEMP_EXTRACT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_EXTRACT_DIR, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(TEMP_EXTRACT_DIR, true);

  const requiredFiles = [
    'player/server.js',
    'stream-api/server.js',
    'live-api-streampk/server.js',
    'frontend/index.html'
  ];

  const validationResults = {
    valid: true,
    errors: [],
    checksum: getFileChecksum(zipPath),
    timestamp: new Date().toISOString()
  };

  for (const file of requiredFiles) {
    const fullPath = path.join(TEMP_EXTRACT_DIR, file);
    if (!fs.existsSync(fullPath)) {
      validationResults.valid = false;
      validationResults.errors.push(`Missing critical file: ${file}`);
    }
  }

  const envPath = path.join(__dirname, 'config/env.json');
  const replacementsPath = path.join(__dirname, 'config/replacements.json');

  if (!fs.existsSync(envPath)) {
    validationResults.valid = false;
    validationResults.errors.push('Missing environment configuration: config/env.json');
  } else {
    try {
      JSON.parse(fs.readFileSync(envPath, 'utf8'));
    } catch (e) {
      validationResults.valid = false;
      validationResults.errors.push(`Invalid JSON format in config/env.json: ${e.message}`);
    }
  }

  if (!fs.existsSync(replacementsPath)) {
    validationResults.valid = false;
    validationResults.errors.push('Missing replacements configuration: config/replacements.json');
  } else {
    try {
      JSON.parse(fs.readFileSync(replacementsPath, 'utf8'));
    } catch (e) {
      validationResults.valid = false;
      validationResults.errors.push(`Invalid JSON format in config/replacements.json: ${e.message}`);
    }
  }

  fs.rmSync(TEMP_EXTRACT_DIR, { recursive: true, force: true });

  fs.writeFileSync(path.join(__dirname, 'validation-report.json'), JSON.stringify(validationResults, null, 2), 'utf8');

  if (!validationResults.valid) {
    process.exit(1);
  }

  return validationResults.checksum;
}

function build() {
  try {
    cloneAllRepos();
  } catch (error) {
    process.exit(1);
  }

  for (const repo of REPOS) {
    const srcRepo = path.join(__dirname, repo);
    if (!fs.existsSync(srcRepo)) {
      process.exit(1);
    }
  }

  try {
    installDependencies();
  } catch (error) {
    process.exit(1);
  }

  let encryptedCredentialsPath = null;
  try {
    encryptedCredentialsPath = encryptCredentialsFile();
  } catch (error) {
  }

  cleanBuildDir();

  for (const repo of REPOS) {
    const srcRepo = path.join(__dirname, repo);
    const destRepo = path.join(BUILD_DIR, repo);
    processFolder(srcRepo, destRepo);

    const srcModules = path.join(srcRepo, 'node_modules');
    const destModules = path.join(destRepo, 'node_modules');
    if (fs.existsSync(srcModules)) {
      fs.cpSync(srcModules, destModules, { recursive: true });
    }
  }

  if (encryptedCredentialsPath && fs.existsSync(encryptedCredentialsPath)) {
    const credentialsDest = path.join(BUILD_DIR, 'encrypted-credentials.json');
    fs.copyFileSync(encryptedCredentialsPath, credentialsDest);
  }

  const configDir = path.join(BUILD_DIR, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const envConfig = path.join(__dirname, 'config/env.json');
  const replacementsConfig = path.join(__dirname, 'config/replacements.json');

  if (fs.existsSync(envConfig)) {
    fs.copyFileSync(envConfig, path.join(configDir, 'env.json'));
  }
  if (fs.existsSync(replacementsConfig)) {
    fs.copyFileSync(replacementsConfig, path.join(configDir, 'replacements.json'));
  }

  const zip = new AdmZip();
  for (const repo of REPOS) {
    const destRepo = path.join(BUILD_DIR, repo);
    zip.addLocalFolder(destRepo, repo);
  }

  zip.addLocalFolder(configDir, 'config');

  if (fs.existsSync(path.join(BUILD_DIR, 'encrypted-credentials.json'))) {
    zip.addFile('encrypted-credentials.json', fs.readFileSync(path.join(BUILD_DIR, 'encrypted-credentials.json')));
  }

  const zipPath = path.join(__dirname, 'update-payload.zip');
  zip.writeZip(zipPath);

  const checksum = validatePayload(zipPath);

  let wrapperVersion = '2.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    wrapperVersion = pkg.version || '2.0.0';
  } catch (e) { }

  const manifest = {
    version: wrapperVersion,
    sha256: checksum,
    timestamp: new Date().toISOString(),
    hasEncryptedCredentials: !!encryptedCredentialsPath
  };

  fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  for (const repo of REPOS) {
    const repoPath = path.join(__dirname, repo);
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }

}

build();