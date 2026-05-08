const path = require('path');

module.exports = {
  apps: [
    {
      name: 'dosco-api',
      cwd: __dirname,
      script: 'npm',
      args: 'start',
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
      }
    }
  ]
};