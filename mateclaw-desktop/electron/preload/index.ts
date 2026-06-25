// Preload —— 渲染进程与主进程之间的最小 IPC 桥。
//
// P0 仅暴露应用信息（版本/平台）。contextIsolation=true 下，渲染进程只能通过
// window.mateclawDesktop 访问这里显式暴露的能力，无法直接用 Node/Electron API。

import { contextBridge } from 'electron';

// preload 运行在渲染进程沙箱里，不能 import app（仅主进程可用）。
// process.versions 在 preload 上下文里是安全的。
contextBridge.exposeInMainWorld('mateclawDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
  // P4 自动更新、UI OTA 等能力会从这里继续扩展
});
