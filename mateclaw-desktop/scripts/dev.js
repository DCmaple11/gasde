#!/usr/bin/env node
/**
 * dev 启动器 —— 二开开发循环入口。
 *
 * 用法：
 *   pnpm dev          —— dev 模式：加载 Vite dev server(5173)，后端需手动 mvn spring-boot:run(18088)
 *   pnpm dev:prod     —— prod 模式：主进程 spawn jar(动态端口)，加载后端 serve 的页面
 *
 * dev 模式工作流（三条终端）：
 *   1. cd mateclaw-ui && pnpm dev               （Vite HMR，5173）
 *   2. cd mateclaw-server && mvn spring-boot:run（后端，18088，改后端手动重启）
 *   3. cd mateclaw-desktop && pnpm dev          （本脚本，Electron 加载 5173）
 *
 * 首次运行前需先 npm run build:ts 编译主进程 TS。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const prodMode = process.argv.includes('--prod');

// 清理旧环境变量，确保 --prod 走 prod 分支
delete process.env.VITE_DEV_SERVER_URL;

if (!prodMode) {
  process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
}

// 确保主进程 TS 已编译
// 注意：tsc 以 rootDir="." 编译，产出保留 electron/ 层级 → dist-electron/electron/main/index.js
const fs = require('node:fs');
const entryJs = path.join(__dirname, '..', 'dist-electron', 'electron', 'main', 'index.js');
if (!fs.existsSync(entryJs)) {
  console.error('\n[dev] 主进程尚未编译，请先执行: npm run build:ts\n');
  process.exit(1);
}

// 直接用 electron 包的 cli.js + node 执行，避开 Windows 上 spawn .cmd 触发 EINVAL、
// 以及带空格路径 + shell 的各种坑。cli.js 内部会用 spawn 自己拉起 electron 二进制。
const electronCli = path.join(__dirname, '..', 'node_modules', 'electron', 'cli.js');

const child = spawn(process.execPath, [electronCli, '.'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => process.exit(code ?? 0));
