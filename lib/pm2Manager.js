const pm2 = require('pm2');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const USERS_DIR = '/home/ubuntu/vps/users';

/**
 * Connect to PM2 daemon
 */
function connect() {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Ensure virtual environment exists for Python instance
 * @param {string} userDir - User directory
 */
function ensureVenv(userDir) {
    return new Promise((resolve, reject) => {
        const venvPath = path.join(userDir, 'venv');

        // Check if venv already exists
        if (fs.existsSync(path.join(venvPath, 'bin', 'python'))) {
            console.log(`[${path.basename(userDir)}] venv already exists`);
            return resolve(venvPath);
        }

        console.log(`[${path.basename(userDir)}] Creating virtual environment...`);
        const logPath = path.join(userDir, 'log.txt');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.write(`\n[NeuroPanel] Creating Python virtual environment...\n`);

        exec(`python3 -m venv venv`, { cwd: userDir, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                logStream.write(`[NeuroPanel] venv creation failed: ${error.message}\n`);
                logStream.end();
                console.log(`[${path.basename(userDir)}] venv creation failed: ${error.message}`);
                // Try with virtualenv as fallback
                exec(`virtualenv venv`, { cwd: userDir, timeout: 60000 }, (err2) => {
                    if (err2) {
                        return reject(new Error('Could not create virtual environment'));
                    }
                    logStream.write(`[NeuroPanel] venv created successfully (virtualenv)\n`);
                    logStream.end();
                    resolve(venvPath);
                });
            } else {
                logStream.write(`[NeuroPanel] venv created successfully\n`);
                logStream.end();
                console.log(`[${path.basename(userDir)}] venv created successfully`);
                resolve(venvPath);
            }
        });
    });
}

/**
 * Get the pip command for the instance (uses venv for Python)
 * @param {string} userDir - User directory
 * @param {string} runtime - 'node' or 'python'
 */
function getPipCommand(userDir) {
    const venvPip = path.join(userDir, 'venv', 'bin', 'pip');
    if (fs.existsSync(venvPip)) {
        return venvPip;
    }
    return 'pip3'; // Fallback
}

/**
 * Get the Python interpreter for the instance (uses venv)
 * @param {string} userDir - User directory
 */
function getPythonInterpreter(userDir) {
    const venvPython = path.join(userDir, 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
        return venvPython;
    }
    return 'python3'; // Fallback
}

/**
 * Install dependencies before starting
 * @param {string} userDir - User directory
 * @param {string} runtime - 'node' or 'python'
 * @param {string} requirementsFile - Requirements filename
 */
async function installDependencies(userDir, runtime, requirementsFile) {
    const reqPath = path.join(userDir, requirementsFile);

    // Check if requirements file exists
    if (!fs.existsSync(reqPath)) {
        console.log(`No ${requirementsFile} found, skipping install`);
        return;
    }

    // For Python, ensure venv exists first
    if (runtime === 'python') {
        await ensureVenv(userDir);
    }

    const logPath = path.join(userDir, 'log.txt');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    let command;
    if (runtime === 'python') {
        const pip = getPipCommand(userDir);
        command = `${pip} install -r "${requirementsFile}" --quiet`;
    } else {
        command = 'npm install --silent';
    }

    logStream.write(`\n[NeuroPanel] Installing dependencies: ${command}\n`);
    console.log(`[${path.basename(userDir)}] Installing dependencies...`);

    return new Promise((resolve) => {
        exec(command, { cwd: userDir, timeout: 180000 }, (error, stdout, stderr) => {
            if (error) {
                logStream.write(`[NeuroPanel] Install error: ${error.message}\n`);
                if (stderr) logStream.write(stderr);
                logStream.end();
                // Continue anyway, don't fail the start
                console.log(`[${path.basename(userDir)}] Install warning: ${error.message}`);
                resolve();
            } else {
                if (stdout) logStream.write(stdout);
                if (stderr) logStream.write(stderr);
                logStream.write(`[NeuroPanel] Dependencies installed successfully\n`);
                logStream.end();
                console.log(`[${path.basename(userDir)}] Dependencies installed`);
                resolve();
            }
        });
    });
}

