const path = require("path");

module.exports = {
  apps: [
    {
      name: "smart-ship",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      node_args: "--env-file=.env.local",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1",
        // Next.js standalone 의 process.chdir 이 .next/standalone 로 cwd 를 바꿔서
        // DB 가 두 곳에 생성되는 문제 방지 — 절대경로로 명시 (clone 위치 무관하게 __dirname 기반)
        SMART_SHIP_DB_PATH: path.join(__dirname, "data", "smart-ship.db"),
      },
      max_memory_restart: "500M",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
