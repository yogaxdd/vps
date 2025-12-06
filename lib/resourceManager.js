/**
 * Resource Manager - Monitor CPU, RAM, Disk per instance
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class ResourceManager {
    constructor() {
        this.BASE_DIR = process.env.PANEL_DIR || '/home/panel';
    }

    // Get system-wide resources
    getSystemResources() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        return {
            cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || 'Unknown',
                usage: this._getCpuUsage()
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                percentage: Math.round((usedMem / totalMem) * 100)
            },
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            platform: os.platform(),
            hostname: os.hostname()
        };
    }

    // Get CPU usage percentage
    _getCpuUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });

        return Math.round(100 - (totalIdle / totalTick) * 100);
    }

    // Get disk usage
    async getDiskUsage() {
        return new Promise((resolve) => {
            exec('df -h / | tail -1', (error, stdout) => {
                if (error) {
                    resolve({ total: 'N/A', used: 'N/A', free: 'N/A', percentage: 0 });
                    return;
                }

                const parts = stdout.trim().split(/\s+/);
                resolve({
                    total: parts[1] || 'N/A',
                    used: parts[2] || 'N/A',
                    free: parts[3] || 'N/A',
                    percentage: parseInt(parts[4]) || 0
                });
            });
        });
    }

    // Get instance-specific resource usage via PM2
    async getInstanceResources(userId) {
        return new Promise((resolve) => {
            exec(`pm2 jlist`, (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }

                try {
                    const processes = JSON.parse(stdout);
                    const proc = processes.find(p => p.name === userId);

                    if (!proc) {
                        resolve(null);
                        return;
                    }

                    resolve({
                        pid: proc.pid,
                        name: proc.name,
                        status: proc.pm2_env?.status || 'unknown',
                        cpu: proc.monit?.cpu || 0,
                        memory: proc.monit?.memory || 0,
                        uptime: proc.pm2_env?.pm_uptime || 0,
                        restarts: proc.pm2_env?.restart_time || 0,
                        createdAt: proc.pm2_env?.created_at || null
                    });
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }

    // Get folder size for an instance
    async getInstanceDiskUsage(userId) {
        const userDir = path.join(this.BASE_DIR, 'users', userId);

        return new Promise((resolve) => {
            exec(`du -sh "${userDir}" 2>/dev/null | cut -f1`, (error, stdout) => {
                if (error) {
                    resolve('0B');
                    return;
                }
                resolve(stdout.trim() || '0B');
            });
        });
    }

    // Get all instances resources
    async getAllInstancesResources() {
        return new Promise((resolve) => {
            exec('pm2 jlist', (error, stdout) => {
                if (error) {
                    resolve([]);
                    return;
                }

                try {
                    const processes = JSON.parse(stdout);
                    const resources = processes.map(proc => ({
                        name: proc.name,
                        pid: proc.pid,
                        status: proc.pm2_env?.status || 'unknown',
                        cpu: proc.monit?.cpu || 0,
                        memory: proc.monit?.memory || 0,
                        uptime: proc.pm2_env?.pm_uptime || 0,
                        restarts: proc.pm2_env?.restart_time || 0
                    }));
                    resolve(resources);
                } catch (e) {
                    resolve([]);
                }
            });
        });
    }
}

module.exports = new ResourceManager();
