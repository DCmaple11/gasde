// 整包自动更新（electron-updater）。
//
// 行为：自动检查 + 手动确认。
//   1. 应用启动后（延迟 10s）静默检查更新
//   2. 有新版 → 弹窗显示版本号 + 更新日志，用户选「立即下载」或「稍后」
//   3. 用户确认 → 后台下载，托盘/窗口显示进度
//   4. 下载完成 → 弹窗提示「立即重启 / 下次启动」
//   5. 选重启 → quitAndInstall（杀后端 → 替换安装包 → 重启）
//
// 更新源（可配置）：
//   默认 GitHub Release（electron-updater 原生支持 provider:github）。
//   国内用户慢时，设环境变量 OPENCLAWMAX_UPDATE_URL 指向自有镜像/对象存储
//   （放 latest.yml + 安装包的 https 目录，如 https://cdn.example.com/openclawmax/）。
//
// ⚠️ macOS 无签名跳过更新：electron-updater 的 mac 更新要求代码签名，
//    未签名的 mac 包检查/下载会失败。mac 直接 return，不报错。
//
// 注：dev 模式（isDev）下 electron-updater 无法工作（需要打包后的 app），
//     dev 模式跳过，只在打包产物里启用。

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { isDev } from '../common/env';
import { getIsQuitting, setIsQuitting } from './tray';
import { writeLog } from './logger';

let mainWindow: BrowserWindow | null = null;

// 更新源配置：
//   默认读 electron-builder.json publish 生成的 app-update.yml（打包时写入，
//   当前指向 OSS https://oss.aipowerway.cn/version/latest/）。
//   如需临时切换（测试/换源），设环境变量 OPENCLAWMAX_UPDATE_URL 覆盖。
function getUpdateProviderConfig() {
  const overrideUrl = process.env.OPENCLAWMAX_UPDATE_URL;
  if (overrideUrl) {
    return { provider: 'generic' as const, url: overrideUrl };
  }
  // 不 setFeedURL —— electron-updater 会自动读打包时生成的 app-update.yml
  return undefined;
}

export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  mainWindow = getMainWindow();

  // dev 模式 / macOS 无签名 —— 跳过
  if (isDev()) {
    writeLog('[updater] dev 模式，跳过自动更新');
    return;
  }
  if (process.platform === 'darwin') {
    writeLog('[updater] macOS 无签名，跳过自动更新（需签名+公证后启用）');
    return;
  }

  // 配置更新源
  const providerConfig = getUpdateProviderConfig();
  if (providerConfig) {
    autoUpdater.setFeedURL(providerConfig);
    writeLog(`[updater] 更新源: ${providerConfig.url}`);
  } else {
    writeLog('[updater] 更新源: GitHub Release');
  }

  // 不自动下载（手动确认），不自动安装
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // 用户退出时若已下载，下次启动安装

  bindEvents();
  bindIpc();

  // 启动后延迟 10s 检查（避免和后端启动抢资源）
  setTimeout(() => {
    checkForUpdates().catch((e) => writeLog(`[updater] 启动检查失败: ${e}`));
  }, 10_000);
}

function bindEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    writeLog('[updater] 正在检查更新...');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    writeLog(`[updater] 发现新版本: ${info.version}`);
    promptUserToDownload(info);
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    writeLog(`[updater] 已是最新版本: ${info.version}`);
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    // 用窗口标题显示进度（简单方案，不做独立 UI）
    if (mainWindow) {
      mainWindow.setTitle(`OpenClawMax — 下载更新 ${pct}%`);
    }
    // 推给前端（如果前端注册了监听）
    mainWindow?.webContents.send('update-download-progress', pct);
  });

  autoUpdater.on('update-downloaded', (info) => {
    writeLog(`[updater] 更新已下载: ${info.version}`);
    if (mainWindow) {
      mainWindow.setTitle('OpenClawMax');
    }
    promptUserToInstall(info);
  });

  autoUpdater.on('error', (err) => {
    writeLog(`[updater] 错误: ${err?.message ?? err}`);
  });
}

// IPC：前端可主动触发检查更新
function bindIpc(): void {
  ipcMain.handle('updater:check', async () => {
    if (isDev() || process.platform === 'darwin') {
      return { supported: false, reason: isDev() ? 'dev 模式' : 'macOS 无签名' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      const available = !!result?.updateInfo;
      return { supported: true, available, version: result?.updateInfo?.version };
    } catch (e) {
      return { supported: true, error: String(e) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (isDev() || process.platform === 'darwin') return { ok: false };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}

// 发现新版本：弹窗询问是否下载
function promptUserToDownload(info: UpdateInfo): void {
  const result = dialog.showMessageBoxSync(mainWindow ?? new BrowserWindow({ show: false }), {
    type: 'info',
    title: '发现新版本',
    message: `OpenClawMax ${info.version} 已发布`,
    detail: `当前版本 ${app.getVersion()}\n\n是否立即下载更新？\n（下载完成后会提示您重启安装）`,
    buttons: ['立即下载', '稍后'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result === 0) {
    autoUpdater.downloadUpdate().catch((e) => {
      writeLog(`[updater] 下载失败: ${e}`);
      dialog.showErrorBox('更新下载失败', String(e));
    });
  }
}

// 下载完成：弹窗询问是否立即重启安装
function promptUserToInstall(info: UpdateInfo): void {
  const result = dialog.showMessageBoxSync(mainWindow ?? new BrowserWindow({ show: false }), {
    type: 'info',
    title: '更新已就绪',
    message: `OpenClawMax ${info.version} 已下载完成`,
    detail: '是否立即重启以安装更新？\n（未保存的工作请先保存）',
    buttons: ['立即重启安装', '下次启动时安装'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result === 0) {
    // 标记真退出（绕过托盘最小化拦截），让 quitAndInstall 能正常杀后端并重启
    setIsQuitting(true);
    autoUpdater.quitAndInstall(false, true);
  }
}

// 供托盘菜单 / 前端调用的手动检查
export async function checkForUpdates(): Promise<void> {
  if (isDev() || process.platform === 'darwin') return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    writeLog(`[updater] 检查失败: ${e}`);
  }
}
