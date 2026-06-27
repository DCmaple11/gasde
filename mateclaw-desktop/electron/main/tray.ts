// 系统托盘 + 窗口最小化到托盘。
//
// 行为：
//   - 点窗口右上角 X → 拦截 close，隐藏窗口到托盘（后端 jar 继续运行）
//   - 首次最小化时弹气泡提示「OpenClawMax 将在后台运行」
//   - 左键单击/双击托盘图标 → 恢复窗口
//   - 托盘右键菜单：显示 / 退出（只有「退出」才真正杀后端并退出应用）
//
// isQuitting 标志：区分「真退出」和「最小化」—— before-quit 触发时置 true，
// 这样 close 事件不再拦截，窗口能正常关闭走退出流程。

import { app, BrowserWindow, Tray, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { resolveResourcePath } from './paths';

let tray: Tray | null = null;
let isQuitting = false; // 是否正在真正退出（从托盘菜单触发）
let hasShownMinimizeHint = false; // 首次最小化提示只弹一次

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value;
}

// 解析托盘图标路径。
// Windows: tray.ico（托盘对 ico 支持最好）；macOS/Linux: tray.png。
function resolveTrayIcon(): string {
  const file = process.platform === 'win32' ? 'tray.ico' : 'tray.png';
  return resolveResourcePath('tray', file);
}

/**
 * 创建托盘。传入主窗口引用，用于「显示」时恢复。
 */
export function createTray(getMainWindow: () => BrowserWindow | null): Tray {
  const iconPath = resolveTrayIcon();
  // nativeImage 让 macOS 自动适配模板图标（深浅色）；其它平台直接用
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('OpenClawMax');

  const showMainWindow = (): void => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: showMainWindow,
    },
    {
      label: '检查更新',
      click: () => {
        // 懒加载避免与 updater.ts 的循环依赖
        require('./updater').checkForUpdates();
      },
    },
    { type: 'separator' },
    {
      label: '退出 OpenClawMax',
      click: () => {
        setIsQuitting(true);
        app.quit();
      },
    },
  ] as MenuItemConstructorOptions[]);

  // 右键菜单
  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });

  // 左键双击（Windows/Linux）/单击（macOS）恢复窗口
  tray.on('double-click', showMainWindow);
  // macOS 单击即恢复（Windows 双击，单击更符合习惯）
  if (process.platform === 'darwin') {
    tray.on('click', showMainWindow);
  }

  return tray;
}

/**
 * 拦截窗口关闭：默认最小化到托盘，只有真退出时才放行。
 * 在 BrowserWindow 的 'close' 事件里调用，返回 true 表示已拦截（阻止关闭）。
 */
export function handleClose(getMainWindow: () => BrowserWindow | null): boolean {
  if (isQuitting) {
    return false; // 真退出，放行
  }
  const win = getMainWindow();
  if (!win) return false;

  win.hide();

  // 首次最小化提示
  if (!hasShownMinimizeHint && tray) {
    hasShownMinimizeHint = true;
    tray.displayBalloon({
      iconType: 'info',
      title: 'OpenClawMax',
      content: 'OpenClawMax 将在后台继续运行。点击托盘图标可恢复窗口。',
    });
  }
  return true; // 已拦截
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
