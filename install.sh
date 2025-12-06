#!/bin/bash
# Simple Panel VPS Installer
# Run: chmod +x install.sh && sudo ./install.sh

set -e

echo "================================"
echo "  NeuroPanel Quick Install"
echo "================================"
echo ""

# Update system
echo "📦 Updating system..."
apt update

# Install Node.js
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Install Python (for Python bots)
if ! command -v python3 &> /dev/null; then
    echo "📦 Installing Python..."
    apt install -y python3 python3-pip
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p /home/ubuntu/vps/users
mkdir -p /home/ubuntu/vps/data
mkdir -p /home/ubuntu/vps/public

# Install dependencies
echo "📦 Installing panel dependencies..."
cd /home/ubuntu/vps
npm install

# Create systemd service
echo "⚙️ Creating systemd service..."
cat > /etc/systemd/system/panel-vps.service << 'EOF'
[Unit]
Description=NeuroPanel VPS Management
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/ubuntu/vps
ExecStart=/usr/bin/node /home/ubuntu/vps/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable panel-vps
systemctl start panel-vps

echo ""
echo "================================"
echo "  ✅ Installation Complete!"
echo "================================"
echo ""
echo "Panel running at: http://YOUR_IP:3000"
echo "Default login: admin / admin123"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status panel-vps   # Check status"
echo "  sudo systemctl restart panel-vps  # Restart"
echo "  sudo journalctl -u panel-vps -f   # View logs"
echo ""
