const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOS = {
    frontend: { branch: 'main' },
    player: { branch: 'main' },
    'stream-api': { branch: 'main' },
    'live-api-streampk': { branch: 'main' }
};

const GITHUB_ORG = 'vyla-entertainment';

class GitHubClient {
    constructor(appDataPath, credentialManager) {
        this.appDataPath = appDataPath;
        this.credentialManager = credentialManager;
    }

    getToken() {
        return this.credentialManager.getCredential('github', 'TOKEN') || null;
    }

    setToken(token) {
        this.credentialManager.setCredential('github', 'TOKEN', token);
    }

    hasToken() {
        return !!this.getToken();
    }

    buildRepoUrl(repoName) {
        const token = this.getToken();
        if (token) {
            return `https://${token}@github.com/${GITHUB_ORG}/${repoName}.git`;
        }
        return `https://github.com/${GITHUB_ORG}/${repoName}.git`;
    }

    repoDir(repoName) {
        return path.join(this.appDataPath, repoName);
    }

    isRepoCloned(repoName) {
        const gitDir = path.join(this.repoDir(repoName), '.git');
        return fs.existsSync(gitDir);
    }

    allReposCloned() {
        return Object.keys(REPOS).every((name) => this.isRepoCloned(name));
    }

    cloneRepo(repoName, onLog) {
        const { branch } = REPOS[repoName];
        const targetDir = this.repoDir(repoName);
        const url = this.buildRepoUrl(repoName);

        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }

        if (onLog) onLog(`Cloning ${repoName}...`);

        const result = spawnSync('git', ['clone', '--depth', '1', '--branch', branch, url, targetDir], {
            stdio: 'pipe',
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });

        if (result.status !== 0) {
            const stderr = result.stderr ? result.stderr.toString() : 'unknown error';
            throw new Error(`Failed to clone ${repoName}: ${stderr}`);
        }
    }

    cloneAll(onLog) {
        for (const repoName of Object.keys(REPOS)) {
            this.cloneRepo(repoName, onLog);
        }
    }

    installDependencies(repoName, onLog) {
        const repoDir = this.repoDir(repoName);
        const pkgJsonPath = path.join(repoDir, 'package.json');

        if (!fs.existsSync(pkgJsonPath)) {
            return;
        }

        if (onLog) onLog(`Installing dependencies for ${repoName}...`);

        const result = spawnSync('npm', ['install', '--omit=dev'], {
            cwd: repoDir,
            stdio: 'pipe',
            shell: process.platform === 'win32'
        });

        if (result.status !== 0) {
            const stderr = result.stderr ? result.stderr.toString() : 'unknown error';
            throw new Error(`npm install failed for ${repoName}: ${stderr}`);
        }
    }

    installAllDependencies(onLog) {
        for (const repoName of Object.keys(REPOS)) {
            this.installDependencies(repoName, onLog);
        }
    }

    getLocalHead(repoName) {
        const repoDir = this.repoDir(repoName);
        try {
            return execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
        } catch (e) {
            return null;
        }
    }

    getRemoteHead(repoName) {
        const { branch } = REPOS[repoName];
        const repoDir = this.repoDir(repoName);
        const url = this.buildRepoUrl(repoName);
        try {
            const output = execSync(`git ls-remote "${url}" refs/heads/${branch}`, { cwd: repoDir }).toString().trim();
            return output.split('\t')[0] || null;
        } catch (e) {
            return null;
        }
    }

    checkForUpdates() {
        const outdated = [];
        for (const repoName of Object.keys(REPOS)) {
            const local = this.getLocalHead(repoName);
            const remote = this.getRemoteHead(repoName);
            if (local && remote && local !== remote) {
                outdated.push(repoName);
            }
        }
        return outdated;
    }

    updateRepo(repoName, onLog) {
        const { branch } = REPOS[repoName];
        const repoDir = this.repoDir(repoName);

        if (onLog) onLog(`Updating ${repoName}...`);

        const fetchResult = spawnSync('git', ['fetch', 'origin', branch], {
            cwd: repoDir,
            stdio: 'pipe',
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });

        if (fetchResult.status !== 0) {
            const stderr = fetchResult.stderr ? fetchResult.stderr.toString() : 'unknown error';
            throw new Error(`Failed to fetch ${repoName}: ${stderr}`);
        }

        const resetResult = spawnSync('git', ['reset', '--hard', `origin/${branch}`], {
            cwd: repoDir,
            stdio: 'pipe'
        });

        if (resetResult.status !== 0) {
            const stderr = resetResult.stderr ? resetResult.stderr.toString() : 'unknown error';
            throw new Error(`Failed to reset ${repoName}: ${stderr}`);
        }
    }

    updateAll(repoNames, onLog) {
        for (const repoName of repoNames) {
            this.updateRepo(repoName, onLog);
            this.installDependencies(repoName, onLog);
        }
    }
}

module.exports = GitHubClient;