/**
 * Console Manager - Handle interactive console with input/output
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ConsoleManager extends EventEmitter {
    constructor() {
        super();
        this.processes = new Map(); // Map of instanceId -> child process
        this.DATA_DIR = process.env.PANEL_DIR || '/home/panel';
    }

    // Start an interactive process
    startProcess(instanceId, runtime, options = {}) {
        // Kill existing process first
        this.killProcess(instanceId);

        const userDir = path.join(this.DATA_DIR, 'users', instanceId);

        if (!fs.existsSync(userDir)) {
            throw new Error('Instance directory not found');
        }

        const mainFile = runtime === 'python' ? 'app.py' : 'app.js';
        const mainPath = path.join(userDir, mainFile);

        if (!fs.existsSync(mainPath)) {
            throw new Error(`Main file not found: ${mainFile}`);
        }

        const command = runtime === 'python' ? 'python3' : 'node';
        const args = [mainFile];

        const proc = spawn(command, args, {
            cwd: userDir,
            env: { ...process.env, ...options.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const logFile = path.join(userDir, 'log.txt');
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });

        // Handle stdout
        proc.stdout.on('data', (data) => {
            const output = data.toString();
            logStream.write(output);
            this.emit('output', instanceId, output, 'stdout');
        });

        // Handle stderr
        proc.stderr.on('data', (data) => {
            const output = data.toString();
            logStream.write(output);
            this.emit('output', instanceId, output, 'stderr');
        });

        // Handle close
        proc.on('close', (code) => {
            const message = `Process exited with code ${code}\n`;
            logStream.write(message);
            logStream.end();
            this.processes.delete(instanceId);
            this.emit('exit', instanceId, code);
        });

        // Handle error
        proc.on('error', (error) => {
            const message = `Process error: ${error.message}\n`;
            logStream.write(message);
            this.emit('error', instanceId, error);
        });

        this.processes.set(instanceId, {
            process: proc,
            logStream,
            runtime,
            startedAt: new Date()
        });

        return {
            pid: proc.pid,
            instanceId,
            runtime
        };
    }

    // Send input to process stdin
    sendInput(instanceId, input) {
        const entry = this.processes.get(instanceId);
        if (!entry || !entry.process) {
            throw new Error('Process not running');
        }

        const proc = entry.process;
        if (!proc.stdin.writable) {
            throw new Error('Process stdin not writable');
        }

        // Add newline if not present
        const command = input.endsWith('\n') ? input : input + '\n';
        proc.stdin.write(command);

        // Log the command
        entry.logStream.write(`> ${input}\n`);

        return true;
    }

    // Kill a process
    killProcess(instanceId) {
        const entry = this.processes.get(instanceId);
        if (!entry) return false;

        try {
            entry.process.kill('SIGTERM');

            // Force kill after 5 seconds
            setTimeout(() => {
                try {
                    entry.process.kill('SIGKILL');
                } catch (e) { }
            }, 5000);

            entry.logStream.end();
            this.processes.delete(instanceId);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Check if process is running
    isRunning(instanceId) {
        const entry = this.processes.get(instanceId);
        return entry && entry.process && !entry.process.killed;
    }

    // Get process info
    getProcessInfo(instanceId) {
        const entry = this.processes.get(instanceId);
        if (!entry) return null;

        return {
            pid: entry.process.pid,
            runtime: entry.runtime,
            startedAt: entry.startedAt,
            running: !entry.process.killed
        };
    }

    // Get all running processes
    getAllProcesses() {
        const result = [];
        for (const [instanceId, entry] of this.processes) {
            result.push({
                instanceId,
                pid: entry.process.pid,
                runtime: entry.runtime,
                startedAt: entry.startedAt,
                running: !entry.process.killed
            });
        }
        return result;
    }
}

module.exports = new ConsoleManager();
