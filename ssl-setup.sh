#!/bin/bash
# NeuroPanel SSL Setup Script
# Supports: Let's Encrypt (production) or Self-Signed (development)

set -e

PANEL_DIR="/home/panel"
DOMAIN=""
EMAIL=""
SSL_TYPE=""

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
    chown -R panel:panel "$PANEL_DIR/ssl"
    chmod 600 "$PANEL_DIR/ssl/"*

    # Create auto-renewal hook
    cat > /etc/letsencrypt/renewal-hooks/post/panel-reload.sh << 'EOF'
#!/bin/bash
cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "/home/panel/ssl/cert.pem"
cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "/home/panel/ssl/key.pem"
chown panel:panel /home/panel/ssl/*
systemctl restart panel-vps
EOF
    chmod +x /etc/letsencrypt/renewal-hooks/post/panel-reload.sh

    echo ""
    echo "✅ Let's Encrypt SSL configured!"
    echo "Certificate will auto-renew via certbot timer"

# ====== SELF-SIGNED ======
else
    echo ""
    echo "Generating self-signed certificate..."
    echo "(Valid for 365 days)"

    mkdir -p "$PANEL_DIR/ssl"

    # Generate self-signed certificate
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$PANEL_DIR/ssl/key.pem" \
        -out "$PANEL_DIR/ssl/cert.pem" \
        -subj "/C=ID/ST=State/L=City/O=NeuroPanel/CN=localhost"

    chown -R panel:panel "$PANEL_DIR/ssl" 2>/dev/null || true
    chmod 600 "$PANEL_DIR/ssl/"*

    echo ""
    echo "✅ Self-signed SSL configured!"
    echo "⚠️ Browser will show security warning (normal for self-signed)"
fi

# Create SSL-enabled server wrapper
echo ""
echo "Creating HTTPS server..."

cat > "$PANEL_DIR/server-ssl.js" << 'EOF'
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Check if SSL certificates exist
const sslDir = path.join(__dirname, 'ssl');
const certPath = path.join(sslDir, 'cert.pem');
const keyPath = path.join(sslDir, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    // Load the main app
    const app = require('./server');

    const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    // HTTPS server on port 443
    const HTTPS_PORT = process.env.HTTPS_PORT || 443;
    const HTTP_PORT = process.env.PORT || 3000;

    https.createServer(options, app).listen(HTTPS_PORT, () => {
        console.log(`HTTPS server running on port ${HTTPS_PORT}`);
    });

    // HTTP redirect to HTTPS
    http.createServer((req, res) => {
        const host = req.headers.host?.replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`) || `localhost:${HTTPS_PORT}`;
        res.writeHead(301, { Location: `https://${host}${req.url}` });
        res.end();
    }).listen(HTTP_PORT, () => {
        console.log(`HTTP redirect server on port ${HTTP_PORT}`);
    });
} else {
    console.log('SSL certificates not found. Run ssl-setup.sh first.');
    console.log('Starting in HTTP mode...');
    require('./server');
}
EOF

# Update server.js to export app
echo ""
echo "Updating server.js to support SSL..."

# Check if server.js already exports app
if ! grep -q "module.exports = app" "$PANEL_DIR/server.js"; then
    # Add export at the end (before listen)
    sed -i 's/app.listen(PORT/module.exports = app;\n\nif (require.main === module) {\n    app.listen(PORT/g' "$PANEL_DIR/server.js"
    echo "})" >> "$PANEL_DIR/server.js"
fi

# Update systemd service
cat > /etc/systemd/system/panel-vps.service << EOF
[Unit]
Description=NeuroPanel VPS Management
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
ExecStart=/usr/bin/node $PANEL_DIR/server-ssl.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=80
Environment=HTTPS_PORT=443

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
echo "Access your panel at:"
if [ "$SSL_TYPE" == "letsencrypt" ]; then
    echo "  https://$DOMAIN"
else
    echo "  https://YOUR_IP"
fi
echo ""
echo "Note: If using self-signed certificate,"
echo "you'll need to accept the security warning"
echo "in your browser."
echo ""
