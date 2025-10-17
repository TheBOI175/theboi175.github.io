#!/bin/bash

# WebRTC Remote Desktop - Easy Setup Script
# Run this once on your Mac mini to install everything

set -e  # Exit on any error

echo "=================================="
echo "WebRTC Remote Desktop Setup"
echo "=================================="
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This script is for macOS only"
    exit 1
fi

echo "📦 Installing Homebrew (if needed)..."
if ! command -v brew &> /dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "✅ Homebrew already installed"
fi

echo ""
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    brew install node
else
    echo "✅ Node.js already installed ($(node -v))"
fi

echo ""
echo "📦 Installing TypeScript..."
npm install -g typescript ts-node

echo ""
echo "📦 Installing Cloudflare Tunnel..."
if ! command -v cloudflared &> /dev/null; then
    brew install cloudflared
else
    echo "✅ cloudflared already installed"
fi

echo ""
echo "📦 Installing mouse control tool..."
if ! command -v cliclick &> /dev/null; then
    brew install cliclick
else
    echo "✅ cliclick already installed"
fi

echo ""
echo "📦 Installing FFmpeg for screen capture..."
if ! command -v ffmpeg &> /dev/null; then
    brew install ffmpeg
else
    echo "✅ ffmpeg already installed"
fi

echo ""
echo "📦 Installing Node.js dependencies..."
npm install ws express dotenv
npm install --save-dev @types/node @types/ws @types/express

echo ""
echo "🔐 Creating .env configuration file..."

# Generate random token if .env doesn't exist
if [ ! -f .env ]; then
    RANDOM_TOKEN=$(openssl rand -hex 16)
    cat > .env << EOF
PORT=8080
AUTH_TOKEN=${RANDOM_TOKEN}
EOF
    echo "✅ Created .env with secure random token"
    echo ""
    echo "⚠️  SAVE THIS TOKEN - You'll need it to connect:"
    echo "   ${RANDOM_TOKEN}"
    echo ""
else
    echo "✅ .env file already exists"
    echo "Your token: $(grep AUTH_TOKEN .env | cut -d= -f2)"
fi

echo ""
echo "=================================="
echo "✅ Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Run the server:    ts-node server.ts"
echo "2. In another tab:    cloudflared tunnel --url http://localhost:8080"
echo "3. Copy the tunnel URL and your token from .env"
echo "4. Open client.html in any browser and connect!"
echo ""
echo "Your auth token is in the .env file. View it with: cat .env"
echo ""