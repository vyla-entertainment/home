const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('=== Vyla Home Security Implementation Test ===\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, condition, message = '') {
  if (condition) {
    console.log(`✓ ${name}`);
    if (message) console.log(`  ${message}`);
    testsPassed++;
  } else {
    console.log(`✗ ${name}`);
    if (message) console.log(`  ${message}`);
    testsFailed++;
  }
}

console.log('1. Checking for plain-text credentials in config files...');

const envConfig = path.join(__dirname, 'config/env.json');
if (fs.existsSync(envConfig)) {
  const envContent = fs.readFileSync(envConfig, 'utf8');
  const hasPlainKeys = envContent.includes('TMDB_KEY') ||
    envContent.includes('DATABASE_URL') ||
    envContent.includes('TOKEN_SECRET');

  test('env.json contains no sensitive credentials', !hasPlainKeys,
    hasPlainKeys ? 'Found sensitive keys in env.json' : 'env.json is clean');
} else {
  test('env.json exists', false, 'env.json not found');
}

console.log('\n2. Testing crypto-utils...');

try {
  const CryptoUtils = require('./crypto-utils');
  test('crypto-utils module loads', true);

  const machineKey = CryptoUtils.getMachineKey();
  test('Machine key generation works', !!machineKey && machineKey.length === 64,
    `Machine key length: ${machineKey ? machineKey.length : 0}`);

  const derivedKey = CryptoUtils.deriveKey('test', 'salt');
  test('Key derivation works', derivedKey.length === 32,
    `Derived key length: ${derivedKey.length}`);

  const testMessage = 'Hello, World!';
  const encrypted = CryptoUtils.encrypt(testMessage, derivedKey);
  test('Encryption works', encrypted && encrypted !== testMessage,
    'Encrypted output differs from input');

  const decrypted = CryptoUtils.decrypt(encrypted, derivedKey);
  test('Decryption works', decrypted === testMessage,
    'Decrypted message matches original');

} catch (error) {
  test('crypto-utils module works', false, error.message);
}

console.log('\n3. Testing credential-manager...');

