const fs = require('fs');
const path = require('path');

const USERS_DIR = '/home/ubuntu/vps/users';
const MAX_LOG_SIZE = 1024 * 1024; // 1MB max log size

/**
 * Read last N lines from log file
 * @param {string} userId - User ID
 * @param {number} lines - Number of lines to read (default 100)
 */
function readLast(userId, lines = 100) {
    const logPath = path.join(USERS_DIR, userId, 'log.txt');

    if (!fs.existsSync(logPath)) {
        return { lines: [], total: 0 };
    }

    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const allLines = content.split('\n').filter(l => l.trim());
        const total = allLines.length;
        const lastLines = allLines.slice(-lines);

        return {
            lines: lastLines,
            total: total,
            showing: lastLines.length
        };
    } catch (err) {
        return { lines: [], total: 0, error: err.message };
    }
}

/**
 * Clear log file
 * @param {string} userId - User ID
 */
function clear(userId) {
    const logPath = path.join(USERS_DIR, userId, 'log.txt');

    try {
        fs.writeFileSync(logPath, '');
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Append to log file
 * @param {string} userId - User ID
 * @param {string} message - Message to append
 */
function append(userId, message) {
    const logPath = path.join(USERS_DIR, userId, 'log.txt');
    const timestamp = new Date().toISOString();

    try {
        // Check file size and rotate if needed
        if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            if (stats.size > MAX_LOG_SIZE) {
                // Keep last 50% of log
                const content = fs.readFileSync(logPath, 'utf8');
                const lines = content.split('\n');
                const keepLines = lines.slice(Math.floor(lines.length / 2));
                fs.writeFileSync(logPath, keepLines.join('\n'));
            }
        }

        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Get log file size
 * @param {string} userId - User ID
 */
function getSize(userId) {
    const logPath = path.join(USERS_DIR, userId, 'log.txt');

    try {
        if (!fs.existsSync(logPath)) {
            return 0;
        }
        const stats = fs.statSync(logPath);
        return stats.size;
    } catch {
        return 0;
    }
}

/**
 * Stream log file (untuk real-time viewing)
 * @param {string} userId - User ID
 * @param {function} callback - Callback for new lines
 */
function watch(userId, callback) {
    const logPath = path.join(USERS_DIR, userId, 'log.txt');

    if (!fs.existsSync(logPath)) {
        return null;
    }

    let lastSize = fs.statSync(logPath).size;

    const watcher = fs.watchFile(logPath, { interval: 1000 }, (curr, prev) => {
        if (curr.size > lastSize) {
            const stream = fs.createReadStream(logPath, {
                start: lastSize,
                end: curr.size
            });

            let newContent = '';
            stream.on('data', chunk => newContent += chunk);
            stream.on('end', () => {
                callback(newContent);
                lastSize = curr.size;
            });
        }
    });

    return () => fs.unwatchFile(logPath);
}

module.exports = {
    readLast,
    clear,
    append,
    getSize,
    watch
};
