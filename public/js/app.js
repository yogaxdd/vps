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

    get(url) { return this.request(url); },
    post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body) }); },
    put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body) }); },
    delete(url) { return this.request(url, { method: 'DELETE' }); }
};

// ============ State ============
let instances = [];
let currentInstance = null;
let currentInstanceData = null;
let consoleInterval = null;
let currentPath = '/';
let currentFiles = [];

// ============ Settings ============
const defaultSettings = {
    panelName: 'NeuroPanel',
    accentColor: '#00d4ff'
};

function loadSettings() {
    const saved = localStorage.getItem('panelSettings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
}

function saveSettings(settings) {
    localStorage.setItem('panelSettings', JSON.stringify(settings));
}

function applySettings() {
    const settings = loadSettings();

    // Apply panel name
    const nameEl = document.getElementById('panelName');
    if (nameEl) {
        const parts = settings.panelName.split(/(?=[A-Z])/);
        if (parts.length >= 2) {
            nameEl.innerHTML = parts[0] + '<span>' + parts.slice(1).join('') + '</span>';
        } else {
            nameEl.innerHTML = settings.panelName.slice(0, -5) + '<span>' + settings.panelName.slice(-5) + '</span>';
        }
    }

    document.title = `${settings.panelName} - Dashboard`;

    // Apply accent color
    document.documentElement.style.setProperty('--accent', settings.accentColor);
}

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

    document.getElementById('currentUser').textContent = user.username || 'User';
    document.getElementById('currentRole').textContent = user.role === 'admin' ? 'Administrator' : 'User';
    document.getElementById('userAvatar').textContent = (user.username || 'U')[0].toUpperCase();

    if (user.role === 'admin') {
        document.getElementById('navUsers').style.display = 'flex';
    }
}

// ============ Navigation ============
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page) navigateTo(page);
        });
    });
}

