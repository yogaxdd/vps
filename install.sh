#!/bin/bash

# ============================================
# Panel VPS Installer
# Lightweight Bot Management Panel
# ============================================

set -e

echo "=========================================="
echo "  Panel VPS Installer"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# ============ STEP 1: Update System ============
echo ""
echo "Step 1: Updating system..."
apt update -qq
print_status "System updated"

# ============ STEP 2: Install Dependencies ============
echo ""
echo "Step 2: Installing dependencies..."

# Install Node.js 20 LTS
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    print_status "Node.js installed: $(node -v)"
else
    print_status "Node.js already installed: $(node -v)"
fi

# Install Python 3
if ! command -v python3 &> /dev/null; then
    apt install -y python3 python3-pip
    print_status "Python3 installed: $(python3 --version)"
else
    print_status "Python3 already installed: $(python3 --version)"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    print_status "PM2 installed: $(pm2 -v)"
else
    print_status "PM2 already installed: $(pm2 -v)"
fi

# ============ STEP 3: Create Directories ============
echo ""
echo "Step 3: Creating directories..."

mkdir -p /home/panel/users
mkdir -p /home/panel/data
mkdir -p /home/panel/lib

print_status "Directories created"

# ============ STEP 4: Copy Panel Files ============
echo ""
echo "Step 4: Copying panel files..."

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cp "$SCRIPT_DIR/server.js" /home/panel/
cp "$SCRIPT_DIR/package.json" /home/panel/
cp -r "$SCRIPT_DIR/lib/"* /home/panel/lib/

print_status "Panel files copied"

# ============ STEP 5: Install Node Dependencies ============
echo ""
echo "Step 5: Installing Node dependencies..."

cd /home/panel
npm install --production

print_status "Dependencies installed"

# ============ STEP 6: Setup cgroups v2 ============
echo ""
echo "Step 6: Setting up cgroups v2..."

# Check if cgroups v2 is available
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    mkdir -p /sys/fs/cgroup/panel
    echo "+memory" > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
    print_status "cgroups v2 configured"
else
    print_warning "cgroups v2 not available, RAM limiting will use PM2 only"
fi

# ============ STEP 7: Install Systemd Service ============
echo ""
echo "Step 7: Setting up systemd service..."

cp "$SCRIPT_DIR/panel.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable panel-vps
systemctl start panel-vps

print_status "Systemd service installed and started"

# ============ STEP 8: Configure PM2 Startup ============
echo ""
echo "Step 8: Configuring PM2 startup..."

pm2 startup systemd -u root --hp /root
pm2 save

print_status "PM2 startup configured"

# ============ STEP 9: Setup Firewall (Optional) ============
echo ""
echo "Step 9: Checking firewall..."

if command -v ufw &> /dev/null; then
    ufw allow 3000/tcp 2>/dev/null || true
    print_status "Port 3000 allowed in UFW"
fi

# ============ DONE ============
echo ""
echo "=========================================="
echo -e "${GREEN}  Installation Complete!${NC}"
echo "=========================================="
echo ""
echo "Panel URL: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Useful commands:"
echo "  - Check status:  systemctl status panel-vps"
echo "  - View logs:     journalctl -u panel-vps -f"
echo "  - Restart:       systemctl restart panel-vps"
echo ""
echo "API Endpoints:"
echo "  - GET  /api/health              - Health check"
echo "  - GET  /api/instances           - List all instances"
echo "  - POST /api/instance            - Create instance"
echo "  - POST /api/instance/:id/start  - Start bot"
echo "  - POST /api/instance/:id/stop   - Stop bot"
echo "  - GET  /api/instance/:id/logs   - Get logs"
echo ""
