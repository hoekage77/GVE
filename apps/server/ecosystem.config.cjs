module.exports = {
  apps: [
    {
      name: 'dosco-api',
      script: 'node',
      args: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 8000
      },
      watch: false,
      autorestart: true,
      max_memory_restart: '1G'
    }
  ]
};