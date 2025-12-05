// ============ API Helper ============
const API = {
    token: localStorage.getItem('token'),

    async request(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const res = await fetch(url, { ...options, headers });
        const data = await res.json();

        if (res.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
            return;
        }

        return data;
    },

    get(url) {
        return this.request(url);
    },

    post(url, body) {
        return this.request(url, { method: 'POST', body: JSON.stringify(body) });
    },

    put(url, body) {
        return this.request(url, { method: 'PUT', body: JSON.stringify(body) });
    },

    delete(url) {
        return this.request(url, { method: 'DELETE' });
    }
};

// ============ State ============
let instances = [];
let currentInstance = null;
let consoleInterval = null;

// ============ DOM Elements ============
const elements = {
    sidebar: document.getElementById('sidebar'),
    menuToggle: document.getElementById('menuToggle'),
    pageTitle: document.getElementById('pageTitle'),
    currentUser: document.getElementById('currentUser'),
    currentRole: document.getElementById('currentRole'),
    btnLogout: document.getElementById('btnLogout'),
    btnNewInstance: document.getElementById('btnNewInstance'),
    navUsers: document.getElementById('navUsers'),

    // Stats
    statTotal: document.getElementById('statTotal'),
    statRunning: document.getElementById('statRunning'),
    statStopped: document.getElementById('statStopped'),
    statMemory: document.getElementById('statMemory'),

    // Tables
    recentInstances: document.getElementById('recentInstances'),
    instancesBody: document.getElementById('instancesBody'),
    usersBody: document.getElementById('usersBody'),
    searchInstances: document.getElementById('searchInstances'),

    // Modals
    consoleModal: document.getElementById('consoleModal'),
    consoleTitle: document.getElementById('consoleTitle'),
    consoleOutput: document.getElementById('consoleOutput'),
    consoleStatus: document.getElementById('consoleStatus'),
    consoleLines: document.getElementById('consoleLines'),
    btnClearConsole: document.getElementById('btnClearConsole'),
    btnRefreshConsole: document.getElementById('btnRefreshConsole'),
    closeConsole: document.getElementById('closeConsole'),

    newInstanceModal: document.getElementById('newInstanceModal'),
    newInstanceForm: document.getElementById('newInstanceForm'),
    closeNewInstance: document.getElementById('closeNewInstance'),
    cancelNewInstance: document.getElementById('cancelNewInstance'),

    newUserModal: document.getElementById('newUserModal'),
    newUserForm: document.getElementById('newUserForm'),
    closeNewUser: document.getElementById('closeNewUser'),
    cancelNewUser: document.getElementById('cancelNewUser'),
    btnNewUser: document.getElementById('btnNewUser'),

    fileEditorModal: document.getElementById('fileEditorModal'),
    fileEditorTitle: document.getElementById('fileEditorTitle'),
    fileEditorContent: document.getElementById('fileEditorContent'),
    closeFileEditor: document.getElementById('closeFileEditor'),
    cancelFileEditor: document.getElementById('cancelFileEditor'),
    saveFileEditor: document.getElementById('saveFileEditor')
};

// ============ Toast Notifications ============
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ============ Auth ============
function checkAuth() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    if (!token) {
        window.location.href = '/login';
        return;
    }

    elements.currentUser.textContent = user.username || 'User';
    elements.currentRole.textContent = user.role || 'user';

    // Show admin menu
    if (user.role === 'admin') {
        elements.navUsers.style.display = 'flex';
    }
}

// ============ Navigation ============
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

    // Update page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page${capitalize(page)}`)?.classList.add('active');

    // Update title
    elements.pageTitle.textContent = capitalize(page);

    // Load data
    if (page === 'dashboard' || page === 'instances') {
        loadInstances();
    } else if (page === 'users') {
        loadUsers();
    }

    // Close mobile sidebar
    elements.sidebar.classList.remove('active');
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============ Instances ============
async function loadInstances() {
    const data = await API.get('/api/instances');
    if (data.success) {
        instances = data.instances;
        renderStats();
        renderRecentInstances();
        renderInstancesTable();
    }
}

