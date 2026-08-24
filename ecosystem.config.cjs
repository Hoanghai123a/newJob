module.exports = {
  apps: [
    {
      name: "jobconnect-frontend",
      cwd: "/var/www/newApp",
      script: ".output/server/index.mjs",
      interpreter: "node",
      node_args: "--env-file=.env",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 3200,
        HOST: "127.0.0.1",
      },
    },
  ],
};
