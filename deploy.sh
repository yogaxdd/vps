#!/bin/bash
# Quick deploy script untuk upload ke VPS

VPS_IP="3.107.81.18"
VPS_USER="ubuntu"
VPS_PATH="/home/vps"

echo "🚀 Uploading files to VPS..."

# Upload semua file kecuali node_modules
rsync -avz --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.md' \
  ./ ${VPS_USER}@${VPS_IP}:${VPS_PATH}/

echo "✅ Upload complete!"
echo ""
echo "Jalankan di VPS:"
echo "  cd /home/vps"
echo "  npm install"
echo "  sudo systemctl restart panel-vps"
