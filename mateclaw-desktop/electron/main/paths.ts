// 路径解析 —— 区分 dev（源码目录）与 prod（打包后 process.resourcesPath）。
//
// 打包后目录结构（electron-builder extraResources 配置）：
//   <安装目录>/resources/
//     ├── app/app.jar            ← 后端可执行 jar
//     └── jre/                   ← 内置 JRE（bin/java 或 bin/java.exe）
//
// dev:prod 模式下（未打包但跑 jar），使用源码 resources/ 下的 jar + 系统 Java。

import path from 'node:path';
import { app } from 'electron';

const isPackaged = (): boolean =>
  // app.isPackaged 在 electron-builder 打包产物中为 true
  app.isPackaged || !!process.resourcesPath;

// userData —— 系统标准数据目录，作为 H2/skill/workspace 的根。
// 目录名由 electron-builder.json 的 productName 决定（OpenClawMax）。
//   Windows: %APPDATA%/OpenClawMax
//   macOS:   ~/Library/Application Support/OpenClawMax
//   Linux:   ~/.config/OpenClawMax
export const getUserDataDir = (): string => app.getPath('userData');

// 后端日志目录（userData/logs）
export const getLogDir = (): string => path.join(getUserDataDir(), 'logs');
export const getBackendLogPath = (): string =>
  path.join(getLogDir(), 'mateclaw-backend.log');

// 后端 jar 路径
export function getJarPath(): string {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'app', 'app.jar');
  }
  // dev:prod —— 源码 resources/app.jar（由 scripts/build-desktop.js 拷入）
  return path.join(__dirname, '..', '..', 'resources', 'app.jar');
}

// JRE 中 java 可执行文件路径
export function getJavaPath(): string {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'jre', 'bin', exe);
  }
  // dev:prod —— 优先 JAVA_HOME，回退 PATH 上的 java（由 spawn 自行解析）
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    return path.join(javaHome, 'bin', exe);
  }
  return 'java';
}

export const isProdPackaged = isPackaged;

/**
 * 解析 extraResources 里的资源路径（图标等）。
 * extraResources 配置把 build/ 下的图标打到 resources/<subdir>/<file>。
 * 打包后从 process.resourcesPath 读；开发态从 build/ 读。
 *
 * @param subdir extraResources 里的目标子目录（如 'tray'）
 * @param file   文件名（如 'tray.ico'、'icon.png'）
 */
export function resolveResourcePath(subdir: string, file: string): string {
  if (isPackaged()) {
    return path.join(process.resourcesPath, subdir, file);
  }
  return path.join(__dirname, '..', '..', 'build', file);
}
