// Electron 主进程入口。
//
// 两种运行模式（由 scripts/dev.js 设置的 VITE_DEV_SERVER_URL 决定）：
//   dev      —— 加载 Vite dev server（5173），后端由开发者手动 mvn spring-boot:run（18088）
//   prod     —— 主进程 spawn jar（动态端口），加载后端 serve 的页面
//
// 退出时杀掉后端进程树（backend.killBackend），确保无残留 java 进程。

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { isDev, DEV_FRONTEND_URL, DEV_BACKEND_PORT } from '../common/env';
import { startBackend, killBackend } from './backend';
import { createTray, handleClose, getIsQuitting, setIsQuitting, destroyTray } from './tray';
import { initAutoUpdater } from './updater';
import { resolveResourcePath } from './paths';
import { writeLog } from './logger';

let mainWindow: BrowserWindow | null = null;

// 解决 Windows 上 "Unable to move the cache: 拒绝访问 (0x5)" 权限错误。
// 默认 cache 在系统临时目录可能无写权限，改到 userData 下确保可写。
app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('userData'), 'cache'));

async function bootstrap(): Promise<void> {
  let targetUrl: string;

  if (isDev()) {
    // dev 模式：不启动 jar，加载 Vite dev server；提示开发者后端需手动跑在 18088
    await ensureDevBackendUp();
    targetUrl = DEV_FRONTEND_URL;
    writeLog(`dev mode: load ${targetUrl} (backend expected at :${DEV_BACKEND_PORT})`);
  } else {
    // prod 模式：启动 jar，抓动态端口，加载后端 serve 的页面
    try {
      const { port } = await startBackend();
      targetUrl = `http://127.0.0.1:${port}/`;
      writeLog(`prod mode: backend up on :${port}, load ${targetUrl}`);
    } catch (e) {
      writeLog(`startBackend failed: ${e}`);
      // backend.ts 内部已弹错误框
      app.quit();
      return;
    }
  }

  mainWindow = createWindow();

  // 移除默认应用菜单栏（File/Edit/View/Window/Help）—— 现代桌面应用习惯
  Menu.setApplicationMenu(null);

  // 创建系统托盘（点 X 最小化到托盘，后端继续运行）
  createTray(() => mainWindow);

  // 初始化自动更新（打包产物 + 非 macOS 才启用；启动后延迟 10s 静默检查）
  initAutoUpdater(() => mainWindow);

  // 加载失败不能静默 —— 否则只剩白屏无从排查
  try {
    await mainWindow.loadURL(targetUrl);
    writeLog(`loaded: ${targetUrl}`);
  } catch (e) {
    writeLog(`loadURL failed: ${targetUrl} -> ${e}`);
    dialog.showErrorBox(
      '页面加载失败',
      `无法加载 ${targetUrl}\n\n${e}\n\n` +
        (isDev()
          ? '请确认前端 dev server 已启动（cd mateclaw-ui && pnpm dev）'
          : '后端可能未正常启动，请查看后端日志'),
    );
  }
}

// dev 模式下探测 18088 是否在跑，未开则提示（不强制拉起，避免重复构建）
async function ensureDevBackendUp(): Promise<void> {
  const ok = await probe(`http://127.0.0.1:${DEV_BACKEND_PORT}/actuator/health`);
  if (!ok) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: '后端未运行',
      message:
        `dev 模式需要后端跑在 :${DEV_BACKEND_PORT}。\n\n` +
        '请先执行：\n  cd mateclaw-server && mvn spring-boot:run\n\n' +
        '（前端 Vite dev server 也需运行在 :5173）',
    });
  }
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: '#1a1a1a',
    title: 'OpenClawMax',
    icon: resolveResourcePath('tray', 'icon.png'),  // 窗口左上角 + 任务栏都用这个 logo
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // dev 模式直接显示并打开 DevTools，方便排查白屏
  if (isDev()) {
    win.show();
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.once('ready-to-show', () => win.show());
  }

  // 渲染层错误打到主进程日志，便于定位白屏原因
  win.webContents.on('console-message', (_e, level, message) => {
    writeLog(`[renderer:${level}] ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    writeLog(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    writeLog(`[render-process-gone] ${details.reason}`);
  });

  // 外链在系统浏览器打开，不在应用内导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 拦截关闭：点 X → 最小化到托盘（后端继续运行）；只有真退出（托盘菜单）才放行
  win.on('close', (e) => {
    if (handleClose(() => mainWindow)) {
      e.preventDefault(); // 已拦截为最小化，阻止真正关闭
    }
  });

  return win;
}

// ---- 生命周期绑定 ----

// 单实例锁：托盘应用必须。否则用户二次启动会再 spawn 一个后端（端口冲突 + H2 文件锁）。
// 第二实例直接聚焦已有窗口，不重复启动。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户再次打开 → 恢复并聚焦已有窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(bootstrap);
}

app.on('before-quit', () => {
  // before-quit 触发说明是真退出（托盘菜单调用 app.quit，或系统关机等）
  setIsQuitting(true);
  writeLog('app before-quit: kill backend');
  killBackend();
  destroyTray();
});

app.on('window-all-closed', () => {
  // 有托盘驻留：所有窗口关闭不应退出应用（除非正在真退出）。
  // macOS 原生如此；Windows/Linux 配合托盘也保持后台运行。
  if (getIsQuitting()) {
    app.quit();
  }
});

// 兜底：进程退出时确保后端被杀
process.on('exit', () => killBackend());
process.on('SIGINT', () => {
  killBackend();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killBackend();
  process.exit(0);
});
