#!/usr/bin/env node
/**
 * 下载内置 JRE —— Adoptium Temurin JRE 21（LTS，免费可商用）。
 *
 * 按当前构建平台下载对应 JRE，解压扁平化到 resources/jre/，使主进程能稳定找到
 * resources/jre/bin/java（或 java.exe）。
 *
 *   Windows: resources/jre/bin/java.exe
 *   macOS:   resources/jre/bin/java         （从 JDK bundle 的 Contents/Home 提取）
 *   Linux:   resources/jre/bin/java
 *
 * 注意：CI 三平台矩阵中每个 runner 只下载自己平台的 JRE。
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const JRE_VERSION = 21;
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const JRE_DIR = path.join(RESOURCES_DIR, 'jre');

// 清华镜像固定版本号（国内首选，速度快；不走 API latest，用确定版本）
const TUNA_JRE_BUILD = '21.0.11_10'; // OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10

// 把 platform/arch 映射到 Adoptium 的 os/arch 标识。
// 注意：Adoptium API 用 aarch64（不是 arm64），process.arch 返回的是 arm64，需转换。
// 文件名里 Windows 用 x64，mac/linux 用 aarch64 / x64。
function mapPlatform() {
  const rawArch = process.arch; // arm64 | x64
  const arch = rawArch === 'arm64' ? 'aarch64' : rawArch; // Adoptium 命名规范
  const platformMap = {
    win32: { os: 'windows', arch, ext: '.zip' },
    darwin: { os: 'mac', arch, ext: '.tar.gz' },
    linux: { os: 'linux', arch, ext: '.tar.gz' },
  };
  const m = platformMap[process.platform];
  if (!m) {
    console.error(`[download-jre] 不支持的平台: ${process.platform}/${rawArch}`);
    process.exit(1);
  }
  return m;
}

// 清华镜像 URL（国内首选）。文件名格式：OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip
function buildTunaUrl(m) {
  const build = TUNA_JRE_BUILD.replace('_', '_'); // 21.0.11_10
  return `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${JRE_VERSION}/jre/${m.arch}/${m.os}/OpenJDK${JRE_VERSION}U-jre_${m.arch}_${m.os}_hotspot_${build}${m.ext}`;
}

// Adoptium 官方 API（兜底）。注意参数顺序是 /{os}/{arch}（不是 arch/os），顺序错会 404
function buildAdoptiumUrl(m) {
  return `https://api.adoptium.net/v3/binary/latest/${JRE_VERSION}/ga/${m.os}/${m.arch}/jre/hotspot/normal/eclipse`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  下载: ${url}`);
    const follow = (u, depth = 0) => {
      if (depth > 5) {
        reject(new Error('重定向次数过多'));
        return;
      }
      const req = https.get(u, {
        timeout: 30_000,
        headers: {
          // 清华等镜像有防盗链，缺 UA 会 403。模拟正常浏览器/客户端
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 mateclaw-desktop/1.6.0',
          Accept: '*/*',
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, depth + 1); // CDN 重定向
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
        file.on('error', reject);
      });
      req.on('error', reject);
      // 30s 无数据则判定连接僵死（Adoptium 官方源国内常卡死）
      req.on('timeout', () => {
        req.destroy(new Error('下载超时（30s 无数据）'));
      });
    };
    follow(url);
  });
}

