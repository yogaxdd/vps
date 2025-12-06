#!/bin/bash
# NeuroPanel SSL Setup Script
# Supports: Let's Encrypt (production) or Self-Signed (development)

set -e

PANEL_DIR="/home/panel"

echo "========================================"
echo "   NeuroPanel SSL Setup"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./ssl-setup.sh)"
    exit 1
fi

# Ask for SSL type
echo "Choose SSL type:"
echo "1) Let's Encrypt (free, requires domain)"
echo "2) Self-Signed (for testing, works with IP)"
read -p "Enter choice [1/2]: " SSL_CHOICE

case $SSL_CHOICE in
    1)
        SSL_TYPE="letsencrypt"
        ;;
    2)
        SSL_TYPE="selfsigned"
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# ====== LET'S ENCRYPT ======
if [ "$SSL_TYPE" == "letsencrypt" ]; then
    echo ""
    read -p "Enter your domain (e.g., panel.example.com): " DOMAIN
    read -p "Enter your email for Let's Encrypt: " EMAIL

    if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
        echo "Domain and email are required"
        exit 1
    fi

    echo ""
    echo "Installing Certbot..."
    apt update
    apt install -y certbot

    echo ""
    echo "Stopping panel temporarily..."
    systemctl stop panel-vps 2>/dev/null || true

    echo ""
    echo "Obtaining certificate..."
    certbot certonly --standalone \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        -d "$DOMAIN"

    # Create SSL directory
    mkdir -p "$PANEL_DIR/ssl"
    
    # Copy certificates
    cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$PANEL_DIR/ssl/cert.pem"
    cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$PANEL_DIR/ssl/key.pem"
    chown -R root:root "$PANEL_DIR/ssl"
    chmod 600 "$PANEL_DIR/ssl/"*

    echo ""
    echo "✅ Let's Encrypt SSL configured!"

# ====== SELF-SIGNED ======
else
    echo ""
    echo "Generating self-signed certificate..."
    echo "(Valid for 365 days)"

    mkdir -p "$PANEL_DIR/ssl"

    # Generate self-signed certificate with proper settings
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$PANEL_DIR/ssl/key.pem" \
        -out "$PANEL_DIR/ssl/cert.pem" \
        -subj "/C=ID/ST=State/L=City/O=NeuroPanel/CN=localhost"

    chmod 600 "$PANEL_DIR/ssl/"*

    echo ""
    echo "✅ Self-signed SSL configured!"
    echo "⚠️ Browser will show security warning (normal for self-signed)"
fi

# Update systemd service to run on ports 80 and 443
cat > /etc/systemd/system/panel-vps.service << EOF
[Unit]
Description=NeuroPanel VPS Management
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
ExecStart=/usr/bin/node $PANEL_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HTTPS_PORT=443
Environment=ENABLE_SSL=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart panel-vps

echo ""
echo "========================================"
echo "   SSL Setup Complete! 🔒"
echo "========================================"
echo ""
if [ "$SSL_TYPE" == "letsencrypt" ]; then
    echo "Access your panel at:"
    echo "  https://$DOMAIN"
else
    echo "Access your panel at:"
    echo "  https://YOUR_IP"
    echo ""
    echo "Note: If using self-signed certificate,"
    echo "you'll need to accept the security warning"
    echo "in your browser."
fi
echo ""