function navigateTo(page) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page${capitalize(page)}`)?.classList.add('active');

    document.getElementById('pageTitleHeader').textContent = capitalize(page);

    if (page === 'dashboard' || page === 'instances') {
        loadInstances();
    } else if (page === 'users') {
        loadUsers();
    } else if (page === 'settings') {
        loadSettingsPage();
    } else if (page === 'schedules') {
        loadSchedules();
    } else if (page === 'apikeys') {
        loadApiKeys();
    }

    document.getElementById('sidebar').classList.remove('active');
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============ Instances ============
async function loadInstances() {
    const data = await API.get('/api/instances');
    if (data && data.success) {
        instances = data.instances;
        renderStats();
        renderDashboardGrid();
        renderInstancesTable();
        document.getElementById('instanceCount').textContent = instances.length;
    }
}

function renderStats() {
    const total = instances.length;
    const running = instances.filter(i => i.pm2?.status === 'online').length;
    const stopped = total - running;
    const memory = instances.reduce((sum, i) => sum + (i.pm2?.memory || 0), 0);

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statRunning').textContent = running;
    document.getElementById('statStopped').textContent = stopped;
    document.getElementById('statMemory').textContent = formatBytes(memory);
}

function renderDashboardGrid() {
    const container = document.getElementById('allInstancesGrid');
    const search = document.getElementById('dashboardSearch')?.value?.toLowerCase() || '';

    const filtered = instances.filter(i => i.userId.toLowerCase().includes(search));

    if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-state">No instances found</p>';
        return;
    }

    container.innerHTML = filtered.map(inst => `
        <div class="instance-card" onclick="openInstanceDetail('${inst.userId}')">
            <div class="instance-card-header">
                <h4>${inst.userId}</h4>
                <div class="instance-card-meta">
                    <span class="runtime-badge ${inst.runtime}">${inst.runtime}</span>
                    <span class="status-badge ${getStatusClass(inst)}">
                        <span class="status-dot"></span>
                        ${getStatusText(inst)}
                    </span>
                </div>
            </div>
            <div class="instance-card-stats">
                <span>💾 ${inst.maxMemory} MB</span>
                <span>📅 ${formatDate(inst.createdAt)}</span>
            </div>
            <div class="instance-card-actions">
                ${inst.pm2?.status === 'online'
            ? `<button class="btn btn-small btn-danger" onclick="event.stopPropagation(); stopInstance('${inst.userId}')">Stop</button>`
            : `<button class="btn btn-small btn-success" onclick="event.stopPropagation(); startInstance('${inst.userId}')">Start</button>`
        }
                <button class="btn btn-small btn-secondary" onclick="event.stopPropagation(); restartInstance('${inst.userId}')">Restart</button>
            </div>
        </div>
    `).join('');
}

function renderInstancesTable() {
    const container = document.getElementById('instancesBody');
    const search = document.getElementById('searchInstances')?.value?.toLowerCase() || '';
    const filterRuntime = document.getElementById('filterRuntime')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';

    let filtered = instances;

    if (search) {
        filtered = filtered.filter(i => i.userId.toLowerCase().includes(search));
    }
    if (filterRuntime) {
        filtered = filtered.filter(i => i.runtime === filterRuntime);
    }
    if (filterStatus) {
        filtered = filtered.filter(i => {
            const status = i.pm2?.status || 'stopped';
            return status === filterStatus;
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="6" class="empty-state">No instances found</td></tr>';
        return;
    }

    container.innerHTML = filtered.map(inst => `
        <tr onclick="openInstanceDetail('${inst.userId}')" style="cursor:pointer">
            <td><strong>${inst.userId}</strong></td>
            <td><span class="runtime-badge ${inst.runtime}">${inst.runtime}</span></td>
            <td>${inst.maxMemory} MB</td>
            <td>
                <span class="status-badge ${getStatusClass(inst)}">
                    <span class="status-dot"></span>
                    ${getStatusText(inst)}
                </span>
            </td>
            <td>${formatDate(inst.createdAt)}</td>
            <td>
                <div class="action-buttons" onclick="event.stopPropagation()">
                    ${inst.pm2?.status === 'online'
            ? `<button class="btn btn-small btn-danger" onclick="stopInstance('${inst.userId}')">Stop</button>`
            : `<button class="btn btn-small btn-success" onclick="startInstance('${inst.userId}')">Start</button>`
        }
                    <button class="btn btn-small btn-secondary" onclick="restartInstance('${inst.userId}')">Restart</button>
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
        if (currentInstance === id) updateInstanceStatus();
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
        if (currentInstance === id) updateInstanceStatus();
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
        if (currentInstance === id) updateInstanceStatus();
    } else {
        showToast(data.error, 'error');
    }
}

async function deleteInstance(id) {
    if (!confirm(`Delete instance "${id}"? This cannot be undone.`)) return;

    const data = await API.delete(`/api/instance/${id}`);
    if (data.success) {
        showToast(`${id} deleted`, 'success');
        closeInstanceDetail();
        loadInstances();
    } else {
        showToast(data.error, 'error');
    }
}

async function startAllInstances() {
    if (!confirm('Start all instances?')) return;
    showToast('Starting all instances...');

    for (const inst of instances) {
        if (inst.pm2?.status !== 'online') {
            await API.post(`/api/instance/${inst.userId}/start`);
        }
    }

    showToast('All instances started', 'success');
    loadInstances();
}

async function stopAllInstances() {
    if (!confirm('Stop all instances?')) return;
    showToast('Stopping all instances...');

    for (const inst of instances) {
        if (inst.pm2?.status === 'online') {
            await API.post(`/api/instance/${inst.userId}/stop`);
        }
    }

    showToast('All instances stopped', 'success');
    loadInstances();
}

// ============ Instance Detail ============
async function openInstanceDetail(id) {
    currentInstance = id;

    const data = await API.get(`/api/instance/${id}`);
    if (!data.success) {
        showToast(data.error, 'error');
        return;
    }

    currentInstanceData = data.instance;

    document.getElementById('instanceDetailName').textContent = id;
    document.getElementById('instanceModal').classList.add('active');

    updateInstanceStatus();
    switchTab('console');
    startConsoleRefresh();
}

