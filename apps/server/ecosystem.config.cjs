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
        PORT: 8000,
        MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || '',
        DAYTONA_API_KEY: process.env.DAYTONA_API_KEY || '',
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        FIREWORKS_API_KEY: process.env.FIREWORKS_API_KEY || ''
      }
    }
  ]
};