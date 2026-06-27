// Preload —— 渲染进程与主进程之间的 IPC 桥。
//
// contextIsolation=true 下，渲染进程只能通过 window.mateclawDesktop 访问这里
// 显式暴露的能力，无法直接用 Node/Electron API。

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mateclawDesktop', {
  platform: process.platform,
  electron: process.versions.electron,

  // P4 自动更新：前端可主动检查更新、触发下载、监听下载进度
  updater: {
    check: (): Promise<{ supported: boolean; available?: boolean; version?: string; reason?: string; error?: string }> =>
      ipcRenderer.invoke('updater:check'),
    download: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('updater:download'),
    onDownloadProgress: (callback: (percent: number) => void): void => {
      ipcRenderer.on('update-download-progress', (_e, percent) => callback(percent));
    },
  },
});