function renderStats() {
    const total = instances.length;
    const running = instances.filter(i => i.pm2?.status === 'online').length;
    const stopped = total - running;
    const memory = instances.reduce((sum, i) => sum + (i.pm2?.memory || 0), 0);

    elements.statTotal.textContent = total;
    elements.statRunning.textContent = running;
    elements.statStopped.textContent = stopped;
    elements.statMemory.textContent = formatBytes(memory);
}

function renderRecentInstances() {
    if (instances.length === 0) {
        elements.recentInstances.innerHTML = '<p class="empty-state">No instances yet. Click "New Instance" to create one.</p>';
        return;
    }

    const recent = instances.slice(0, 5);
    elements.recentInstances.innerHTML = recent.map(inst => `
        <div class="instance-item">
            <span class="name">${inst.userId}</span>
            <span class="runtime-badge ${inst.runtime}">${inst.runtime}</span>
            <span class="status-badge ${getStatusClass(inst)}">
                <span class="status-dot"></span>
                ${getStatusText(inst)}
            </span>
            <div class="action-buttons">
                <button class="btn btn-icon" onclick="openConsole('${inst.userId}')" title="Console">📋</button>
                ${inst.pm2?.status === 'online'
            ? `<button class="btn btn-icon" onclick="stopInstance('${inst.userId}')" title="Stop">⏹️</button>`
            : `<button class="btn btn-icon" onclick="startInstance('${inst.userId}')" title="Start">▶️</button>`
        }
            </div>
        </div>
    `).join('');
}

function renderInstancesTable() {
    const search = elements.searchInstances.value.toLowerCase();
    const filtered = instances.filter(i => i.userId.toLowerCase().includes(search));

    if (filtered.length === 0) {
        elements.instancesBody.innerHTML = `
            <tr><td colspan="5" class="empty-state">No instances found</td></tr>
        `;
        return;
    }

    elements.instancesBody.innerHTML = filtered.map(inst => `
        <tr>
            <td><strong>${inst.userId}</strong></td>
            <td><span class="runtime-badge ${inst.runtime}">${inst.runtime}</span></td>
            <td>${inst.maxMemory} MB</td>
            <td>
                <span class="status-badge ${getStatusClass(inst)}">
                    <span class="status-dot"></span>
                    ${getStatusText(inst)}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-small btn-secondary" onclick="openConsole('${inst.userId}')">Console</button>
                    <button class="btn btn-small btn-secondary" onclick="openPackages('${inst.userId}')">📦</button>
                    <button class="btn btn-small btn-secondary" onclick="openFiles('${inst.userId}')">Files</button>
                    ${inst.pm2?.status === 'online'
            ? `<button class="btn btn-small btn-danger" onclick="stopInstance('${inst.userId}')">Stop</button>`
            : `<button class="btn btn-small btn-success" onclick="startInstance('${inst.userId}')">Start</button>`
        }
                    <button class="btn btn-small btn-secondary" onclick="restartInstance('${inst.userId}')">Restart</button>
                    <button class="btn btn-small btn-danger" onclick="deleteInstance('${inst.userId}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function getStatusClass(inst) {
    if (inst.pm2?.status === 'online') return 'running';
    if (inst.pm2?.status === 'errored') return 'error';
    return 'stopped';
}

function getStatusText(inst) {
    if (inst.pm2?.status === 'online') return 'Running';
    if (inst.pm2?.status === 'errored') return 'Error';
    return 'Stopped';
}

async function startInstance(id) {
    showToast(`Starting ${id}...`);
    const data = await API.post(`/api/instance/${id}/start`);
    if (data.success) {
        showToast(`${id} started`, 'success');
        loadInstances();
    } else {
        showToast(data.error, 'error');
    }
}

async function stopInstance(id) {
    showToast(`Stopping ${id}...`);
    const data = await API.post(`/api/instance/${id}/stop`);
    if (data.success) {
        showToast(`${id} stopped`, 'success');
        loadInstances();
    } else {
        showToast(data.error, 'error');
    }
}

async function restartInstance(id) {
    showToast(`Restarting ${id}...`);
    const data = await API.post(`/api/instance/${id}/restart`);
    if (data.success) {
        showToast(`${id} restarted`, 'success');
        loadInstances();
    } else {
        showToast(data.error, 'error');
    }
}

async function deleteInstance(id) {
    if (!confirm(`Delete instance "${id}"? This cannot be undone.`)) return;

    const data = await API.delete(`/api/instance/${id}`);
    if (data.success) {
        showToast(`${id} deleted`, 'success');
        loadInstances();
    } else {
        showToast(data.error, 'error');
    }
}

// ============ Console (Persistent Logs) ============
async function openConsole(id) {
    currentInstance = id;
    elements.consoleTitle.textContent = id;
    elements.consoleModal.classList.add('active');
    elements.consoleStatus.textContent = 'Connected';

    await refreshConsole();

    // Auto refresh every 2 seconds
    consoleInterval = setInterval(refreshConsole, 2000);
}

async function refreshConsole() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}/logs?lines=500`);
    if (data.success) {
        const logs = data.logs.lines || [];
        elements.consoleLines.textContent = `${logs.length} lines`;

        // Format logs with colors
        elements.consoleOutput.innerHTML = logs.map(line => {
            let className = '';
            if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
                className = 'log-error';
            } else if (line.includes('warn') || line.includes('Warning') || line.includes('WARN')) {
                className = 'log-warn';
            } else if (line.includes('info') || line.includes('INFO')) {
                className = 'log-info';
            }
            return `<div class="log-line ${className}">${escapeHtml(line)}</div>`;
        }).join('');

        // Auto scroll to bottom
        elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
    }
}

