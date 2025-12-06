const fs = require('fs');
const path = require('path');

const USERS_DIR = '/home/panel/users';
const DATA_FILE = '/home/panel/data/instances.json';

// Template untuk app.js (NodeJS)
const NODE_TEMPLATE = `// Bot NodeJS Template
// Edit file ini sesuai kebutuhan

console.log('Bot started at', new Date().toISOString());

// Contoh: Simple HTTP server
const http = require('http');
const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
});

server.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});

// Keep alive
setInterval(() => {
    console.log('Still running...', new Date().toISOString());
}, 60000);
`;

// Template untuk app.py (Python)
const PYTHON_TEMPLATE = `# Bot Python Template
# Edit file ini sesuai kebutuhan

import time
from datetime import datetime

print(f'Bot started at {datetime.now().isoformat()}')

# Simple loop untuk keep alive
while True:
    print(f'Still running... {datetime.now().isoformat()}')
    time.sleep(60)
`;

// Template untuk config.json
const CONFIG_TEMPLATE = {
    runtime: 'node',
    maxMemory: 100,
    autoRestart: true,
    env: {}
};

/**
 * Ensure directories exist
 */
function ensureDirs() {
    const dirs = [USERS_DIR, path.dirname(DATA_FILE)];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ instances: {} }, null, 2));
    }
}

/**
 * Load instances data
 */
function loadData() {
    ensureDirs();
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return { instances: {} };
    }
}

/**
 * Save instances data
 */
function saveData(data) {
    ensureDirs();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create new user instance
 * @param {string} userId - Unique user ID
 * @param {string} runtime - 'node' or 'python'
 * @param {number} maxMemory - Max memory in MB
 */
function create(userId, runtime = 'node', maxMemory = 100) {
    ensureDirs();

    const userDir = path.join(USERS_DIR, userId);

    // Check if exists
    if (fs.existsSync(userDir)) {
        throw new Error(`Instance ${userId} already exists`);
    }

    // Create directory
    fs.mkdirSync(userDir, { recursive: true });

    // Create app file
    const appFile = runtime === 'python' ? 'app.py' : 'app.js';
    const template = runtime === 'python' ? PYTHON_TEMPLATE : NODE_TEMPLATE;
    fs.writeFileSync(path.join(userDir, appFile), template);

    // Create config
    const config = { ...CONFIG_TEMPLATE, runtime, maxMemory };
    fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify(config, null, 2));

    // Create empty log
    fs.writeFileSync(path.join(userDir, 'log.txt'), '');

    // Save to database
    const data = loadData();
    data.instances[userId] = {
        userId,
        runtime,
        maxMemory,
        createdAt: new Date().toISOString(),
        status: 'stopped'
    };
    saveData(data);

    return data.instances[userId];
}

/**
 * Delete user instance
 * @param {string} userId - User ID
 */
function remove(userId) {
    const userDir = path.join(USERS_DIR, userId);

    // Remove directory
    if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
    }

    // Remove from database
    const data = loadData();
    delete data.instances[userId];
    saveData(data);

    return true;
}

/**
 * Get instance details
 * @param {string} userId - User ID
 */
function get(userId) {
    const data = loadData();
    const instance = data.instances[userId];

    if (!instance) {
        return null;
    }

    const userDir = path.join(USERS_DIR, userId);

    // Check if files exist
    instance.files = {
        app: fs.existsSync(path.join(userDir, instance.runtime === 'python' ? 'app.py' : 'app.js')),
        config: fs.existsSync(path.join(userDir, 'config.json')),
        log: fs.existsSync(path.join(userDir, 'log.txt'))
    };

    return instance;
}

/**
 * List all instances
 */
function list() {
    const data = loadData();
    return Object.values(data.instances);
}

/**
 * Update instance status
 * @param {string} userId - User ID
 * @param {string} status - 'running', 'stopped', 'error'
 */
function updateStatus(userId, status) {
    const data = loadData();
    if (data.instances[userId]) {
        data.instances[userId].status = status;
        data.instances[userId].updatedAt = new Date().toISOString();
        saveData(data);
    }
}

/**
 * Get user directory path
 * @param {string} userId - User ID
 */
function getUserDir(userId) {
    return path.join(USERS_DIR, userId);
}

/**
 * Update instance config
 * @param {string} userId - User ID
 * @param {object} config - Config to update
 */
function updateConfig(userId, config) {
    const userDir = path.join(USERS_DIR, userId);
    const configPath = path.join(userDir, 'config.json');

    let currentConfig = CONFIG_TEMPLATE;
    if (fs.existsSync(configPath)) {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    const newConfig = { ...currentConfig, ...config };
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));

    // Update database
    const data = loadData();
    if (data.instances[userId]) {
        data.instances[userId] = { ...data.instances[userId], ...config };
        saveData(data);
    }

    return newConfig;
}

/**
 * Update instance data
 * @param {string} userId - User ID
 * @param {object} instanceData - New instance data
 */
function update(userId, instanceData) {
    const data = loadData();
    if (data.instances[userId]) {
        data.instances[userId] = { ...data.instances[userId], ...instanceData };
        data.instances[userId].updatedAt = new Date().toISOString();
        saveData(data);
        return data.instances[userId];
    }
    return null;
}

module.exports = {
    create,
    remove,
    get,
    list,
    updateStatus,
    getUserDir,
    updateConfig,
    update,
    USERS_DIR,
    BASE_DIR: '/home/panel'
};