/**
 * Start a bot process
 * @param {string} userId - User ID
 * @param {string} runtime - 'node' or 'python'
 * @param {number} maxMemory - Max memory in MB
 * @param {object} options - Additional options {mainFile, requirementsFile, autoInstall}
 */
async function startProcess(userId, runtime, maxMemory = 100, options = {}) {
    const userDir = path.join(USERS_DIR, userId);

    // Get custom file settings or use defaults
    const mainFile = options.mainFile || (runtime === 'python' ? 'app.py' : 'app.js');
    const requirementsFile = options.requirementsFile || (runtime === 'python' ? 'requirements.txt' : 'package.json');
    const autoInstall = options.autoInstall !== false; // Default true

    // For Python, ensure venv exists
    if (runtime === 'python') {
        await ensureVenv(userDir);
    }

    // Auto install dependencies if enabled
    if (autoInstall) {
        await installDependencies(userDir, runtime, requirementsFile);
    }

    await connect();

    // Use venv python for Python instances
    const interpreter = runtime === 'python' ? getPythonInterpreter(userDir) : 'node';

    return new Promise((resolve, reject) => {
        pm2.start({
            name: `bot-${userId}`,
            script: mainFile,
            cwd: userDir,
            interpreter: interpreter,
            max_memory_restart: `${maxMemory}M`,
            output: path.join(userDir, 'log.txt'),
            error: path.join(userDir, 'log.txt'),
            merge_logs: true,
            autorestart: true,
            watch: false
        }, (err, proc) => {
            pm2.disconnect();
            if (err) reject(err);
            else resolve(proc);
        });
    });
}

/**
 * Stop a bot process
 * @param {string} userId - User ID
 */
async function stopProcess(userId) {
    await connect();

    return new Promise((resolve, reject) => {
        pm2.stop(`bot-${userId}`, (err) => {
            pm2.disconnect();
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Restart a bot process
 * @param {string} userId - User ID
 */
async function restartProcess(userId) {
    await connect();

    return new Promise((resolve, reject) => {
        pm2.restart(`bot-${userId}`, (err) => {
            pm2.disconnect();
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Delete a bot process from PM2
 * @param {string} userId - User ID
 */
async function deleteProcess(userId) {
    await connect();

    return new Promise((resolve, reject) => {
        pm2.delete(`bot-${userId}`, (err) => {
            pm2.disconnect();
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Get status of a bot process
 * @param {string} userId - User ID
 */
async function getStatus(userId) {
    await connect();

    return new Promise((resolve, reject) => {
        pm2.describe(`bot-${userId}`, (err, processDescription) => {
            pm2.disconnect();
            if (err) reject(err);
            else if (!processDescription || processDescription.length === 0) {
                resolve({ status: 'not_found' });
            } else {
                const proc = processDescription[0];
                resolve({
                    status: proc.pm2_env.status,
                    pid: proc.pid,
                    memory: proc.monit ? proc.monit.memory : 0,
                    cpu: proc.monit ? proc.monit.cpu : 0,
                    uptime: proc.pm2_env.pm_uptime,
                    restarts: proc.pm2_env.restart_time
                });
            }
        });
    });
}

/**
 * Get list of all running processes
 */
async function listAll() {
    await connect();

    return new Promise((resolve, reject) => {
        pm2.list((err, list) => {
            pm2.disconnect();
            if (err) reject(err);
            else {
                const bots = list
                    .filter(p => p.name.startsWith('bot-'))
                    .map(p => ({
                        userId: p.name.replace('bot-', ''),
                        status: p.pm2_env.status,
                        pid: p.pid,
                        memory: p.monit ? p.monit.memory : 0,
                        cpu: p.monit ? p.monit.cpu : 0
                    }));
                resolve(bots);
            }
        });
    });
}

module.exports = {
    startProcess,
    stopProcess,
    restartProcess,
    deleteProcess,
    getStatus,
    listAll
};