function closeInstanceDetail() {
    document.getElementById('instanceModal').classList.remove('active');
    stopConsoleRefresh();
    currentInstance = null;
    currentInstanceData = null;
}

async function updateInstanceStatus() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}`);
    if (data.success) {
        currentInstanceData = data.instance;
        const statusEl = document.getElementById('instanceDetailStatus');
        const pm2 = data.pm2 || {};

        statusEl.className = `status-badge ${pm2.status === 'online' ? 'running' : 'stopped'}`;
        statusEl.innerHTML = `<span class="status-dot"></span> ${pm2.status === 'online' ? 'Running' : 'Stopped'}`;
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab${capitalize(tab)}`)?.classList.add('active');

    if (tab === 'console') {
        refreshConsole();
    } else if (tab === 'files') {
        loadFiles();
    } else if (tab === 'packages') {
        loadPackages();
    } else if (tab === 'backups') {
        loadBackups();
    } else if (tab === 'schedules') {
        loadInstanceSchedules();
    } else if (tab === 'settings') {
        loadInstanceSettings();
    }
}

// ============ Console ============
function startConsoleRefresh() {
    refreshConsole();
    consoleInterval = setInterval(refreshConsole, 2000);
}

function stopConsoleRefresh() {
    if (consoleInterval) {
        clearInterval(consoleInterval);
        consoleInterval = null;
    }
}

async function refreshConsole() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}/logs?lines=500`);
    if (data.success) {
        const logs = data.logs.lines || [];
        document.getElementById('consoleLines').textContent = `${logs.length} lines`;

        const output = document.getElementById('consoleOutput');
        const wasAtBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 50;

        output.innerHTML = logs.map(line => {
            let className = '';
            if (line.toLowerCase().includes('error')) className = 'log-error';
            else if (line.toLowerCase().includes('warn')) className = 'log-warn';
            else if (line.toLowerCase().includes('info')) className = 'log-info';
            return `<div class="log-line ${className}">${escapeHtml(line)}</div>`;
        }).join('');

        if (wasAtBottom) {
            output.scrollTop = output.scrollHeight;
        }
    }
}

async function clearConsole() {
    if (!currentInstance || !confirm('Clear all logs?')) return;

    const data = await API.delete(`/api/instance/${currentInstance}/logs`);
    if (data.success) {
        document.getElementById('consoleOutput').innerHTML = '';
        showToast('Logs cleared', 'success');
    }
}

async function sendConsoleCommand() {
    const input = document.getElementById('consoleInput');
    const command = input.value.trim();

    if (!command || !currentInstance) return;

    const data = await API.post(`/api/instance/${currentInstance}/console/input`, { command });

    if (data.success) {
        input.value = '';
        refreshConsole();
    } else {
        showToast(data.error || 'Failed to send command', 'error');
    }
}

// ============ File Manager ============
async function loadFiles(path = '/') {
    if (!currentInstance) return;

    currentPath = path;
    document.getElementById('currentPath').textContent = path;

    const data = await API.get(`/api/instance/${currentInstance}/files`);
    if (data.success) {
        currentFiles = data.files;
        renderFiles();
    }
}

function renderFiles() {
    const container = document.getElementById('fileList');

    if (currentFiles.length === 0) {
        container.innerHTML = '<p class="empty-state">No files</p>';
        return;
    }

    // Sort: folders first, then files
    const sorted = [...currentFiles].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });

    container.innerHTML = sorted.map(file => `
        <div class="file-item" onclick="${file.isDirectory ? '' : `openFileEditor('${file.name}')`}">
            <span class="file-icon">${file.isDirectory ? '📁' : getFileIcon(file.name)}</span>
            <span class="file-name">${file.name}</span>
            <span class="file-size">${file.isDirectory ? '' : formatBytes(file.size)}</span>
            <div class="file-actions-menu">
                ${!file.isDirectory ? `
                    <button class="file-action-btn" onclick="event.stopPropagation(); openFileEditor('${file.name}')">Edit</button>
                    <button class="file-action-btn" onclick="event.stopPropagation(); downloadFile('${file.name}')">Download</button>
                ` : ''}
                <button class="file-action-btn" onclick="event.stopPropagation(); deleteFile('${file.name}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
        'js': '📜', 'ts': '📜', 'py': '🐍', 'json': '📋', 'md': '📝',
        'txt': '📄', 'html': '🌐', 'css': '🎨', 'yml': '⚙️', 'yaml': '⚙️',
        'env': '🔐', 'log': '📋', 'sh': '⚡', 'bat': '⚡'
    };
    return icons[ext] || '📄';
}

