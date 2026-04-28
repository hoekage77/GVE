module.exports = {
  apps: [
    {
      name: 'dosco-api',
      script: 'npm',
      args: 'run start',
      cwd: '/root/GVE/apps/server',
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