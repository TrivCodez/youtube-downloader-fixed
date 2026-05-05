#!/usr/bin/env bash
set -e

echo "================================="
echo " YouTube Downloader - Ubuntu Setup"
echo "================================="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found."
  echo "Install with: sudo apt install nodejs npm"
  exit 1
fi
echo "Node.js: $(node -v)"

# Check npm
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found. Install with: sudo apt install npm"
  exit 1
fi

# Check ffmpeg (assumed already installed)
if command -v ffmpeg &>/dev/null; then
  echo "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
else
  echo "WARNING: ffmpeg not found. Install with: sudo apt install ffmpeg"
fi

# Download yt-dlp if not present
if [ ! -f yt-dlp ]; then
  echo "Downloading yt-dlp..."
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
  chmod +x yt-dlp
  echo "yt-dlp ready."
else
  echo "yt-dlp already present."
fi

# npm install
echo "Running npm install..."
npm install

echo ""
echo "Setup complete! Run with:  npm start"
echo "Or just:                   node server.js"
echo ""
echo "Starting now..."
node server.js
