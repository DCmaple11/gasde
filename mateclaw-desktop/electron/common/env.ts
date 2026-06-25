// 运行环境常量 —— 主进程据此区分 dev / prod 分支。
//
// dev 模式：scripts/dev.js 启动时设置 VITE_DEV_SERVER_URL=http://localhost:5173。
//   BrowserWindow 加载 Vite dev server，前端 HMR；后端由开发者手动 mvn spring-boot:run。
// prod 模式（dev:prod 或打包后）：不设该变量，主进程 spawn jar 并加载后端 serve 的页面。

export const isDev = (): boolean => Boolean(process.env.VITE_DEV_SERVER_URL);

// dev 模式下后端固定跑在 18088（与 mateclaw-ui/vite.config.ts 的 proxy target 一致）。
export const DEV_BACKEND_PORT = 18088;

// 注意：用 127.0.0.1 而非 localhost。
// Windows 上 Vite 默认只监听 IPv6 [::1]，localhost 优先解析 IPv4 时会连不上 → 白屏。
// 统一用 IPv4 127.0.0.1（需 Vite 配 host 监听 IPv4，见 mateclaw-desktop/README）。
export const DEV_FRONTEND_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