async function clearConsole() {
    if (!currentInstance) return;

    if (!confirm('Clear all logs?')) return;

    const data = await API.delete(`/api/instance/${currentInstance}/logs`);
    if (data.success) {
        elements.consoleOutput.innerHTML = '';
        showToast('Logs cleared', 'success');
    }
}

function closeConsoleModal() {
    elements.consoleModal.classList.remove('active');
    if (consoleInterval) {
        clearInterval(consoleInterval);
        consoleInterval = null;
    }
    currentInstance = null;
}

// ============ Files ============
let currentFileInstance = null;
let currentFileName = null;

async function openFiles(id) {
    currentFileInstance = id;

    const data = await API.get(`/api/instance/${id}/files`);
    if (data.success) {
        const files = data.files.filter(f => !f.isDirectory);

        if (files.length === 0) {
            showToast('No files found', 'error');
            return;
        }

        // Open first editable file
        const mainFile = files.find(f => f.name === 'app.js' || f.name === 'app.py') || files[0];
        openFileEditor(id, mainFile.name);
    }
}

async function openFileEditor(id, filename) {
    currentFileInstance = id;
    currentFileName = filename;

    elements.fileEditorTitle.textContent = filename;
    elements.fileEditorModal.classList.add('active');

    const data = await API.get(`/api/instance/${id}/file/${filename}`);
    if (data.success) {
        elements.fileEditorContent.value = data.content;
    } else {
        showToast(data.error, 'error');
    }
}

async function saveFile() {
    if (!currentFileInstance || !currentFileName) return;

    const content = elements.fileEditorContent.value;
    const data = await API.put(`/api/instance/${currentFileInstance}/file/${currentFileName}`, { content });

    if (data.success) {
        showToast('File saved', 'success');
        elements.fileEditorModal.classList.remove('active');
    } else {
        showToast(data.error, 'error');
    }
}

