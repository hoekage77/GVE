const path = require('path');

module.exports = {
  apps: [
    {
      name: 'dosco-api',
      cwd: __dirname,
      script: 'node',
      args: 'dist/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 8000
        // API keys are loaded from dist/.env file
      }
    }
  ]
};