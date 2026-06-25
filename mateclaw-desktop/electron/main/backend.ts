// 后端子进程生命周期 —— P0 核心。
//
// 职责：
//   1. spawn java -jar，传入动态端口 + desktop profile + userData
//   2. 从 stdout/stderr 抓取 Tomcat 实际监听端口（--server.port=0 时为随机空闲端口）
//   3. 健康探测 /actuator/health 确认就绪
//   4. 退出时按平台杀掉整个进程树（Windows 必须 taskkill /T /F）
//   5. 非正常退出时有限次重启，超限弹错误框
//
// 设计依据：mateclaw-server/src/main/resources/docs/zh/desktop.md
//   后端在 127.0.0.1 上动态挑空闲端口，主进程抓取后 loadURL。

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { app, dialog } from 'electron';
import { getJarPath, getJavaPath, getUserDataDir } from './paths';
import { ensureLogStream, pipeChunk, readLogTail, writeLog } from './logger';

// Tomcat 启动日志：Tomcat started on port(s): 1234 (http) ...
// 注意只匹配 "started"，不匹配 "initialized"（initialized 时端口可能是 0 占位）。
const PORT_RE = /started on port(?:s)?[^\d]*(\d+)/i;

const PORT_CAPTURE_TIMEOUT = 60_000; // 抓端口最长等 60s
const HEALTH_PROBE_TIMEOUT = 30_000; // 抓到端口后健康探测最长等 30s
const HEALTH_PROBE_INTERVAL = 500;
const MAX_RESTART = 3; // 非正常退出最多重启 3 次

export interface BackendHandle {
  port: number;
  proc: ChildProcess;
}

let currentProc: ChildProcess | null = null;
let intentionalQuit = false; // 是否主动退出（不触发重启）

/**
 * 启动后端，返回监听端口与子进程句柄。
 * 失败（端口抓取超时 / 健康探测失败）会 reject。
 */
export function startBackend(): Promise<BackendHandle> {
  return doStart(0);
}

function doStart(attempt: number): Promise<BackendHandle> {
  const jarPath = getJarPath();
  const javaPath = getJavaPath();
  const dataDir = getUserDataDir();

  // 传入 user.data.dir（desktop profile 引用）+ -Duser.home（让 ${user.home} 占位符也落到 dataDir）
  const args = [
    '-Dfile.encoding=UTF-8',
    '-Xmx2g',
    `-Duser.home=${dataDir}`,
    '-jar',
    jarPath,
    '--server.port=0',
    '--spring.profiles.active=desktop',
    `--user.data.dir=${dataDir}`,
  ];

  writeLog(`[attempt=${attempt}] spawn: ${javaPath} ${args.join(' ')}`);
  const proc = spawn(javaPath, args, {
    cwd: dataDir,
    env: { ...process.env },
    windowsHide: true,
  });
  currentProc = proc;
  intentionalQuit = false;

  // stdout/stderr 同时落盘 + 抓端口
  const stream = ensureLogStream();
  proc.stdout?.on('data', (chunk: Buffer) => {
    stream.write(chunk);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    stream.write(chunk);
  });

  const capture = new Promise<BackendHandle>((resolve, reject) => {
    let resolvedPort: number | null = null;

    const onChunk = (chunk: Buffer): void => {
      if (resolvedPort !== null) return;
      const m = chunk.toString('utf8').match(PORT_RE);
      if (m) {
        const port = parseInt(m[1], 10);
        resolvedPort = port;
        writeLog(`captured backend port: ${port}`);
        waitForHealth(port)
          .then(() => resolve({ port, proc }))
          .catch((e) => reject(e));
      }
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);

    const timer = setTimeout(() => {
      if (resolvedPort === null) {
        reject(new Error(`后端在 ${PORT_CAPTURE_TIMEOUT / 1000}s 内未输出监听端口`));
      }
    }, PORT_CAPTURE_TIMEOUT);

    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (resolvedPort === null && !intentionalQuit) {
        reject(new Error(`后端启动过程中退出（code=${code} signal=${signal}）`));
      }
    });
  });

  // 监听退出 —— 非主动退出则有限次重启
  proc.on('exit', (code, signal) => {
    writeLog(`backend exited: code=${code} signal=${signal} intentional=${intentionalQuit}`);
    currentProc = null;
    if (intentionalQuit) return;
    if (code === 0) return;
    if (attempt >= MAX_RESTART) {
      reportFatal(`后端连续 ${MAX_RESTART} 次启动失败，已放弃。`);
      app.quit();
      return;
    }
    const delay = 2000 * (attempt + 1); // 2s, 4s, 6s
    writeLog(`restart in ${delay}ms (attempt ${attempt + 1}/${MAX_RESTART})`);
    setTimeout(() => {
      doStart(attempt + 1).catch((e) => {
        writeLog(`restart attempt ${attempt + 1} failed: ${e}`);
      });
    }, delay);
  });

  return capture;
}

/**
 * 健康探测：轮询 /actuator/health 直到 status=UP 或超时。
 */
function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + HEALTH_PROBE_TIMEOUT;
  return new Promise((resolve, reject) => {
    const probe = (): void => {
      if (Date.now() > deadline) {
        reject(new Error(`健康探测超时（${HEALTH_PROBE_TIMEOUT / 1000}s）`));
        return;
      }
      const req = http.get(
        `http://127.0.0.1:${port}/actuator/health`,
        { timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (body.includes('"status":"UP"')) {
              resolve();
            } else {
              setTimeout(probe, HEALTH_PROBE_INTERVAL);
            }
          });
        },
      );
      req.on('error', () => setTimeout(probe, HEALTH_PROBE_INTERVAL));
      req.on('timeout', () => {
        req.destroy();
        setTimeout(probe, HEALTH_PROBE_INTERVAL);
      });
    };
    probe();
  });
}

/**
 * 退出清理 —— 杀掉后端整个进程树。
 *
 * Windows：必须 taskkill /PID /T /F。原因：
 *   - proc.kill() / SIGTERM 在 Windows 是 TerminateProcess，不跑 JVM shutdown hook
 *   - taskkill /T 才能杀掉 JVM fork 的孙进程（H2、playwright）
 *
 * 其他平台：SIGTERM（跑 shutdown hook）+ 10s 后 SIGKILL 兜底。
 */
export function killBackend(): void {
  intentionalQuit = true;
  const proc = currentProc;
  if (!proc || proc.exitCode !== null) return;
  const pid = proc.pid;
  writeLog(`kill backend: pid=${pid} platform=${process.platform}`);
  try {
    if (process.platform === 'win32') {
      // /F 强制 /T 整树
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 10_000);
    }
  } catch (e) {
    writeLog(`kill backend failed: ${e}`);
  } finally {
    currentProc = null;
  }
}

function reportFatal(message: string): void {
  const detail = `${message}\n\n===== 后端日志尾部 =====\n${readLogTail(2048)}`;
  writeLog(`FATAL: ${message}`);
  try {
    dialog.showErrorBox('MateClaw 后端启动失败', detail);
  } catch {
    // 非 GUI 上下文（如打包前的单元测试）忽略
  }
}