async function openFileEditor(filename) {
    const data = await API.get(`/api/instance/${currentInstance}/file/${filename}`);
    if (data.success) {
        document.getElementById('fileEditorTitle').textContent = filename;
        document.getElementById('fileEditorContent').value = data.content;
        document.getElementById('fileEditorModal').classList.add('active');
    } else {
        showToast(data.error, 'error');
    }
}

async function saveFile() {
    const filename = document.getElementById('fileEditorTitle').textContent;
    const content = document.getElementById('fileEditorContent').value;

    const data = await API.put(`/api/instance/${currentInstance}/file/${filename}`, { content });
    if (data.success) {
        showToast('File saved', 'success');
        document.getElementById('fileEditorModal').classList.remove('active');
        loadFiles();
    } else {
        showToast(data.error, 'error');
    }
}

async function createNewFile() {
    const filename = document.getElementById('newFileName').value;
    if (!filename) return;

    const data = await API.put(`/api/instance/${currentInstance}/file/${filename}`, { content: '' });
    if (data.success) {
        showToast('File created', 'success');
        document.getElementById('newFileModal').classList.remove('active');
        document.getElementById('newFileName').value = '';
        loadFiles();
        openFileEditor(filename);
    } else {
        showToast(data.error, 'error');
    }
}

async function deleteFile(filename) {
    if (!confirm(`Delete "${filename}"?`)) return;

    // Note: Need to add delete endpoint in server
    showToast('Delete not implemented yet', 'error');
}

