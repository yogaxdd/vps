const pm2 = require('pm2');
const path = require('path');

const USERS_DIR = '/home/panel/users';

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
 * Start a bot process
 * @param {string} userId - User ID
 * @param {string} runtime - 'node' or 'python'
 * @param {number} maxMemory - Max memory in MB
 */
async function startProcess(userId, runtime, maxMemory = 100) {
    await connect();

    const userDir = path.join(USERS_DIR, userId);
    const scriptFile = runtime === 'python' ? 'app.py' : 'app.js';
    const interpreter = runtime === 'python' ? 'python3' : 'node';

    return new Promise((resolve, reject) => {
        pm2.start({
            name: `bot-${userId}`,
            script: scriptFile,
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
