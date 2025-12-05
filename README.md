# Panel VPS - Lightweight Bot Management

Panel manajemen bot sederhana untuk VPS dengan resource terbatas (1GB RAM).

## Features

- ✅ Start/Stop/Restart bot via API
- ✅ Support NodeJS & Python runtime
- ✅ RAM limiting per process (cgroups v2)
- ✅ Log viewer
- ✅ File upload
- ✅ Autostart saat reboot (systemd)
- ✅ PM2 integration

## Requirements

- Ubuntu 22.04+ / Debian 11+
- NodeJS 18+
- Python 3.8+
- Root access

## Quick Install

```bash
# Clone/upload files to VPS
cd /root
git clone https://github.com/yourusername/panel-vps.git
cd panel-vps

# Run installer
chmod +x install.sh
sudo ./install.sh
```

## API Endpoints

### Health Check
```bash
curl http://localhost:3000/api/health
```

### Create Instance
```bash
curl -X POST http://localhost:3000/api/instance \
  -H "Content-Type: application/json" \
  -d '{"userId":"bot1","runtime":"node","maxMemory":100}'
```

### Start Bot
```bash
curl -X POST http://localhost:3000/api/instance/bot1/start
```

### Stop Bot
```bash
curl -X POST http://localhost:3000/api/instance/bot1/stop
```

### Restart Bot
```bash
curl -X POST http://localhost:3000/api/instance/bot1/restart
```

### Get Logs
```bash
curl http://localhost:3000/api/instance/bot1/logs?lines=50
```

### Upload File
```bash
curl -X POST http://localhost:3000/api/instance/bot1/upload \
  -F "file=@app.js"
```

### List All Instances
```bash
curl http://localhost:3000/api/instances
```

### Delete Instance
```bash
curl -X DELETE http://localhost:3000/api/instance/bot1
```

## File Structure

```
/home/panel/
├── server.js           # Main API
├── package.json
├── lib/
│   ├── pm2Manager.js
│   ├── cgroupManager.js
│   ├── instanceManager.js
│   └── logManager.js
├── data/
│   └── instances.json
└── users/
    └── [userid]/
        ├── app.js / app.py
        ├── log.txt
        └── config.json
```

## Memory Budget (1GB VPS)

| Komponen | RAM |
|----------|-----|
| OS + Linux | ~200MB |
| Panel API | ~50MB |
| PM2 Daemon | ~30MB |
| Available untuk bots | ~720MB |

## Useful Commands

```bash
# Panel status
systemctl status panel-vps

# Panel logs
journalctl -u panel-vps -f

# Restart panel
systemctl restart panel-vps

# PM2 status
pm2 list

# PM2 logs
pm2 logs
```

## License

MIT
