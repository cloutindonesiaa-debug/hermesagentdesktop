#!/bin/bash
# Hermes Agent Desktop — Restore Script
# Run this on a new desktop to restore your full setup

echo "🚀 Hermes Agent Desktop — Restore"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    echo "   Download: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Install Mission Control dependencies
echo ""
echo "📦 Installing Mission Control dependencies..."
cd mission-control
npm install
if [ $? -ne 0 ]; then
    echo "❌ npm install failed"
    exit 1
fi
echo "✅ Dependencies installed"

# Create .env from example if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "📝 Created .env from example. Edit it to add your API key."
fi

# Delete old database for fresh start
echo ""
echo "🗄️ Setting up fresh database..."
rm -f mission-control.db
echo "✅ Database ready"

# Restore skills to Hermes Agent
echo ""
echo "📚 Restoring skills to Hermes Agent..."
SKILLS_DIR="$HOME/AppData/Local/hermes/skills"
if [ -d "$SKILLS_DIR" ]; then
    echo "   Skills directory found at: $SKILLS_DIR"
    read -p "   Copy skills to Hermes? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp -r ../skills-backup/* "$SKILLS_DIR/"
        echo "✅ Skills restored to Hermes Agent"
    else
        echo "⏭️  Skipped skills restore"
    fi
else
    echo "   ⚠️  Hermes skills directory not found at: $SKILLS_DIR"
    echo "   Skills are available in: skills-backup/"
fi

echo ""
echo "=================================="
echo "✅ Restore complete!"
echo ""
echo "To start Mission Control:"
echo "  cd mission-control"
echo "  PORT=3001 node server.js"
echo ""
echo "Then open: http://localhost:3001"
echo ""
echo "📝 Don't forget to edit .env with your API key:"
echo "  XIAOMI_API_KEY=*** echo "=================================="
