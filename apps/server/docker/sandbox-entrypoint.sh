#!/bin/bash
# Terranet Sandbox Entrypoint Script
# Handles initialization and graceful shutdown

set -e

# Start X virtual framebuffer for headless rendering
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:99
fi

# Start Xvfb if not already running
if ! pgrep -x "Xvfb" > /dev/null; then
    echo "Starting Xvfb on display $DISPLAY..."
    Xvfb $DISPLAY -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
    sleep 1
fi

# Verify Mesa/GL is working
echo "Verifying graphics support..."
glxinfo -B 2>/dev/null || echo "GLX info not available (this is OK for headless)"

# Set up workspace
if [ ! -f /workspace/package.json ]; then
    echo "Initializing workspace..."
    cat > /workspace/package.json << 'EOF'
{
  "name": "terranet-scene",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {},
  "scripts": {
    "start": "node index.js",
    "build": "vite build",
    "preview": "vite preview"
  }
}
EOF
fi

# Handle signals gracefully
shutdown() {
    echo "Received shutdown signal, cleaning up..."
    # Kill Xvfb if we started it
    if pgrep -x "Xvfb" > /dev/null; then
        pkill -x Xvfb || true
    fi
    exit 0
}

trap shutdown SIGTERM SIGINT

echo "Terranet Sandbox Ready"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"
echo "Graphics: DISPLAY=$DISPLAY"

# Execute the provided command
exec "$@"
