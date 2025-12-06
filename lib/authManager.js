const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = '/home/vps/data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Default admin password (harus diganti setelah install)
const DEFAULT_ADMIN = {
    username: 'admin',
    password: hashPassword('admin123'),
    role: 'admin',
    createdAt: new Date().toISOString()
};

/**
 * Hash password dengan SHA256
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Generate session token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure data files exist
 */
function ensureFiles() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users: { admin: DEFAULT_ADMIN } }, null, 2));
    }

    if (!fs.existsSync(SESSIONS_FILE)) {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: {} }, null, 2));
    }
}

/**
 * Load users
 */
function loadUsers() {
    ensureFiles();
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
        return { users: { admin: DEFAULT_ADMIN } };
    }
}

/**
 * Save users
 */
function saveUsers(data) {
    ensureFiles();
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Load sessions
 */
function loadSessions() {
    ensureFiles();
    try {
        return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch {
        return { sessions: {} };
    }
}

/**
 * Save sessions
 */
function saveSessions(data) {
    ensureFiles();
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Login user
 * @param {string} username 
 * @param {string} password 
 * @returns {object|null} Session info or null if failed
 */
function login(username, password) {
    const data = loadUsers();
    const user = data.users[username];

    if (!user) {
        return null;
    }

    const hashedPassword = hashPassword(password);
    if (user.password !== hashedPassword) {
        return null;
    }

    // Create session
    const token = generateToken();
    const sessions = loadSessions();

    sessions.sessions[token] = {
        username: username,
        role: user.role,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };

    saveSessions(sessions);

    return {
        token: token,
        username: username,
        role: user.role
    };
}

/**
 * Logout user
 * @param {string} token 
 */
function logout(token) {
    const sessions = loadSessions();
    delete sessions.sessions[token];
    saveSessions(sessions);
}

/**
 * Validate session token
 * @param {string} token 
 * @returns {object|null} Session info or null if invalid
 */
function validateToken(token) {
    if (!token) return null;

    const sessions = loadSessions();
    const session = sessions.sessions[token];

    if (!session) {
        return null;
    }

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
        delete sessions.sessions[token];
        saveSessions(sessions);
        return null;
    }

    return session;
}

/**
 * Create new user
 * @param {string} username 
 * @param {string} password 
 * @param {string} role - 'admin' or 'user'
 */
function createUser(username, password, role = 'user') {
    const data = loadUsers();

    if (data.users[username]) {
        throw new Error('Username already exists');
    }

    data.users[username] = {
        username: username,
        password: hashPassword(password),
        role: role,
        createdAt: new Date().toISOString()
    };

    saveUsers(data);
    return { username, role };
}

/**
 * Delete user
 * @param {string} username 
 */
function deleteUser(username) {
    const data = loadUsers();

    if (username === 'admin') {
        throw new Error('Cannot delete admin user');
    }

    delete data.users[username];
    saveUsers(data);
}

/**
 * Change password
 * @param {string} username 
 * @param {string} newPassword 
 */
function changePassword(username, newPassword) {
    const data = loadUsers();

    if (!data.users[username]) {
        throw new Error('User not found');
    }

    data.users[username].password = hashPassword(newPassword);
    saveUsers(data);
}

/**
 * List all users (tanpa password)
 */
function listUsers() {
    const data = loadUsers();
    return Object.values(data.users).map(u => ({
        username: u.username,
        role: u.role,
        createdAt: u.createdAt
    }));
}

/**
 * Express middleware untuk auth
 */
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

    const session = validateToken(token);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    req.user = session;
    next();
}

/**
 * Admin only middleware
 */
function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

module.exports = {
    login,
    logout,
    validateToken,
    createUser,
    deleteUser,
    changePassword,
    listUsers,
    authMiddleware,
    adminMiddleware,
    hashPassword
};
