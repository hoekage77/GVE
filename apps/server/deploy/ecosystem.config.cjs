const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "dosco-api",
      cwd: path.join(__dirname, ".."),
      script: "server/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 8000
      }
    }
  ]
};