function extractZip(file, dest) {
  // 优先用系统 unzip / powershell，避免依赖第三方 npm 包
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -Path "${file}" -DestinationPath "${dest}" -Force`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('PowerShell Expand-Archive 失败');
  } else {
    const r = spawnSync('unzip', ['-q', '-o', file, '-d', dest], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('unzip 失败');
  }
}

function extractTarGz(file, dest) {
  // macOS / Linux 自带 tar；CI 上也保证有
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('tar', ['-xzf', file, '-C', dest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar 解压失败（macOS/Linux 应自带 tar；CI 需确保安装）');
}

// 找到解压后的 JDK/JRE 根目录（含 bin/）。
// 三种实际结构：
//   1. Windows/Linux: 解压出单一目录 <name>/bin/         （bin 直接在顶层目录下）
//   2. macOS 旧包:    <name>.jdk/Contents/Home/bin/      （bundle 带 .jdk 后缀）
//   3. macOS 新包:    <name>-jre/Contents/Home/bin/      （Temurin，目录名无 .jdk 后缀！）
function findHome(extractRoot) {
  const entries = fs.readdirSync(extractRoot).filter((e) => !e.startsWith('.'));

  // 情况 2/3：macOS bundle —— 任何顶层子目录下有 Contents/Home/bin 都算
  for (const e of entries) {
    const macHome = path.join(extractRoot, e, 'Contents', 'Home');
    if (fs.existsSync(path.join(macHome, 'bin'))) return macHome;
  }
  // 情况 1：顶层子目录直接含 bin
  for (const e of entries) {
    if (fs.existsSync(path.join(extractRoot, e, 'bin'))) {
      return path.join(extractRoot, e);
    }
  }
  // 兜底：extractRoot 本身就是 home
  if (fs.existsSync(path.join(extractRoot, 'bin'))) return extractRoot;
  throw new Error('解压后未找到 JRE 根（含 bin）');
}

async function main() {
  const m = mapPlatform();
  const archiveName = `jre-${m.os}-${m.arch}${m.ext}`;
  const archivePath = path.join(RESOURCES_DIR, archiveName);
  const extractRoot = path.join(RESOURCES_DIR, '_jre-extract');

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // 已存在则跳过
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (fs.existsSync(path.join(JRE_DIR, 'bin', exe))) {
    console.log(`[download-jre] 已存在: ${path.join(JRE_DIR, 'bin', exe)}，跳过。`);
    return;
  }

  // 清理上次失败残留的半截文件
  fs.rmSync(archivePath, { force: true });

  // 下载源优先级：
  //   默认 Adoptium 官方 API 优先 —— latest 永不过期，CI（海外 runner）访问快。
  //   本地国内网络慢时，设环境变量 JRE_SOURCE=tuna 强制走清华镜像（速度快但版本号固定）。
  //   两个源都尝试，任一成功即可。
  const preferTuna = process.env.JRE_SOURCE === 'tuna';
  const sources = preferTuna
    ? [buildTunaUrl(m), buildAdoptiumUrl(m)]
    : [buildAdoptiumUrl(m), buildTunaUrl(m)];
  let downloaded = false;
  for (let i = 0; i < sources.length; i++) {
    try {
      console.log(`[download-jre] 尝试源 ${i + 1}/${sources.length}`);
      await download(sources[i], archivePath);
      downloaded = true;
      break;
    } catch (e) {
      console.error(`  源 ${i + 1} 失败: ${e.message}`);
      fs.rmSync(archivePath, { force: true });
    }
  }
  if (!downloaded) {
    throw new Error('所有下载源均失败');
  }
  console.log('  下载完成，解压中...');

  // 清理旧产物
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.rmSync(JRE_DIR, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });

  if (m.ext === '.zip') {
    extractZip(archivePath, extractRoot);
  } else {
    extractTarGz(archivePath, extractRoot);
  }

  const home = findHome(extractRoot);
  // 扁平化：把 home 目录整体重命名为 jre
  fs.renameSync(home, JRE_DIR);
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });

  const javaBin = path.join(JRE_DIR, 'bin', exe);
  if (!fs.existsSync(javaBin)) {
    throw new Error(`扁平化后未找到 ${javaBin}`);
  }
  console.log(`[download-jre] 完成: ${javaBin}`);
}

main().catch((e) => {
  console.error(`\n[download-jre] 失败: ${e.message}`);
  console.error('可手动下载 Temurin JRE 21 并解压到 mateclaw-desktop/resources/jre/');
  process.exit(1);
});
