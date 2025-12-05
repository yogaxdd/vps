const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CGROUP_BASE = '/sys/fs/cgroup/panel';

/**
 * Initialize cgroup base directory
 */
function init() {
    try {
        if (!fs.existsSync(CGROUP_BASE)) {
            execSync(`sudo mkdir -p ${CGROUP_BASE}`);
            // Enable memory controller
            execSync(`echo "+memory" | sudo tee /sys/fs/cgroup/cgroup.subtree_control`);
        }
        return true;
    } catch (err) {
        console.error('Failed to initialize cgroups:', err.message);
        return false;
    }
}

/**
 * Create a cgroup for user with memory limit
 * @param {string} userId - User ID
 * @param {number} memoryMB - Memory limit in MB
 */
function createGroup(userId, memoryMB = 100) {
    const groupPath = path.join(CGROUP_BASE, userId);
    const memoryBytes = memoryMB * 1024 * 1024;

    try {
        if (!fs.existsSync(groupPath)) {
            execSync(`sudo mkdir -p ${groupPath}`);
        }

        // Set memory limit
        execSync(`echo ${memoryBytes} | sudo tee ${groupPath}/memory.max`);

        // Set memory high (soft limit, 90% of max)
        const softLimit = Math.floor(memoryBytes * 0.9);
        execSync(`echo ${softLimit} | sudo tee ${groupPath}/memory.high`);

        return true;
    } catch (err) {
        console.error(`Failed to create cgroup for ${userId}:`, err.message);
        return false;
    }
}

/**
 * Delete a cgroup
 * @param {string} userId - User ID
 */
function deleteGroup(userId) {
    const groupPath = path.join(CGROUP_BASE, userId);

    try {
        if (fs.existsSync(groupPath)) {
            execSync(`sudo rmdir ${groupPath}`);
        }
        return true;
    } catch (err) {
        console.error(`Failed to delete cgroup for ${userId}:`, err.message);
        return false;
    }
}

/**
 * Assign a process to cgroup
 * @param {string} userId - User ID
 * @param {number} pid - Process ID
 */
function assignProcess(userId, pid) {
    const groupPath = path.join(CGROUP_BASE, userId);

    try {
        execSync(`echo ${pid} | sudo tee ${groupPath}/cgroup.procs`);
        return true;
    } catch (err) {
        console.error(`Failed to assign PID ${pid} to cgroup ${userId}:`, err.message);
        return false;
    }
}

/**
 * Get memory usage of cgroup
 * @param {string} userId - User ID
 */
function getMemoryUsage(userId) {
    const groupPath = path.join(CGROUP_BASE, userId);

    try {
        const current = parseInt(fs.readFileSync(path.join(groupPath, 'memory.current'), 'utf8'));
        const max = parseInt(fs.readFileSync(path.join(groupPath, 'memory.max'), 'utf8'));

        return {
            current: current,
            max: max,
            currentMB: Math.round(current / 1024 / 1024),
            maxMB: Math.round(max / 1024 / 1024),
            percent: Math.round((current / max) * 100)
        };
    } catch (err) {
        return null;
    }
}

/**
 * Check if cgroups v2 is available
 */
function isAvailable() {
    try {
        return fs.existsSync('/sys/fs/cgroup/cgroup.controllers');
    } catch {
        return false;
    }
}

module.exports = {
    init,
    createGroup,
    deleteGroup,
    assignProcess,
    getMemoryUsage,
    isAvailable
};