// ============ Packages ============
async function loadPackages() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}/packages`);
    if (data.success) {
        const fileName = data.runtime === 'node' ? 'package.json' : 'requirements.txt';
        document.getElementById('packageFileName').textContent = fileName;

        // Missing packages
        const missingAlert = document.getElementById('missingPackagesAlert');
        const missingList = document.getElementById('missingPackagesList');

        if (data.missingPackages && data.missingPackages.length > 0) {
            missingAlert.style.display = 'block';
            missingList.innerHTML = data.missingPackages.map(p =>
                `<span style="display:inline-block;background:rgba(255,171,0,0.2);padding:4px 10px;border-radius:4px;margin:4px;font-family:monospace;">${p}</span>`
            ).join('');
        } else {
            missingAlert.style.display = 'none';
        }

        // Dependencies
        const depsList = document.getElementById('dependenciesList');
        const deps = Object.entries(data.dependencies || {});

        if (deps.length > 0) {
            depsList.innerHTML = deps.map(([name, version]) =>
                `<div class="dep-item"><span>${name}</span><span style="color:var(--accent)">${version}</span></div>`
            ).join('');
        } else {
            depsList.innerHTML = '<p class="empty-state">No dependencies installed</p>';
        }
    }
}

async function installPackage() {
    const input = document.getElementById('newPackageName');
    const packages = input.value.trim();
    if (!packages) return;

    showToast(`Installing ${packages}...`);

    const runtime = currentInstanceData?.runtime || 'node';
    const endpoint = runtime === 'node'
        ? `/api/instance/${currentInstance}/npm-install`
        : `/api/instance/${currentInstance}/pip-install`;

    const data = await API.post(endpoint, { packages });

    if (data.success) {
        showToast('Packages installed!', 'success');
        input.value = '';
        loadPackages();
    } else {
        showToast(data.error || 'Install failed', 'error');
    }
}

async function installMissingPackages() {
    const missingList = document.getElementById('missingPackagesList');
    const packages = Array.from(missingList.querySelectorAll('span')).map(s => s.textContent).join(' ');

    if (packages) {
        document.getElementById('newPackageName').value = packages;
        await installPackage();
    }
}

// ============ Instance Settings ============
function loadInstanceSettings() {
    if (!currentInstanceData) return;

    document.getElementById('instanceMaxMemory').value = currentInstanceData.maxMemory || 100;
    document.getElementById('instanceAutoRestart').checked = currentInstanceData.autoRestart !== false;
}

async function saveInstanceSettings() {
    const maxMemory = document.getElementById('instanceMaxMemory').value;
    const autoRestart = document.getElementById('instanceAutoRestart').checked;

    const data = await API.put(`/api/instance/${currentInstance}/config`, { maxMemory, autoRestart });
    if (data.success) {
        showToast('Settings saved', 'success');
    } else {
        showToast(data.error, 'error');
    }
}

// ============ Backups ============
async function loadBackups() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}/backups`);
    const container = document.getElementById('backupsList');

    if (data.success && data.backups.length > 0) {
        container.innerHTML = data.backups.map(b => `
            <div class="backup-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 8px;">
                <div>
                    <strong>${b.name}</strong>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        ${formatBytes(b.size)} • ${formatDate(b.createdAt)}
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-small" onclick="restoreBackup('${b.name}')">Restore</button>
                    <button class="btn btn-small btn-danger" onclick="deleteBackup('${b.name}')">Delete</button>
                </div>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p class="empty-state">No backups yet</p>';
    }
}

async function createBackup() {
    if (!currentInstance) return;

    showToast('Creating backup...', 'info');
    const data = await API.post(`/api/instance/${currentInstance}/backups`);

    if (data.success) {
        showToast('Backup created!', 'success');
        loadBackups();
    } else {
        showToast(data.error || 'Failed to create backup', 'error');
    }
}

async function restoreBackup(name) {
    if (!confirm(`Restore backup "${name}"? This will overwrite current files.`)) return;

    showToast('Restoring backup...', 'info');
    const data = await API.post(`/api/instance/${currentInstance}/backups/${name}/restore`);

    if (data.success) {
        showToast('Backup restored!', 'success');
        loadFiles();
    } else {
        showToast(data.error || 'Failed to restore backup', 'error');
    }
}

async function deleteBackup(name) {
    if (!confirm(`Delete backup "${name}"?`)) return;

    const data = await API.delete(`/api/instance/${currentInstance}/backups/${name}`);

    if (data.success) {
        showToast('Backup deleted', 'success');
        loadBackups();
    } else {
        showToast(data.error || 'Failed to delete backup', 'error');
    }
}

// ============ Instance Schedules ============
async function loadInstanceSchedules() {
    if (!currentInstance) return;

    const data = await API.get(`/api/instance/${currentInstance}/schedules`);
    const container = document.getElementById('instanceSchedulesList');

    if (data.success && data.schedules.length > 0) {
        container.innerHTML = data.schedules.map(s => `
            <div class="schedule-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 24px;">${s.enabled ? '✅' : '⏸️'}</span>
                    <div>
                        <strong>${s.name}</strong>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            ${s.action} • ${s.cronExpression}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-small" onclick="runScheduleNow('${s.id}')">Run Now</button>
                    <button class="btn btn-small ${s.enabled ? 'btn-warning' : 'btn-success'}" onclick="toggleSchedule('${s.id}')">${s.enabled ? 'Pause' : 'Enable'}</button>
                    <button class="btn btn-small btn-danger" onclick="deleteSchedule('${s.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p class="empty-state">No scheduled tasks for this instance</p>';
    }
}

async function toggleSchedule(id) {
    const data = await API.post(`/api/schedules/${id}/toggle`);
    if (data.success) {
        showToast('Schedule toggled', 'success');
        loadInstanceSchedules();
    }
}

