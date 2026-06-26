#!/usr/bin/env node
/**
 * 生产构建编排 —— 对应 docs/zh/desktop.md 第 138-159 行的五步流程。
 *
 * 流程：
 *   1. 构建前端：cd mateclaw-ui && pnpm install && pnpm build
 *      （输出到 mateclaw-server/src/main/resources/static，打进 jar classpath）
 *   2. 构建后端 jar：cd mateclaw-server && mvn clean package -DskipTests
 *   3. 拷贝 jar 到 mateclaw-desktop/resources/app.jar（排除 sources/javadoc）
 *   4. 下载 JRE（若 resources/jre 不存在）
 *   5. electron-builder 按当前平台打包
 *
 * 产物：mateclaw-desktop/release/MateClaw-Setup-x.y.z.exe（或 .dmg / .AppImage）
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..'); // mateclaw 仓库根
const UI_DIR = path.join(ROOT, 'mateclaw-ui');
const SERVER_DIR = path.join(ROOT, 'mateclaw-server');
const DESKTOP_DIR = path.join(__dirname, '..');
const RESOURCES_DIR = path.join(DESKTOP_DIR, 'resources');

function run(cmd, args, opts) {
  const label = `${cmd} ${args.join(' ')}`;
  console.log(`\n> ${label}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (res.status !== 0) {
    console.error(`\n[build-desktop] 命令失败: ${label} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

function step1_buildUi() {
  console.log('\n=== 步骤 1/5: 构建前端 ===');
  const pkgMgr = fs.existsSync(path.join(UI_DIR, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
  run(pkgMgr, ['install'], { cwd: UI_DIR });
  // 用 build:desktop（跳过 check-snowflake-precision.sh —— 该 sh 是开发期 lint，
  // 未纳入 git，Windows/PowerShell 下 bash 找不到会中断构建；类型检查仍保留）
  run(pkgMgr, ['run', 'build:desktop'], { cwd: UI_DIR });
}

function step2_buildJar() {
  console.log('\n=== 步骤 2/5: 构建后端 jar ===');
  // 必须从仓库根目录构建：mateclaw-server 依赖兄弟模块 mateclaw-plugin-api，
  // 单独在 server 目录跑 mvn 会找不到未 install 的 plugin-api（CI 全新环境尤甚）。
  // -pl mateclaw-server 只构建 server；-am (also-make) 自动先构建其依赖的 plugin-api。
  // 不加 -Paliyun-first：那是国内本地网络加速用的 profile，CI（海外 runner）走默认
  // Maven Central 更快更稳。如本地需加速，手动 MAVEN_FLAGS=-Paliyun-first 环境变量传入。
  const mavenFlags = process.env.MAVEN_FLAGS ? [process.env.MAVEN_FLAGS] : [];
  run('mvn', ['-q', 'clean', 'package', '-DskipTests', '-pl', 'mateclaw-server', '-am', ...mavenFlags], { cwd: ROOT });
}

function step3_copyJar() {
  console.log('\n=== 步骤 3/5: 拷贝 jar ===');
  const target = path.join(SERVER_DIR, 'target');
  if (!fs.existsSync(target)) {
    console.error(`[build-desktop] 找不到 target 目录: ${target}`);
    process.exit(1);
  }
  // 排除 sources / javadoc，取 repackage 主产物
  const jars = fs
    .readdirSync(target)
    .filter((f) => /^mateclaw-server-.*\.jar$/.test(f) && !f.includes('sources') && !f.includes('javadoc'));
  if (jars.length === 0) {
    console.error(`[build-desktop] target 下未找到 mateclaw-server-*.jar`);
    process.exit(1);
  }
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  const src = path.join(target, jars[0]);
  const dst = path.join(RESOURCES_DIR, 'app.jar');
  fs.copyFileSync(src, dst);
  const sizeMb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
  console.log(`  ${jars[0]} -> resources/app.jar (${sizeMb} MB)`);
}

function step4_downloadJre() {
  console.log('\n=== 步骤 4/5: 检查 JRE ===');
  const jreDir = path.join(RESOURCES_DIR, 'jre');
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const javaBin = path.join(jreDir, 'bin', exe);
  if (fs.existsSync(javaBin)) {
    console.log(`  JRE 已存在: ${javaBin}`);
    return;
  }
  console.log('  JRE 不存在，调用 download-jre.js ...');
  run('node', ['scripts/download-jre.js'], { cwd: DESKTOP_DIR });
}

function step5_buildInstaller() {
  console.log('\n=== 步骤 5/5: electron-builder 打包 ===');
  // 按当前平台选 target（CI 矩阵会显式传 --win/--mac/--linux）
  const platformFlag = {
    win32: '--win',
    darwin: '--mac',
    linux: '--linux',
  }[process.platform];
  run('npm', ['run', 'build:ts'], { cwd: DESKTOP_DIR });
  // --publish never：CI 环境下 electron-builder 会自动尝试检测仓库做发布，
  // 没 repository 信息会报错 "Cannot detect repository"。这里明确禁用自动发布，
  // 发布由 CI workflow 的 softprops/action-gh-release 步骤单独负责。
  run('npx', ['electron-builder', platformFlag, '--publish', 'never'].filter(Boolean), { cwd: DESKTOP_DIR });
  console.log('\n[build-desktop] 完成。产物位于: mateclaw-desktop/release/');
}

step1_buildUi();
step2_buildJar();
step3_copyJar();
step4_downloadJre();
step5_buildInstaller();
