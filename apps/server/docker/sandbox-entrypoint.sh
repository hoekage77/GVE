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

# Fix permissions on /workspace to allow terranet user to create node_modules
# This is critical for runtime npm installs, as Daytona may mount the volume with different ownership
if [ -d /workspace ]; then
    CURRENT_OWNER=$(stat -c '%U:%G' /workspace 2>/dev/null || echo 'unknown')
    if [ "$CURRENT_OWNER" != "terranet:terranet" ]; then
        echo "Fixing /workspace permissions from $CURRENT_OWNER to terranet:terranet..."
        chown -R terranet:terranet /workspace 2>/dev/null || \
            echo "Warning: Could not fix /workspace ownership. Filesystem may be read-only or mounted with restrictions."
    fi
fi

# Ensure npm cache directory exists and is writable
mkdir -p /home/terranet/.npm /tmp/npm-cache
chown -R terranet:terranet /home/terranet/.npm /tmp/npm-cache 2>/dev/null || true

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