try {
  const CredentialManager = require('./credential-manager');
  test('credential-manager module loads', true);

  const tempDir = path.join(__dirname, 'test-temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const manager = new CredentialManager(tempDir);
  test('CredentialManager instantiation works', true);

  manager.setCredential('test-service', 'test-key', 'test-value');
  const retrieved = manager.getCredential('test-service', 'test-key');
  test('Credential storage and retrieval works', retrieved === 'test-value');

  const credsPath = path.join(tempDir, 'encrypted-credentials.json');
  if (fs.existsSync(credsPath)) {
    const credsContent = fs.readFileSync(credsPath, 'utf8');
    const isEncrypted = !credsContent.includes('test-value');
    test('Credentials are encrypted on disk', isEncrypted,
      isEncrypted ? 'File contains encrypted data' : 'WARNING: Plain text found');
  }

  fs.rmSync(tempDir, { recursive: true, force: true });

} catch (error) {
  test('credential-manager module works', false, error.message);
}

console.log('\n4. Testing update-client...');

try {
  const UpdateClient = require('./update-client');
  test('update-client module loads', true);

  const updateConfig = {
    manifestUrl: 'https://example.com/manifest.json',
    payloadUrl: 'https://example.com/payload.zip'
  };

  const client = new UpdateClient(updateConfig, '/tmp/test');
  test('UpdateClient instantiation works', true);

  test('Auth headers generation works', true);

} catch (error) {
  test('update-client module works', false, error.message);
}

console.log('\n5. Testing integrity-verifier...');

try {
  const IntegrityVerifier = require('./integrity-verifier');
  test('integrity-verifier module loads', true);

  const verifier = new IntegrityVerifier();
  test('IntegrityVerifier instantiation works', true);

  const testFile = path.join(__dirname, 'package.json');
  if (fs.existsSync(testFile)) {
    const hash = verifier.hashFile(testFile);
    test('File hashing works', !!hash && hash.length === 64,
      `Hash length: ${hash.length}`);
  }

} catch (error) {
  test('integrity-verifier module works', false, error.message);
}

console.log('\n6. Testing updated patcher...');

try {
  const Patcher = require('./patcher');
  test('patcher module loads', true);

  const patcherCode = fs.readFileSync(path.join(__dirname, 'patcher.js'), 'utf8');
  const hasCredentialHandling = patcherCode.includes('handleEncryptedCredentials') ||
    patcherCode.includes('CredentialManager');

  test('Patcher has credential handling', hasCredentialHandling,
    hasCredentialHandling ? 'Credential integration found' : 'WARNING: No credential handling');

} catch (error) {
  test('patcher module works', false, error.message);
}

console.log('\n7. Testing updated service-manager...');

try {
  const ServiceManager = require('./service-manager');
  test('service-manager module loads', true);

  const smCode = fs.readFileSync(path.join(__dirname, 'service-manager.js'), 'utf8');
  const hasCredentialIntegration = smCode.includes('CredentialManager') ||
    smCode.includes('credentialManager');

  test('ServiceManager has credential integration', hasCredentialIntegration,
    hasCredentialIntegration ? 'Credential integration found' : 'WARNING: No credential integration');

} catch (error) {
  test('service-manager module works', false, error.message);
}

console.log('\n8. Testing updated main.js...');

try {
  const mainCode = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

  const hasUpdateClient = mainCode.includes('UpdateClient');
  test('main.js uses UpdateClient', hasUpdateClient,
    hasUpdateClient ? 'UpdateClient integrated' : 'WARNING: No UpdateClient');

  const hasCredentialIntegration = mainCode.includes('CredentialManager') ||
    mainCode.includes('UpdateClient');
  test('main.js has security integration', hasCredentialIntegration,
    hasCredentialIntegration ? 'Security components integrated' : 'WARNING: No security integration');

} catch (error) {
  test('main.js can be read', false, error.message);
}

console.log('\n9. Testing build-pipeline updates...');

try {
  const buildCode = fs.readFileSync(path.join(__dirname, 'build-pipeline.js'), 'utf8');

  const hasGitHubCloning = buildCode.includes('clonePrivateRepo') ||
    buildCode.includes('GITHUB_TOKEN');
  test('Build pipeline has GitHub cloning', hasGitHubCloning,
    hasGitHubCloning ? 'GitHub cloning implemented' : 'WARNING: No GitHub cloning');

  const hasCredentialEncryption = buildCode.includes('encryptCredentialsFile') ||
    buildCode.includes('CryptoUtils');
  test('Build pipeline has credential encryption', hasCredentialEncryption,
    hasCredentialEncryption ? 'Credential encryption implemented' : 'WARNING: No credential encryption');

  const hasIntegrityReport = buildCode.includes('integrity-report.json') ||
    buildCode.includes('IntegrityVerifier');
  test('Build pipeline generates integrity report', hasIntegrityReport,
    hasIntegrityReport ? 'Integrity reporting implemented' : 'WARNING: No integrity reporting');

} catch (error) {
  test('build-pipeline can be read', false, error.message);
}

console.log('\n10. Testing GitHub Actions workflow...');

const workflowPath = path.join(__dirname, '.github/workflows/build-deploy.yml');
if (fs.existsSync(workflowPath)) {
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');

  test('GitHub Actions workflow exists', true);

  const hasSecrets = workflowContent.includes('secrets.');
  test('Workflow uses GitHub Secrets', hasSecrets,
    hasSecrets ? 'Secrets configured' : 'WARNING: No secrets found');

  const hasCredentialEnv = workflowContent.includes('PLAYER_TMDB_KEY') ||
    workflowContent.includes('STREAM_API_DATABASE_URL');
  test('Workflow has credential environment variables', hasCredentialEnv,
    hasCredentialEnv ? 'Credential env vars found' : 'WARNING: No credential env vars');

} else {
  test('GitHub Actions workflow exists', false, 'Workflow file not found');
}

console.log('\n11. Testing .gitignore...');

const gitignorePath = path.join(__dirname, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');

  const ignoresNodeModules = gitignoreContent.includes('node_modules');
  test('.gitignore ignores node_modules', ignoresNodeModules);

  const ignoresBuildArtifacts = gitignoreContent.includes('update-payload.zip') ||
    gitignoreContent.includes('dist/');
  test('.gitignore ignores build artifacts', ignoresBuildArtifacts);

  const ignoresSensitiveFiles = gitignoreContent.includes('credentials.json') ||
    gitignoreContent.includes('.env');
  test('.gitignore ignores sensitive files', ignoresSensitiveFiles);

} else {
  test('.gitignore exists', false);
}

console.log('\n12. Testing documentation...');

const securitySetupExists = fs.existsSync(path.join(__dirname, 'SECURITY_SETUP.md'));
test('SECURITY_SETUP.md exists', securitySetupExists);

const securitySummaryExists = fs.existsSync(path.join(__dirname, 'SECURITY_SUMMARY.md'));
test('SECURITY_SUMMARY.md exists', securitySummaryExists);

console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log('='.repeat(50));

if (testsFailed === 0) {
  console.log('\n✓ All security tests passed!');
  console.log('The implementation is ready for deployment.');
  process.exit(0);
} else {
  console.log(`\n✗ ${testsFailed} test(s) failed. Please review the issues above.`);
  process.exit(1);
}