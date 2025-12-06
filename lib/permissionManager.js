/**
 * Permission Manager - Subuser permissions and API keys
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Available permissions
const PERMISSIONS = {
    // Server control
    'server.start': 'Start the server',
    'server.stop': 'Stop the server',
    'server.restart': 'Restart the server',
    'server.kill': 'Kill the server process',

    // Console
    'console.read': 'View console output',
    'console.write': 'Send commands to console',

    // Files
    'files.read': 'View and download files',
    'files.write': 'Create and edit files',
    'files.delete': 'Delete files',
    'files.upload': 'Upload files',

    // Backups
    'backup.create': 'Create backups',
    'backup.restore': 'Restore backups',
    'backup.delete': 'Delete backups',

    // Schedules
    'schedule.read': 'View schedules',
    'schedule.write': 'Create and edit schedules',
    'schedule.delete': 'Delete schedules',

    // Settings
    'settings.read': 'View server settings',
    'settings.write': 'Modify server settings',

    // Users (admin only)
    'users.read': 'View users',
    'users.write': 'Create and edit users',
    'users.delete': 'Delete users',

    // Admin
    'admin.panel': 'Access admin panel',
    'admin.instances': 'Manage all instances',
    'admin.system': 'View system resources'
};

// Permission presets
const PERMISSION_PRESETS = {
    admin: Object.keys(PERMISSIONS),
    operator: [
        'server.start', 'server.stop', 'server.restart',
        'console.read', 'console.write',
        'files.read', 'files.write', 'files.upload',
        'backup.create', 'backup.restore',
        'schedule.read', 'schedule.write',
        'settings.read'
    ],
    user: [
        'server.start', 'server.stop', 'server.restart',
        'console.read',
        'files.read',
        'schedule.read',
        'settings.read'
    ],
    viewer: [
        'console.read',
        'files.read',
        'schedule.read',
        'settings.read'
    ]
};

class PermissionManager {
    constructor() {
        this.DATA_DIR = process.env.PANEL_DIR || '/home/ubuntu/vps';
        this.SUBUSERS_FILE = path.join(this.DATA_DIR, 'data', 'subusers.json');
        this.APIKEYS_FILE = path.join(this.DATA_DIR, 'data', 'apikeys.json');
        this.subusers = this._loadSubusers();
        this.apiKeys = this._loadApiKeys();
    }

    _loadSubusers() {
        try {
            if (fs.existsSync(this.SUBUSERS_FILE)) {
                return JSON.parse(fs.readFileSync(this.SUBUSERS_FILE, 'utf8'));
            }
        } catch (e) { }
        return [];
    }

    _saveSubusers() {
        const dir = path.dirname(this.SUBUSERS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.SUBUSERS_FILE, JSON.stringify(this.subusers, null, 2));
    }

    _loadApiKeys() {
        try {
            if (fs.existsSync(this.APIKEYS_FILE)) {
                return JSON.parse(fs.readFileSync(this.APIKEYS_FILE, 'utf8'));
            }
        } catch (e) { }
        return [];
    }

    _saveApiKeys() {
        const dir = path.dirname(this.APIKEYS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.APIKEYS_FILE, JSON.stringify(this.apiKeys, null, 2));
    }

    // Get all available permissions
    getPermissionsList() {
        return PERMISSIONS;
    }

    // Get permission presets
    getPresets() {
        return PERMISSION_PRESETS;
    }

    // ============ SUBUSERS ============

    // Create subuser for an instance
    createSubuser(instanceId, username, permissions = []) {
        const existing = this.subusers.find(
            s => s.instanceId === instanceId && s.username === username
        );
        if (existing) {
            throw new Error('Subuser already exists for this instance');
        }

        const subuser = {
            id: crypto.randomBytes(8).toString('hex'),
            instanceId,
            username,
            permissions,
            createdAt: new Date().toISOString()
        };

        this.subusers.push(subuser);
        this._saveSubusers();
        return subuser;
    }

    // Get subusers for an instance
    getSubusers(instanceId) {
        return this.subusers.filter(s => s.instanceId === instanceId);
    }

    // Get subuser by ID
    getSubuser(subuserId) {
        return this.subusers.find(s => s.id === subuserId);
    }

    // Update subuser permissions
    updateSubuserPermissions(subuserId, permissions) {
        const subuser = this.subusers.find(s => s.id === subuserId);
        if (!subuser) return null;

        subuser.permissions = permissions;
        this._saveSubusers();
        return subuser;
    }

    // Apply preset to subuser
    applyPreset(subuserId, presetName) {
        const preset = PERMISSION_PRESETS[presetName];
        if (!preset) throw new Error('Invalid preset');

        return this.updateSubuserPermissions(subuserId, preset);
    }

    // Delete subuser
    deleteSubuser(subuserId) {
        this.subusers = this.subusers.filter(s => s.id !== subuserId);
        this._saveSubusers();
    }

    // Check if user has permission
    hasPermission(username, instanceId, permission) {
        // First check if user is admin
        const authManager = require('./authManager');
        const user = authManager.getUser(username);
        if (user && user.role === 'admin') return true;

        // Check subuser permissions
        const subuser = this.subusers.find(
            s => s.instanceId === instanceId && s.username === username
        );
        if (!subuser) return false;

        return subuser.permissions.includes(permission);
    }

    // Get all permissions for a user on an instance
    getUserPermissions(username, instanceId) {
        const authManager = require('./authManager');
        const user = authManager.getUser(username);

        // Admin has all permissions
        if (user && user.role === 'admin') {
            return Object.keys(PERMISSIONS);
        }

        const subuser = this.subusers.find(
            s => s.instanceId === instanceId && s.username === username
        );

        return subuser ? subuser.permissions : [];
    }

    // ============ API KEYS ============

    // Generate API key for user
    createApiKey(username, name, permissions = []) {
        const key = 'np_' + crypto.randomBytes(32).toString('hex');
        const hashedKey = crypto.createHash('sha256').update(key).digest('hex');

        const apiKey = {
            id: crypto.randomBytes(8).toString('hex'),
            username,
            name,
            keyPrefix: key.slice(0, 12), // Store prefix for identification
            keyHash: hashedKey,
            permissions,
            lastUsed: null,
            createdAt: new Date().toISOString()
        };

        this.apiKeys.push(apiKey);
        this._saveApiKeys();

        // Return full key only once (won't be stored)
        return { ...apiKey, key };
    }

    // Validate API key
    validateApiKey(key) {
        if (!key || !key.startsWith('np_')) return null;

        const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
        const apiKey = this.apiKeys.find(k => k.keyHash === hashedKey);

        if (apiKey) {
            // Update last used
            apiKey.lastUsed = new Date().toISOString();
            this._saveApiKeys();
        }

        return apiKey;
    }

    // Get API keys for user
    getUserApiKeys(username) {
        return this.apiKeys
            .filter(k => k.username === username)
            .map(k => ({
                id: k.id,
                name: k.name,
                keyPrefix: k.keyPrefix,
                permissions: k.permissions,
                lastUsed: k.lastUsed,
                createdAt: k.createdAt
            }));
    }

    // Delete API key
    deleteApiKey(keyId) {
        this.apiKeys = this.apiKeys.filter(k => k.id !== keyId);
        this._saveApiKeys();
    }

    // ============ MIDDLEWARE ============

    // Express middleware to check permission
    requirePermission(permission) {
        return (req, res, next) => {
            const instanceId = req.params.id || req.params.instanceId;
            const username = req.user?.username;

            if (!username) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            if (!this.hasPermission(username, instanceId, permission)) {
                return res.status(403).json({
                    success: false,
                    error: `Permission denied: ${permission}`
                });
            }

            next();
        };
    }

    // API key authentication middleware
    apiKeyAuth(req, res, next) {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer np_')) {
            const key = authHeader.replace('Bearer ', '');
            const apiKey = this.validateApiKey(key);

            if (apiKey) {
                req.user = { username: apiKey.username, isApiKey: true };
                req.apiKey = apiKey;
                return next();
            }
        }

        next();
    }
}

module.exports = new PermissionManager();
