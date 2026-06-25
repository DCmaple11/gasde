// 主进程日志 —— 后端 stdout/stderr 落盘到 userData/logs/mateclaw-backend.log。
//
// 用途：后端启动失败时，弹错误框会附带日志尾部，便于排查；
//       用户报障时可让用户提交该文件。

import fs from 'node:fs';
import path from 'node:path';
import { getLogDir, getBackendLogPath } from './paths';

let logStream: fs.WriteStream | null = null;

export function ensureLogStream(): fs.WriteStream {
  if (logStream) return logStream;
  fs.mkdirSync(getLogDir(), { recursive: true });
  logStream = fs.createWriteStream(getBackendLogPath(), { flags: 'a' });
  return logStream;
}

// 读取日志尾部 N 字符，用于错误对话框
export function readLogTail(bytes = 2048): string {
  const file = getBackendLogPath();
  try {
    if (!fs.existsSync(file)) return '(无日志)';
    const stat = fs.statSync(file);
    const size = stat.size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return `(读取日志失败: ${e})`;
  }
}

export function writeLog(line: string): void {
  try {
    const stream = ensureLogStream();
    stream.write(`[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // 日志失败不影响主流程
  }
}

// 把 child_process 的 chunk 写入日志流
export function pipeChunk(chunk: Buffer): void {
  try {
    const stream = ensureLogStream();
    stream.write(chunk);
  } catch {
    // ignore
  }
}