async function runScheduleNow(id) {
    const data = await API.post(`/api/schedules/${id}/run`);
    if (data.success) {
        showToast('Schedule executed!', 'success');
    } else {
        showToast(data.error || 'Failed', 'error');
    }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    const data = await API.delete(`/api/schedules/${id}`);
    if (data.success) {
        showToast('Schedule deleted', 'success');
        loadInstanceSchedules();
        loadSchedules();
    }
}

// ============ Schedules Page ============
async function loadSchedules() {
    const data = await API.get('/api/schedules');
    const container = document.getElementById('schedulesList');

    if (data.success && data.schedules.length > 0) {
        container.innerHTML = data.schedules.map(s => `
            <div class="schedule-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid ${s.enabled ? 'var(--success)' : 'var(--text-muted)'};">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <span style="font-size: 28px;">${s.action === 'restart' ? '🔄' : s.action === 'backup' ? '💾' : s.action === 'start' ? '▶️' : s.action === 'stop' ? '⏹️' : '📝'}</span>
                    <div>
                        <strong>${s.name}</strong>
                        <div style="font-size: 13px; color: var(--text-secondary);">Instance: ${s.instanceId}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            ${s.action} • ${s.cronExpression} ${s.lastRun ? '• Last: ' + formatDate(s.lastRun) : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-small" onclick="runScheduleNow('${s.id}')">Run Now</button>
                    <button class="btn btn-small ${s.enabled ? 'btn-warning' : 'btn-success'}" onclick="toggleSchedule('${s.id}')">${s.enabled ? 'Pause' : 'Enable'}</button>
                    <button class="btn btn-small btn-danger" onclick="deleteSchedule('${s.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p class="empty-state">No scheduled tasks. Click "New Schedule" to create one.</p>';
    }
}

// ============ API Keys ============
async function loadApiKeys() {
    const data = await API.get('/api/apikeys');
    const container = document.getElementById('apiKeysBody');

    // Update API endpoint display
    document.getElementById('apiEndpoint').textContent = window.location.origin + '/api';

    if (data.success && data.keys.length > 0) {
        container.innerHTML = data.keys.map(k => `
            <tr>
                <td><strong>${k.name}</strong></td>
                <td><code>${k.keyPrefix}...</code></td>
                <td>${k.lastUsed ? formatDate(k.lastUsed) : 'Never'}</td>
                <td>${formatDate(k.createdAt)}</td>
                <td><button class="btn btn-small btn-danger" onclick="deleteApiKey('${k.id}')">Delete</button></td>
            </tr>
        `).join('');
    } else {
        container.innerHTML = '<tr><td colspan="5" class="empty-state">No API keys yet</td></tr>';
    }
}

async function createApiKey() {
    const name = prompt('Enter a name for this API key:');
    if (!name) return;

    const data = await API.post('/api/apikeys', { name });

    if (data.success) {
        alert(`API Key created!\n\nKey: ${data.apiKey.key}\n\n⚠️ Copy this key now! It won't be shown again.`);
        loadApiKeys();
    } else {
        showToast(data.error || 'Failed to create API key', 'error');
    }
}

async function deleteApiKey(id) {
    if (!confirm('Delete this API key?')) return;

    const data = await API.delete(`/api/apikeys/${id}`);
    if (data.success) {
        showToast('API key deleted', 'success');
        loadApiKeys();
    }
}

// ============ Users ============
async function loadUsers() {
    const data = await API.get('/api/users');
    if (data.success) {
        const container = document.getElementById('usersBody');
        container.innerHTML = data.users.map(u => `
            <tr>
                <td><strong>${u.username}</strong></td>
                <td><span class="status-badge ${u.role === 'admin' ? 'running' : 'stopped'}">${u.role}</span></td>
                <td>${formatDate(u.createdAt)}</td>
                <td>
                    ${u.username !== 'admin'
                ? `<button class="btn btn-small btn-danger" onclick="deleteUser('${u.username}')">Delete</button>`
                : ''
            }
                </td>
            </tr>
        `).join('');
    }
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

// ============ Settings Page ============
function loadSettingsPage() {
    const settings = loadSettings();
    document.getElementById('settingPanelName').value = settings.panelName;

    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === settings.accentColor);
    });

    // Load system info
    API.get('/api/health').then(data => {
        if (data) {
            document.getElementById('infoCgroups').textContent = data.cgroupsAvailable ? 'Available' : 'Not Available';
        }
    });
}

