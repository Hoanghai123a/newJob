module.exports = {
  apps: [
    {
      name: "jobconnect-frontend",
      cwd: "/var/www/chamcong-main",
      script: ".output/server/index.mjs",
      interpreter: "node",
      node_args: "--env-file=.env",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: 3200,
      },
    },
  ],
};
