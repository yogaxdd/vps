# NeuroPanel - Simple VPS Bot Manager

Lightweight panel untuk manage bot Python/Node.js di VPS.

## 🚀 Quick Start

### 1. Upload ke VPS
```bash
# Upload semua file ke /home/vps/
scp -r * ubuntu@YOUR_IP:/home/vps/
```

### 2. Install
```bash
cd /home/vps
chmod +x install.sh
sudo ./install.sh
```

### 3. Akses Panel
```
http://YOUR_IP:3000
Login: admin / admin123
```

## 📱 Mobile Access
Panel bisa diakses dari HP dengan URL yang sama: `http://YOUR_IP:3000`

## 🔧 Manual Setup (tanpa install.sh)

```bash
cd /home/vps
npm install
npm start
```

## 📋 Features

- ✅ Start/Stop/Restart bot
- ✅ Real-time console logs
- ✅ File manager (edit, upload)
- ✅ Package manager (npm/pip install)
- ✅ Memory limits per instance
- ✅ Auto pip install on start
- ✅ Configurable main file & requirements file

## 🛠️ Commands

```bash
# Start panel
npm start

# View logs
sudo journalctl -u panel-vps -f

# Restart panel
sudo systemctl restart panel-vps

# Stop panel
sudo systemctl stop panel-vps
```

## 📁 Structure

```
/home/vps/
├── server.js          # Main server
├── lib/              # Backend modules
├── public/           # Frontend files
├── users/            # Bot instances
└── data/             # Database files
```

## 🔐 Default Login

- Username: `admin`
- Password: `admin123`

Change password di Settings page setelah login!

## ⚙️ Instance Settings

Setiap instance bisa di-configure:
- **Main File**: nama file bot (app.py, bot.py, index.js, dll)
- **Requirements File**: nama file dependencies (requirements.txt, package.json)
- **Auto Install**: otomatis install dependencies saat start

## 🐛 Troubleshooting

**Panel tidak bisa diakses:**
```bash
# Cek status
sudo systemctl status panel-vps

# Cek logs
sudo journalctl -u panel-vps -f

# Restart
sudo systemctl restart panel-vps
```

**Port 3000 tidak bisa diakses:**
- Pastikan security group AWS allow port 3000
- Atau pakai firewall: `sudo ufw allow 3000`

**Bot tidak start:**
- Cek console logs di panel
- Pastikan file main (app.py/app.js) ada
- Cek dependencies sudah terinstall

## 📞 Support

Untuk bug report atau feature request, hubungi developer.
