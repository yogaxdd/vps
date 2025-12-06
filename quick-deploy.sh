#!/bin/bash
# Quick Deploy - Upload dan restart panel
# Usage: ./quick-deploy.sh

VPS_IP="3.107.81.18"
VPS_USER="ubuntu"
VPS_PATH="/home/ubuntu/vps"

echo "🚀 Deploying to VPS..."

# Upload files (exclude node_modules)
echo "📤 Uploading files..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.md' \
  --exclude 'deploy.sh' \
  ./ ${VPS_USER}@${VPS_IP}:${VPS_PATH}/

echo ""
echo "✅ Files uploaded!"
echo ""
echo "Jalankan di VPS:"
echo "  cd /home/ubuntu/vps"
echo "  npm install"
echo "  npm start"
echo ""
echo "Atau pakai systemd:"
echo "  sudo systemctl restart panel-vps"