// ============ Package Manager ============
let currentPackageInstance = null;
let currentPackageRuntime = null;

async function openPackages(id) {
    currentPackageInstance = id;

    document.getElementById('packageTitle').textContent = id;
    document.getElementById('packageModal').classList.add('active');
    document.getElementById('packageStatus').textContent = 'Loading...';

    await loadPackages();
}

async function loadPackages() {
    if (!currentPackageInstance) return;

    const data = await API.get(`/api/instance/${currentPackageInstance}/packages`);

    if (data.success) {
        currentPackageRuntime = data.runtime;

        // Update runtime badge
        const runtimeEl = document.getElementById('packageRuntime');
        runtimeEl.textContent = data.runtime === 'node' ? 'NodeJS' : 'Python';
        runtimeEl.className = `runtime-badge ${data.runtime}`;

        // Update file name
        const fileName = data.runtime === 'node' ? 'package.json' : 'requirements.txt';
        document.getElementById('packageFile').textContent = fileName;
        document.getElementById('packageFileBtn').textContent = fileName;

        // Show missing packages
        const missingAlert = document.getElementById('missingPackagesAlert');
        const missingList = document.getElementById('missingPackagesList');

        if (data.missingPackages && data.missingPackages.length > 0) {
            missingAlert.style.display = 'block';
            missingList.innerHTML = data.missingPackages.map(p =>
                `<span style="display: inline-block; background: rgba(255,171,0,0.2); padding: 2px 8px; border-radius: 4px; margin: 2px;">${p}</span>`
            ).join(' ');
        } else {
            missingAlert.style.display = 'none';
        }

        // Show dependencies
        const depsList = document.getElementById('dependenciesList');
        const deps = Object.entries(data.dependencies);

        if (deps.length > 0) {
            depsList.innerHTML = deps.map(([name, version]) =>
                `<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">${name}: <span style="color: var(--accent);">${version}</span></div>`
            ).join('');
        } else {
            depsList.innerHTML = '<p style="color: var(--text-muted);">No dependencies installed</p>';
        }

        document.getElementById('packageStatus').textContent = 'Ready';
    } else {
        showToast(data.error, 'error');
    }
}

async function installPackage(packages) {
    if (!currentPackageInstance) return;

    const endpoint = currentPackageRuntime === 'node'
        ? `/api/instance/${currentPackageInstance}/npm-install`
        : `/api/instance/${currentPackageInstance}/pip-install`;

    document.getElementById('packageStatus').textContent = `Installing ${packages}...`;
    showToast(`Installing ${packages}...`);

    const data = await API.post(endpoint, { packages });

    if (data.success) {
        showToast('Packages installed!', 'success');
        await loadPackages();
    } else {
        showToast(data.error || 'Install failed', 'error');
        document.getElementById('packageStatus').textContent = 'Install failed';
    }
}

async function installMissingPackages() {
    const missingList = document.getElementById('missingPackagesList');
    const packages = Array.from(missingList.querySelectorAll('span')).map(s => s.textContent).join(' ');

    if (packages) {
        await installPackage(packages);
    }
}

// ============ Users (Admin) ============
async function loadUsers() {
    const data = await API.get('/api/users');
    if (data.success) {
        renderUsers(data.users);
    }
}

function renderUsers(users) {
    elements.usersBody.innerHTML = users.map(u => `
        <tr>
            <td><strong>${u.username}</strong></td>
            <td><span class="status-badge ${u.role === 'admin' ? 'running' : 'stopped'}">${u.role}</span></td>
            <td>${new Date(u.createdAt).toLocaleDateString()}</td>
            <td>
                <div class="action-buttons">
                    ${u.username !== 'admin'
            ? `<button class="btn btn-small btn-danger" onclick="deleteUser('${u.username}')">Delete</button>`
            : ''
        }
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"?`)) return;

    const data = await API.delete(`/api/users/${username}`);
    if (data.success) {
        showToast('User deleted', 'success');
        loadUsers();
    } else {
        showToast(data.error, 'error');
    }
}

