/**
 * Task Scheduler - Cron-like scheduling for instances
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class SchedulerManager {
    constructor() {
        this.DATA_DIR = process.env.PANEL_DIR || '/home/panel';
        this.SCHEDULES_FILE = path.join(this.DATA_DIR, 'data', 'schedules.json');
        this.schedules = this._load();
        this.timers = new Map();
        this._startAllSchedulers();
    }

    _load() {
        try {
            if (fs.existsSync(this.SCHEDULES_FILE)) {
                return JSON.parse(fs.readFileSync(this.SCHEDULES_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('Error loading schedules:', e.message);
        }
        return [];
    }

    _save() {
        try {
            const dir = path.dirname(this.SCHEDULES_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2));
        } catch (e) {
            console.error('Error saving schedules:', e.message);
        }
    }

    // Create a new schedule
    create(schedule) {
        const newSchedule = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            instanceId: schedule.instanceId,
            name: schedule.name || 'Unnamed Task',
            action: schedule.action, // 'start', 'stop', 'restart', 'command', 'backup'
            command: schedule.command || null,
            cronExpression: schedule.cronExpression, // Simple format: "minute hour dayOfMonth month dayOfWeek"
            enabled: schedule.enabled !== false,
            lastRun: null,
            nextRun: null,
            createdAt: new Date().toISOString()
        };

        // Parse cron and calculate next run
        newSchedule.nextRun = this._calculateNextRun(newSchedule.cronExpression);

        this.schedules.push(newSchedule);
        this._save();
        this._startScheduler(newSchedule);

        return newSchedule;
    }

    // Get all schedules
    list(instanceId = null) {
        if (instanceId) {
            return this.schedules.filter(s => s.instanceId === instanceId);
        }
        return this.schedules;
    }

    // Get single schedule
    get(scheduleId) {
        return this.schedules.find(s => s.id === scheduleId);
    }

    // Update schedule
    update(scheduleId, updates) {
        const index = this.schedules.findIndex(s => s.id === scheduleId);
        if (index === -1) return null;

        const schedule = this.schedules[index];
        Object.assign(schedule, updates);

        if (updates.cronExpression) {
            schedule.nextRun = this._calculateNextRun(updates.cronExpression);
        }

        this._save();

        // Restart the scheduler
        this._stopScheduler(scheduleId);
        if (schedule.enabled) {
            this._startScheduler(schedule);
        }

        return schedule;
    }

    // Delete schedule
    delete(scheduleId) {
        this._stopScheduler(scheduleId);
        this.schedules = this.schedules.filter(s => s.id !== scheduleId);
        this._save();
    }

    // Toggle schedule
    toggle(scheduleId) {
        const schedule = this.schedules.find(s => s.id === scheduleId);
        if (!schedule) return null;

        schedule.enabled = !schedule.enabled;
        this._save();

        if (schedule.enabled) {
            this._startScheduler(schedule);
        } else {
            this._stopScheduler(scheduleId);
        }

        return schedule;
    }

    // Calculate next run time from cron expression
    _calculateNextRun(cronExpression) {
        // Simple cron parser: "minute hour dayOfMonth month dayOfWeek"
        // For now, we'll calculate approximate next run
        const parts = cronExpression.split(' ');
        if (parts.length < 5) return null;

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        const now = new Date();
        const next = new Date(now);

        // Handle simple cases
        if (minute !== '*') next.setMinutes(parseInt(minute));
        if (hour !== '*') next.setHours(parseInt(hour));

        // If time has passed today, move to next occurrence
        if (next <= now) {
            if (hour !== '*' || minute !== '*') {
                next.setDate(next.getDate() + 1);
            } else {
                next.setMinutes(next.getMinutes() + 1);
            }
        }

        return next.toISOString();
    }

    // Get interval from cron expression (simplified)
    _getIntervalFromCron(cronExpression) {
        const parts = cronExpression.split(' ');
        const [minute, hour] = parts;

        // Every X minutes
        if (minute.startsWith('*/')) {
            return parseInt(minute.slice(2)) * 60 * 1000;
        }
        // Every X hours
        if (hour.startsWith('*/')) {
            return parseInt(hour.slice(2)) * 60 * 60 * 1000;
        }
        // Fixed time (daily)
        if (minute !== '*' && hour !== '*') {
            return 24 * 60 * 60 * 1000; // Daily
        }
        // Every minute
        if (minute === '*' && hour === '*') {
            return 60 * 1000;
        }
        // Every hour
        if (minute !== '*' && hour === '*') {
            return 60 * 60 * 1000;
        }

        return 60 * 60 * 1000; // Default: 1 hour
    }

    // Start a scheduler timer
    _startScheduler(schedule) {
        if (!schedule.enabled) return;

        const interval = this._getIntervalFromCron(schedule.cronExpression);

        // Calculate initial delay
        let initialDelay = 0;
        if (schedule.nextRun) {
            const nextRunTime = new Date(schedule.nextRun).getTime();
            initialDelay = Math.max(0, nextRunTime - Date.now());
        }

        // Set timeout for first run, then interval
        const timeoutId = setTimeout(() => {
            this._executeSchedule(schedule);

            const intervalId = setInterval(() => {
                this._executeSchedule(schedule);
            }, interval);

            this.timers.set(schedule.id, { intervalId });
        }, initialDelay);

        this.timers.set(schedule.id, { timeoutId });
    }

    // Stop a scheduler
    _stopScheduler(scheduleId) {
        const timer = this.timers.get(scheduleId);
        if (timer) {
            if (timer.timeoutId) clearTimeout(timer.timeoutId);
            if (timer.intervalId) clearInterval(timer.intervalId);
            this.timers.delete(scheduleId);
        }
    }

    // Start all schedulers
    _startAllSchedulers() {
        this.schedules.forEach(schedule => {
            if (schedule.enabled) {
                this._startScheduler(schedule);
            }
        });
    }

    // Execute a scheduled task
    async _executeSchedule(schedule) {
        console.log(`[Scheduler] Executing: ${schedule.name} (${schedule.action})`);

        const pm2Manager = require('./pm2Manager');
        const logManager = require('./logManager');

        try {
            switch (schedule.action) {
                case 'start':
                    await pm2Manager.startProcess(schedule.instanceId, 'node', 100);
                    break;
                case 'stop':
                    await pm2Manager.stopProcess(schedule.instanceId);
                    break;
                case 'restart':
                    await pm2Manager.restartProcess(schedule.instanceId);
                    break;
                case 'command':
                    if (schedule.command) {
                        // Execute command in instance directory
                        const userDir = path.join(this.DATA_DIR, 'users', schedule.instanceId);
                        exec(schedule.command, { cwd: userDir }, (error, stdout, stderr) => {
                            logManager.append(schedule.instanceId, `[Scheduled Command] ${schedule.command}`);
                            if (stdout) logManager.append(schedule.instanceId, stdout);
                            if (stderr) logManager.append(schedule.instanceId, stderr);
                        });
                    }
                    break;
                case 'backup':
                    // Create backup
                    const userDir = path.join(this.DATA_DIR, 'users', schedule.instanceId);
                    const backupDir = path.join(this.DATA_DIR, 'backups', schedule.instanceId);
                    const backupName = `backup-${Date.now()}.tar.gz`;

                    if (!fs.existsSync(backupDir)) {
                        fs.mkdirSync(backupDir, { recursive: true });
                    }

                    exec(`tar -czf "${path.join(backupDir, backupName)}" -C "${userDir}" .`, (error) => {
                        if (error) {
                            logManager.append(schedule.instanceId, `[Backup] Failed: ${error.message}`);
                        } else {
                            logManager.append(schedule.instanceId, `[Backup] Created: ${backupName}`);
                        }
                    });
                    break;
            }

            // Update last run
            const idx = this.schedules.findIndex(s => s.id === schedule.id);
            if (idx !== -1) {
                this.schedules[idx].lastRun = new Date().toISOString();
                this.schedules[idx].nextRun = this._calculateNextRun(schedule.cronExpression);
                this._save();
            }

            logManager.append(schedule.instanceId, `[Scheduler] Task "${schedule.name}" completed`);

        } catch (error) {
            console.error(`[Scheduler] Error executing ${schedule.name}:`, error.message);
        }
    }

    // Run a schedule immediately
    async runNow(scheduleId) {
        const schedule = this.schedules.find(s => s.id === scheduleId);
        if (!schedule) return false;

        await this._executeSchedule(schedule);
        return true;
    }
}

module.exports = new SchedulerManager();
