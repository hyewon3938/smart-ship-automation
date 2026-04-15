module.exports = {
  apps: [
    {
      name: "smart-ship",
      script: ".next/standalone/server.js",
      cwd: "/home/ubuntu/smart-ship-automation",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      max_memory_restart: "500M",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