// ============ Utilities ============
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ Event Listeners ============
function setupEventListeners() {
    // Mobile menu
    elements.menuToggle.addEventListener('click', () => {
        elements.sidebar.classList.toggle('active');
    });

    // Logout
    elements.btnLogout.addEventListener('click', async () => {
        await API.post('/api/auth/logout');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
    });

    // Search
    elements.searchInstances.addEventListener('input', renderInstancesTable);

    // New Instance Modal
    elements.btnNewInstance.addEventListener('click', () => {
        elements.newInstanceModal.classList.add('active');
    });

    elements.closeNewInstance.addEventListener('click', () => {
        elements.newInstanceModal.classList.remove('active');
    });

    elements.cancelNewInstance.addEventListener('click', () => {
        elements.newInstanceModal.classList.remove('active');
    });

    elements.newInstanceForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const userId = document.getElementById('newInstanceId').value;
        const runtime = document.getElementById('newInstanceRuntime').value;
        const maxMemory = document.getElementById('newInstanceMemory').value;

        const data = await API.post('/api/instance', { userId, runtime, maxMemory });

        if (data.success) {
            showToast(`Instance ${userId} created`, 'success');
            elements.newInstanceModal.classList.remove('active');
            elements.newInstanceForm.reset();
            loadInstances();
        } else {
            showToast(data.error, 'error');
        }
    });

    // Console Modal
    elements.closeConsole.addEventListener('click', closeConsoleModal);
    elements.btnClearConsole.addEventListener('click', clearConsole);
    elements.btnRefreshConsole.addEventListener('click', refreshConsole);

    // New User Modal
    elements.btnNewUser.addEventListener('click', () => {
        elements.newUserModal.classList.add('active');
    });

    elements.closeNewUser.addEventListener('click', () => {
        elements.newUserModal.classList.remove('active');
    });

    elements.cancelNewUser.addEventListener('click', () => {
        elements.newUserModal.classList.remove('active');
    });

    elements.newUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newUserPassword').value;
        const role = document.getElementById('newUserRole').value;

        const data = await API.post('/api/users', { username, password, role });

        if (data.success) {
            showToast(`User ${username} created`, 'success');
            elements.newUserModal.classList.remove('active');
            elements.newUserForm.reset();
            loadUsers();
        } else {
            showToast(data.error, 'error');
        }
    });

    // File Editor Modal
    elements.closeFileEditor.addEventListener('click', () => {
        elements.fileEditorModal.classList.remove('active');
    });

    elements.cancelFileEditor.addEventListener('click', () => {
        elements.fileEditorModal.classList.remove('active');
    });

    elements.saveFileEditor.addEventListener('click', saveFile);

    // Package Manager Modal
    document.getElementById('closePackage')?.addEventListener('click', () => {
        document.getElementById('packageModal').classList.remove('active');
        currentPackageInstance = null;
    });

    document.getElementById('btnInstallPackage')?.addEventListener('click', () => {
        const input = document.getElementById('newPackageName');
        if (input.value.trim()) {
            installPackage(input.value.trim());
            input.value = '';
        }
    });

    document.getElementById('btnInstallMissing')?.addEventListener('click', installMissingPackages);

    document.getElementById('btnEditPackageFile')?.addEventListener('click', () => {
        const fileName = currentPackageRuntime === 'node' ? 'package.json' : 'requirements.txt';
        document.getElementById('packageModal').classList.remove('active');
        openFileEditor(currentPackageInstance, fileName);
    });

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                if (modal.id === 'consoleModal') {
                    closeConsoleModal();
                }
            }
        });
    });
}

// ============ Initialize ============
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupNavigation();
    setupEventListeners();
    loadInstances();
});
