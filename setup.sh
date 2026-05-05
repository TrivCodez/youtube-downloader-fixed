#!/usr/bin/env bash
# Setup script for macOS / Linux
set -e

echo "================================="
echo " YouTube Downloader - Setup"
echo "================================="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "Node.js: $(node -v)"

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Download yt-dlp if not present
if [ ! -f yt-dlp ]; then
  echo "Downloading yt-dlp..."
  OS=$(uname -s)
  if [ "$OS" = "Darwin" ]; then
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o yt-dlp
  else
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
  fi
  chmod +x yt-dlp
  echo "yt-dlp downloaded."
else
  echo "yt-dlp already present."
fi

# Check ffmpeg
if ! command -v ffmpeg &>/dev/null && [ ! -f ffmpeg ]; then
  echo "WARNING: ffmpeg not found. Install via: brew install ffmpeg  OR  sudo apt install ffmpeg"
fi

echo ""
echo "Setup complete! Starting server..."
node server.js