function savePanelSettings() {
    const panelName = document.getElementById('settingPanelName').value || 'NeuroPanel';
    const activeColor = document.querySelector('.color-btn.active')?.dataset.color || '#00d4ff';

    saveSettings({ panelName, accentColor: activeColor });
    applySettings();
    showToast('Settings saved', 'success');
}

async function changePassword() {
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (newPass !== confirm) {
        showToast('Passwords do not match', 'error');
        return;
    }

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const data = await API.put(`/api/users/${user.username}/password`, { newPassword: newPass });

    if (data.success) {
        showToast('Password changed', 'success');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } else {
        showToast(data.error, 'error');
    }
}

async function restartPanel() {
    if (!confirm('Restart the panel? You will be logged out.')) return;
    showToast('Restarting panel...');
    // This would need a server endpoint to actually restart
}

// ============ Utilities ============
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ Event Listeners ============
function setupEventListeners() {
    // Mobile menu
    document.getElementById('menuToggle')?.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('active');
    });

    // Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
        await API.post('/api/auth/logout');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
    });

    // Search/Filter
    document.getElementById('dashboardSearch')?.addEventListener('input', renderDashboardGrid);
    document.getElementById('searchInstances')?.addEventListener('input', renderInstancesTable);
    document.getElementById('filterRuntime')?.addEventListener('change', renderInstancesTable);
    document.getElementById('filterStatus')?.addEventListener('change', renderInstancesTable);

    // New Instance Modal
    document.getElementById('btnNewInstance')?.addEventListener('click', () => {
        document.getElementById('newInstanceModal').classList.add('active');
    });

    document.getElementById('closeNewInstance')?.addEventListener('click', () => {
        document.getElementById('newInstanceModal').classList.remove('active');
    });

    document.getElementById('cancelNewInstance')?.addEventListener('click', () => {
        document.getElementById('newInstanceModal').classList.remove('active');
    });

    // Memory slider
    document.getElementById('newInstanceMemory')?.addEventListener('input', (e) => {
        document.getElementById('memoryValue').textContent = e.target.value;
    });

    document.getElementById('newInstanceForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const userId = document.getElementById('newInstanceId').value;
        const runtime = document.querySelector('input[name="runtime"]:checked').value;
        const maxMemory = document.getElementById('newInstanceMemory').value;

        const data = await API.post('/api/instance', { userId, runtime, maxMemory });

        if (data.success) {
            showToast(`Instance ${userId} created`, 'success');
            document.getElementById('newInstanceModal').classList.remove('active');
            document.getElementById('newInstanceForm').reset();
            document.getElementById('memoryValue').textContent = '100';
            loadInstances();
        } else {
            showToast(data.error, 'error');
        }
    });

    // Instance Detail
    document.getElementById('btnBackToList')?.addEventListener('click', closeInstanceDetail);

    document.getElementById('btnDetailStart')?.addEventListener('click', () => {
        if (currentInstance) startInstance(currentInstance);
    });

    document.getElementById('btnDetailStop')?.addEventListener('click', () => {
        if (currentInstance) stopInstance(currentInstance);
    });

    document.getElementById('btnDetailRestart')?.addEventListener('click', () => {
        if (currentInstance) restartInstance(currentInstance);
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Console
    document.getElementById('btnRefreshConsole')?.addEventListener('click', refreshConsole);
    document.getElementById('btnClearConsole')?.addEventListener('click', clearConsole);

    // Console input
    document.getElementById('btnSendCommand')?.addEventListener('click', sendConsoleCommand);
    document.getElementById('consoleInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendConsoleCommand();
    });

    // Backups
    document.getElementById('btnCreateBackup')?.addEventListener('click', createBackup);

    // Instance Schedules
    document.getElementById('btnNewInstanceSchedule')?.addEventListener('click', () => {
        // Simple schedule creation
        const action = prompt('Enter action (start, stop, restart, backup):');
        if (!action) return;
        const cron = prompt('Enter cron expression (e.g., "*/30 * * * *" for every 30 min):');
        if (!cron) return;
        const name = prompt('Enter schedule name:') || action + ' schedule';

        API.post(`/api/instance/${currentInstance}/schedules`, {
            name,
            action,
            cronExpression: cron,
            enabled: true
        }).then(data => {
            if (data.success) {
                showToast('Schedule created!', 'success');
                loadInstanceSchedules();
            } else {
                showToast(data.error || 'Failed', 'error');
            }
        });
    });

    // API Keys
    document.getElementById('btnNewApiKey')?.addEventListener('click', createApiKey);

    // Files
    document.getElementById('btnNewFile')?.addEventListener('click', () => {
        document.getElementById('newFileModal').classList.add('active');
    });

    document.getElementById('closeNewFile')?.addEventListener('click', () => {
        document.getElementById('newFileModal').classList.remove('active');
    });

    document.getElementById('cancelNewFile')?.addEventListener('click', () => {
        document.getElementById('newFileModal').classList.remove('active');
    });

    document.getElementById('newFileForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        createNewFile();
    });

    document.getElementById('btnUploadFile')?.addEventListener('click', () => {
        document.getElementById('fileUploadInput').click();
    });

    document.getElementById('fileUploadInput')?.addEventListener('change', async (e) => {
        const files = e.target.files;
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`/api/instance/${currentInstance}/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API.token}` },
                body: formData
            });

            const data = await res.json();
            if (data.success) {
                showToast(`${file.name} uploaded`, 'success');
            } else {
                showToast(`Failed to upload ${file.name}`, 'error');
            }
        }
        loadFiles();
        e.target.value = '';
    });

    // File Editor
    document.getElementById('saveFileEditor')?.addEventListener('click', saveFile);
    document.getElementById('closeFileEditor')?.addEventListener('click', () => {
        document.getElementById('fileEditorModal').classList.remove('active');
    });

    // Packages
    document.getElementById('btnInstallPackage')?.addEventListener('click', installPackage);
    document.getElementById('btnInstallMissing')?.addEventListener('click', installMissingPackages);
    document.getElementById('btnEditPackageFile')?.addEventListener('click', () => {
        const fileName = document.getElementById('packageFileName').textContent;
        openFileEditor(fileName);
    });

    // Instance Settings
    document.getElementById('btnSaveInstanceSettings')?.addEventListener('click', saveInstanceSettings);
    document.getElementById('btnDeleteInstance')?.addEventListener('click', () => {
        if (currentInstance) deleteInstance(currentInstance);
    });

    // New User
    document.getElementById('btnNewUser')?.addEventListener('click', () => {
        document.getElementById('newUserModal').classList.add('active');
    });

    document.getElementById('closeNewUser')?.addEventListener('click', () => {
        document.getElementById('newUserModal').classList.remove('active');
    });

    document.getElementById('cancelNewUser')?.addEventListener('click', () => {
        document.getElementById('newUserModal').classList.remove('active');
    });

    document.getElementById('newUserForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newUserPassword').value;
        const role = document.getElementById('newUserRole').value;

        const data = await API.post('/api/users', { username, password, role });

        if (data.success) {
            showToast(`User ${username} created`, 'success');
            document.getElementById('newUserModal').classList.remove('active');
            document.getElementById('newUserForm').reset();
            loadUsers();
        } else {
            showToast(data.error, 'error');
        }
    });

    // Settings
    document.getElementById('btnSaveSettings')?.addEventListener('click', savePanelSettings);
    document.getElementById('btnChangePassword')?.addEventListener('click', changePassword);

    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                if (modal.id === 'instanceModal') {
                    closeInstanceDetail();
                }
            }
        });
    });
}

// ============ Initialize ============
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    applySettings();
    setupNavigation();
    setupEventListeners();
    loadInstances();
});
