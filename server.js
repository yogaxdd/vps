const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const pm2Manager = require('./lib/pm2Manager');
const cgroupManager = require('./lib/cgroupManager');
const instanceManager = require('./lib/instanceManager');
const logManager = require('./lib/logManager');
const authManager = require('./lib/authManager');
const resourceManager = require('./lib/resourceManager');
const schedulerManager = require('./lib/schedulerManager');
const permissionManager = require('./lib/permissionManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.params.id;
        const userDir = instanceManager.getUserDir(userId);
        if (!fs.existsSync(userDir)) {
            return cb(new Error('Instance not found'));
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============ AUTH ROUTES (Public) ============

// Login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }

        const result = authManager.login(username, password);

        if (!result) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Set cookie
        res.cookie('token', result.token, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Logout API
app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (token) {
        authManager.logout(token);
    }
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out' });
});

// Check auth status
app.get('/api/auth/me', authManager.authMiddleware, (req, res) => {
    res.json({ success: true, user: req.user });
});

// ============ PROTECTED ROUTES ============

// Health check (public)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cgroupsAvailable: cgroupManager.isAvailable()
    });
});

// List all instances
app.get('/api/instances', authManager.authMiddleware, async (req, res) => {
    try {
        const instances = instanceManager.list();

        const pm2List = await pm2Manager.listAll();
        const pm2Map = {};
        pm2List.forEach(p => pm2Map[p.userId] = p);

        const result = instances.map(inst => ({
            ...inst,
            pm2: pm2Map[inst.userId] || null
        }));

        res.json({ success: true, instances: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create new instance
app.post('/api/instance', authManager.authMiddleware, (req, res) => {
    try {
        const { userId, runtime = 'node', maxMemory = 100 } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid userId format' });
        }

        if (!['node', 'python'].includes(runtime)) {
            return res.status(400).json({ success: false, error: 'Invalid runtime' });
        }

        const mem = parseInt(maxMemory);
        if (isNaN(mem) || mem < 50 || mem > 500) {
            return res.status(400).json({ success: false, error: 'maxMemory must be 50-500' });
        }

        const instance = instanceManager.create(userId, runtime, mem);

        if (cgroupManager.isAvailable()) {
            cgroupManager.createGroup(userId, mem);
        }

        res.json({ success: true, instance });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get instance details
app.get('/api/instance/:id', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const instance = instanceManager.get(id);

        if (!instance) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        const pm2Status = await pm2Manager.getStatus(id);
        const memoryUsage = cgroupManager.getMemoryUsage(id);

        res.json({
            success: true,
            instance,
            pm2: pm2Status,
            memory: memoryUsage
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete instance
app.delete('/api/instance/:id', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        try {
            await pm2Manager.deleteProcess(id);
        } catch (e) { }

        cgroupManager.deleteGroup(id);
        instanceManager.remove(id);

        res.json({ success: true, message: 'Instance deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start instance
app.post('/api/instance/:id/start', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const instance = instanceManager.get(id);

        if (!instance) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        // Get custom file settings from instance config
        const options = {
            mainFile: instance.mainFile,
            requirementsFile: instance.requirementsFile,
            autoInstall: instance.autoInstall !== false // Default true
        };

        logManager.append(id, '[NeuroPanel] Starting bot...');
        await pm2Manager.startProcess(id, instance.runtime, instance.maxMemory, options);
        instanceManager.updateStatus(id, 'running');
        logManager.append(id, '[NeuroPanel] Bot started successfully');

        res.json({ success: true, message: 'Bot started' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Stop instance
app.post('/api/instance/:id/stop', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        await pm2Manager.stopProcess(id);
        instanceManager.updateStatus(id, 'stopped');
        logManager.append(id, 'Bot stopped via Panel');

        res.json({ success: true, message: 'Bot stopped' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Restart instance
app.post('/api/instance/:id/restart', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        await pm2Manager.restartProcess(id);
        instanceManager.updateStatus(id, 'running');
        logManager.append(id, 'Bot restarted via Panel');

        res.json({ success: true, message: 'Bot restarted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update instance config
app.put('/api/instance/:id/config', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { maxMemory, autoRestart, mainFile, requirementsFile, autoInstall } = req.body;

        const instance = instanceManager.get(id);
        if (!instance) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        // Update config
        if (maxMemory !== undefined) instance.maxMemory = parseInt(maxMemory);
        if (autoRestart !== undefined) instance.autoRestart = autoRestart;
        if (mainFile !== undefined) instance.mainFile = mainFile;
        if (requirementsFile !== undefined) instance.requirementsFile = requirementsFile;
        if (autoInstall !== undefined) instance.autoInstall = autoInstall;

        instanceManager.update(id, instance);

        res.json({ success: true, message: 'Config updated', instance });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get logs (PERSISTENT - tidak dihapus)
app.get('/api/instance/:id/logs', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const lines = parseInt(req.query.lines) || 500; // Default 500 lines

        const instance = instanceManager.get(id);
        if (!instance) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        const logs = logManager.readLast(id, lines);
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Clear logs (manual only)
app.delete('/api/instance/:id/logs', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        logManager.clear(id);
        res.json({ success: true, message: 'Logs cleared' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload file
app.post('/api/instance/:id/upload', authManager.authMiddleware, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        logManager.append(req.params.id, `File uploaded: ${req.file.originalname}`);

        res.json({
            success: true,
            message: 'File uploaded',
            filename: req.file.originalname,
            size: req.file.size
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get file content
app.get('/api/instance/:id/file/:filename', authManager.authMiddleware, (req, res) => {
    try {
        const { id, filename } = req.params;
        const userDir = instanceManager.getUserDir(id);
        const filePath = path.join(userDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ success: true, filename, content });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save file content
app.put('/api/instance/:id/file/:filename', authManager.authMiddleware, (req, res) => {
    try {
        const { id, filename } = req.params;
        const { content } = req.body;
        const userDir = instanceManager.getUserDir(id);
        const filePath = path.join(userDir, filename);

        fs.writeFileSync(filePath, content);
        logManager.append(id, `File saved: ${filename}`);

        res.json({ success: true, message: 'File saved' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// List files in instance
app.get('/api/instance/:id/files', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const userDir = instanceManager.getUserDir(id);

        if (!fs.existsSync(userDir)) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        const files = fs.readdirSync(userDir).map(f => {
            const stat = fs.statSync(path.join(userDir, f));
            return {
                name: f,
                size: stat.size,
                isDirectory: stat.isDirectory(),
                modified: stat.mtime
            };
        });

        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ PACKAGE MANAGEMENT ============

const { exec } = require('child_process');

// Install npm packages
app.post('/api/instance/:id/npm-install', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { packages } = req.body; // Optional: specific packages
        const userDir = instanceManager.getUserDir(id);

        if (!fs.existsSync(userDir)) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        // Create package.json if not exists
        const pkgPath = path.join(userDir, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            fs.writeFileSync(pkgPath, JSON.stringify({
                name: id,
                version: "1.0.0",
                main: "app.js",
                dependencies: {}
            }, null, 2));
        }

        const cmd = packages ? `npm install ${packages} --save` : 'npm install';

        logManager.append(id, `Running: ${cmd}`);

        exec(cmd, { cwd: userDir, timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                logManager.append(id, `npm error: ${error.message}`);
                return res.json({ success: false, error: error.message, output: stderr });
            }

            logManager.append(id, `npm install completed`);
            logManager.append(id, stdout);

            res.json({ success: true, message: 'Packages installed', output: stdout });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Install pip packages
app.post('/api/instance/:id/pip-install', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { packages } = req.body; // Optional: specific packages
        const userDir = instanceManager.getUserDir(id);

        if (!fs.existsSync(userDir)) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        // Create requirements.txt if not exists
        const reqPath = path.join(userDir, 'requirements.txt');
        if (!fs.existsSync(reqPath)) {
            fs.writeFileSync(reqPath, '# Add your Python dependencies here\n');
        }

        const cmd = packages
            ? `pip3 install ${packages}`
            : `pip3 install -r requirements.txt`;

        logManager.append(id, `Running: ${cmd}`);

        exec(cmd, { cwd: userDir, timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                logManager.append(id, `pip error: ${error.message}`);
                return res.json({ success: false, error: error.message, output: stderr });
            }

            logManager.append(id, `pip install completed`);
            logManager.append(id, stdout);

            res.json({ success: true, message: 'Packages installed', output: stdout });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get package info (detect missing modules from logs)
app.get('/api/instance/:id/packages', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const instance = instanceManager.get(id);
        const userDir = instanceManager.getUserDir(id);

        if (!instance) {
            return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        let dependencies = {};
        let missingPackages = [];

        // Read package.json or requirements.txt
        if (instance.runtime === 'node') {
            const pkgPath = path.join(userDir, 'package.json');
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    dependencies = pkg.dependencies || {};
                } catch (e) { }
            }
        } else {
            const reqPath = path.join(userDir, 'requirements.txt');
            if (fs.existsSync(reqPath)) {
                const content = fs.readFileSync(reqPath, 'utf8');
                content.split('\n').forEach(line => {
                    line = line.trim();
                    if (line && !line.startsWith('#')) {
                        const match = line.match(/^([a-zA-Z0-9_-]+)/);
                        if (match) {
                            dependencies[match[1]] = line;
                        }
                    }
                });
            }
        }

        // Analyze logs for missing modules
        const logs = logManager.readLast(id, 200);
        const logText = logs.lines.join('\n');

        // Detect Node.js missing modules
        const nodeMatches = logText.matchAll(/Cannot find module '([^']+)'/g);
        for (const match of nodeMatches) {
            if (!match[1].startsWith('.') && !match[1].startsWith('/')) {
                missingPackages.push(match[1]);
            }
        }

        // Detect Python missing modules
        const pythonMatches = logText.matchAll(/ModuleNotFoundError: No module named '([^']+)'/g);
        for (const match of pythonMatches) {
            missingPackages.push(match[1]);
        }

        // Remove duplicates
        missingPackages = [...new Set(missingPackages)];

        res.json({
            success: true,
            runtime: instance.runtime,
            dependencies,
            missingPackages,
            hasPackageFile: instance.runtime === 'node'
                ? fs.existsSync(path.join(userDir, 'package.json'))
                : fs.existsSync(path.join(userDir, 'requirements.txt'))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ USER MANAGEMENT (Admin only) ============

app.get('/api/users', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        const users = authManager.listUsers();
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/users', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        const { username, password, role = 'user' } = req.body;
        const user = authManager.createUser(username, password, role);
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/users/:username', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        authManager.deleteUser(req.params.username);
        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/users/:username/password', authManager.authMiddleware, (req, res) => {
    try {
        const { username } = req.params;
        const { newPassword } = req.body;

        // User can only change their own password, admin can change any
        if (req.user.role !== 'admin' && req.user.username !== username) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        authManager.changePassword(username, newPassword);
        res.json({ success: true, message: 'Password changed' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ RESOURCE MONITORING ============

// Get system resources
app.get('/api/system/resources', authManager.authMiddleware, async (req, res) => {
    try {
        const system = resourceManager.getSystemResources();
        const disk = await resourceManager.getDiskUsage();
        const instances = await resourceManager.getAllInstancesResources();

        res.json({
            success: true,
            system,
            disk,
            instances
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get instance resources
app.get('/api/instance/:id/resources', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const resources = await resourceManager.getInstanceResources(id);
        const diskUsage = await resourceManager.getInstanceDiskUsage(id);

        res.json({
            success: true,
            resources,
            diskUsage
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ CONSOLE INPUT ============

// Send command to instance console
app.post('/api/instance/:id/console/input', authManager.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { command } = req.body;

        if (!command) {
            return res.status(400).json({ success: false, error: 'Command required' });
        }

        // Log the command
        logManager.append(id, `> ${command}`);
        res.json({
            success: true,
            message: 'Command logged',
            note: 'Command added to log. For interactive execution, bot must read from stdin.'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ TASK SCHEDULER ============

// Get all schedules
app.get('/api/schedules', authManager.authMiddleware, (req, res) => {
    try {
        const schedules = schedulerManager.list();
        res.json({ success: true, schedules });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get schedules for an instance
app.get('/api/instance/:id/schedules', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const schedules = schedulerManager.list(id);
        res.json({ success: true, schedules });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create schedule
app.post('/api/instance/:id/schedules', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { name, action, command, cronExpression, enabled } = req.body;

        if (!action || !cronExpression) {
            return res.status(400).json({ success: false, error: 'Action and cronExpression required' });
        }

        const schedule = schedulerManager.create({
            instanceId: id,
            name,
            action,
            command,
            cronExpression,
            enabled
        });

        res.json({ success: true, schedule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update schedule
app.put('/api/schedules/:scheduleId', authManager.authMiddleware, (req, res) => {
    try {
        const { scheduleId } = req.params;
        const schedule = schedulerManager.update(scheduleId, req.body);

        if (!schedule) {
            return res.status(404).json({ success: false, error: 'Schedule not found' });
        }

        res.json({ success: true, schedule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete schedule
app.delete('/api/schedules/:scheduleId', authManager.authMiddleware, (req, res) => {
    try {
        const { scheduleId } = req.params;
        schedulerManager.delete(scheduleId);
        res.json({ success: true, message: 'Schedule deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Toggle schedule
app.post('/api/schedules/:scheduleId/toggle', authManager.authMiddleware, (req, res) => {
    try {
        const { scheduleId } = req.params;
        const schedule = schedulerManager.toggle(scheduleId);

        if (!schedule) {
            return res.status(404).json({ success: false, error: 'Schedule not found' });
        }

        res.json({ success: true, schedule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Run schedule now
app.post('/api/schedules/:scheduleId/run', authManager.authMiddleware, async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const success = await schedulerManager.runNow(scheduleId);

        if (!success) {
            return res.status(404).json({ success: false, error: 'Schedule not found' });
        }

        res.json({ success: true, message: 'Schedule executed' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ PERMISSIONS & SUBUSERS ============

// Get available permissions
app.get('/api/permissions', authManager.authMiddleware, (req, res) => {
    try {
        res.json({
            success: true,
            permissions: permissionManager.getPermissionsList(),
            presets: permissionManager.getPresets()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get subusers for an instance
app.get('/api/instance/:id/subusers', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const subusers = permissionManager.getSubusers(id);
        res.json({ success: true, subusers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create subuser
app.post('/api/instance/:id/subusers', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { username, permissions } = req.body;

        if (!username) {
            return res.status(400).json({ success: false, error: 'Username required' });
        }

        const subuser = permissionManager.createSubuser(id, username, permissions || []);
        res.json({ success: true, subuser });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update subuser permissions
app.put('/api/subusers/:subuserId', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        const { subuserId } = req.params;
        const { permissions, preset } = req.body;

        let subuser;
        if (preset) {
            subuser = permissionManager.applyPreset(subuserId, preset);
        } else if (permissions) {
            subuser = permissionManager.updateSubuserPermissions(subuserId, permissions);
        }

        if (!subuser) {
            return res.status(404).json({ success: false, error: 'Subuser not found' });
        }

        res.json({ success: true, subuser });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete subuser
app.delete('/api/subusers/:subuserId', authManager.authMiddleware, authManager.adminMiddleware, (req, res) => {
    try {
        const { subuserId } = req.params;
        permissionManager.deleteSubuser(subuserId);
        res.json({ success: true, message: 'Subuser deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get user permissions for an instance
app.get('/api/instance/:id/my-permissions', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const permissions = permissionManager.getUserPermissions(req.user.username, id);
        res.json({ success: true, permissions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ API KEYS ============

// Get user's API keys
app.get('/api/apikeys', authManager.authMiddleware, (req, res) => {
    try {
        const keys = permissionManager.getUserApiKeys(req.user.username);
        res.json({ success: true, keys });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create API key
app.post('/api/apikeys', authManager.authMiddleware, (req, res) => {
    try {
        const { name, permissions } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Name required' });
        }

        const apiKey = permissionManager.createApiKey(req.user.username, name, permissions || []);
        res.json({ success: true, apiKey });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete API key
app.delete('/api/apikeys/:keyId', authManager.authMiddleware, (req, res) => {
    try {
        const { keyId } = req.params;
        permissionManager.deleteApiKey(keyId);
        res.json({ success: true, message: 'API key deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ FILE MANAGEMENT EXTENDED ============

// Delete file
app.delete('/api/instance/:id/file/:filename', authManager.authMiddleware, (req, res) => {
    try {
        const { id, filename } = req.params;
        const userDir = instanceManager.getUserDir(id);
        const filePath = path.join(userDir, filename);

        if (!filePath.startsWith(userDir)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fs.rmdirSync(filePath, { recursive: true });
        } else {
            fs.unlinkSync(filePath);
        }

        logManager.append(id, `File deleted: ${filename}`);
        res.json({ success: true, message: 'File deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create folder
app.post('/api/instance/:id/folder', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const userDir = instanceManager.getUserDir(id);
        const folderPath = path.join(userDir, name);

        if (!folderPath.startsWith(userDir)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        fs.mkdirSync(folderPath, { recursive: true });
        logManager.append(id, `Folder created: ${name}`);
        res.json({ success: true, message: 'Folder created' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Download file
app.get('/api/instance/:id/download/:filename', authManager.authMiddleware, (req, res) => {
    try {
        const { id, filename } = req.params;
        const userDir = instanceManager.getUserDir(id);
        const filePath = path.join(userDir, filename);

        if (!filePath.startsWith(userDir)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        res.download(filePath, filename);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ BACKUPS ============

// List backups
app.get('/api/instance/:id/backups', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const backupDir = path.join(instanceManager.BASE_DIR, 'backups', id);

        if (!fs.existsSync(backupDir)) {
            return res.json({ success: true, backups: [] });
        }

        const backups = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.tar.gz'))
            .map(f => {
                const stat = fs.statSync(path.join(backupDir, f));
                return {
                    name: f,
                    size: stat.size,
                    createdAt: stat.birthtime
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ success: true, backups });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create backup
app.post('/api/instance/:id/backups', authManager.authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const userDir = instanceManager.getUserDir(id);
        const backupDir = path.join(instanceManager.BASE_DIR, 'backups', id);
        const backupName = `backup-${Date.now()}.tar.gz`;

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const { exec } = require('child_process');
        exec(`tar -czf "${path.join(backupDir, backupName)}" -C "${userDir}" .`, (error) => {
            if (error) {
                return res.status(500).json({ success: false, error: error.message });
            }

            logManager.append(id, `Backup created: ${backupName}`);
            res.json({ success: true, message: 'Backup created', name: backupName });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Restore backup
app.post('/api/instance/:id/backups/:backupName/restore', authManager.authMiddleware, async (req, res) => {
    try {
        const { id, backupName } = req.params;
        const userDir = instanceManager.getUserDir(id);
        const backupPath = path.join(instanceManager.BASE_DIR, 'backups', id, backupName);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }

        try {
            await pm2Manager.stopProcess(id);
        } catch (e) { }

        const { exec } = require('child_process');
        exec(`tar -xzf "${backupPath}" -C "${userDir}"`, (error) => {
            if (error) {
                return res.status(500).json({ success: false, error: error.message });
            }

            logManager.append(id, `Backup restored: ${backupName}`);
            res.json({ success: true, message: 'Backup restored' });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete backup
app.delete('/api/instance/:id/backups/:backupName', authManager.authMiddleware, (req, res) => {
    try {
        const { id, backupName } = req.params;
        const backupPath = path.join(instanceManager.BASE_DIR, 'backups', id, backupName);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }

        fs.unlinkSync(backupPath);
        res.json({ success: true, message: 'Backup deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ CATCH-ALL FOR SPA ============

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ ERROR HANDLER ============

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
});

// ============ START SERVER ============
// ============ START SERVER ============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`NeuroPanel running on http://0.0.0.0:${PORT}`);
    console.log(`cgroups v2 available: ${cgroupManager.isAvailable()}`);
    console.log(`Default login: admin / admin123`);

    if (cgroupManager.isAvailable()) {
        cgroupManager.init();
    }
});
