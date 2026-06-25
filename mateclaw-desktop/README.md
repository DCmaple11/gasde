# MateClaw Desktop

自建的 Electron 桌面端壳，把 MateClaw 后端 jar 封装成桌面应用，内置 JRE 21，用户免装 Java。

> 设计依据：`mateclaw-server/src/main/resources/docs/zh/desktop.md`（官方闭源桌面端的目标架构）。
> 本模块为二开自建，独立于 Maven reactor（不加入根 `pom.xml` 的 `<modules>`）。

---

## 目录结构

```
mateclaw-desktop/
├── electron/
│   ├── main/          # 主进程：backend(后端生命周期) / index(入口) / paths / logger
│   ├── preload/       # 渲染进程 IPC 桥
│   └── common/        # dev/prod 环境常量
├── scripts/
│   ├── dev.js             # 二开启动器（dev / dev:prod 双模式）
│   ├── build-desktop.js   # 生产构建编排（ui + jar + jre + electron-builder）
│   └── download-jre.js    # Adoptium Temurin JRE 21 下载
├── resources/         # 构建产物（gitignore）：app.jar + jre/
├── build/             # 图标 + macOS entitlements
└── electron-builder.json
```

---

## 二开开发循环（日常）

三条终端：

```bash
# 终端 1：前端（Vite HMR，改前端秒级生效）
cd mateclaw-ui && pnpm dev                # http://localhost:5173

# 终端 2：后端（改后端手动重启）
cd mateclaw-server && mvn spring-boot:run # http://localhost:18088

# 终端 3：Electron（加载 5173，改主进程需重启）
cd mateclaw-desktop
npm install
npm run build:ts        # 首次：编译主进程 TS
npm run dev             # Electron 窗口加载 5173
```

- 改前端 → Vite 自动 HMR
- 改后端 → 重启终端 2
- 改 Electron 主进程 → 重启终端 3

---

## 生产构建（打出可分发安装包）

一键编排（前端 + 后端 jar + JRE + 打包）：

```bash
cd mateclaw-desktop
npm run build:desktop     # 自动跑完五步，产物在 release/
```

分步调试：

```bash
# 只验证 spawn jar + 动态端口（不打包）
cd mateclaw-server && mvn clean package -DskipTests
cp target/mateclaw-server-*.jar ../mateclaw-desktop/resources/app.jar  # 排除 sources
cd ../mateclaw-desktop
npm run build:ts && npm run dev:prod

# 单独下载 JRE
npm run download:jre

# 按平台打包
npm run build:win        # Windows nsis
npm run build:mac        # macOS dmg+zip
npm run build:linux      # Linux AppImage
```

---

## 关键设计

| 点 | 说明 |
|---|---|
| 动态端口 | 后端 `--server.port=0`，主进程从日志正则 `started on port` 抓实际端口，再 `/actuator/health` 探测就绪 |
| 数据目录 | H2 / skill / workspace 全部落 `%APPDATA%/MateClaw`（macOS/Linux 各自标准路径），通过 `application-desktop.yml` 的 `${user.data.dir}` 占位符 |
| 进程清理 | Windows 用 `taskkill /PID /T /F` 杀整树（JVM 孙进程 H2/playwright）；其他平台 SIGTERM + 10s SIGKILL |
| JRE | extraResources（不走 asar），避免 native 库 dlopen 失败；CI 三平台各下自己的 JRE |
| 前端加载 | prod 加载后端 serve 的页面（jar classpath:/static）；dev 加载 Vite dev server |

---

## 图标

`build/icon.ico`（Windows）/ `icon.png`（Linux）当前为占位，从 `mateclaw-ui/public/logo` 复制。
**正式发布前**请替换为多尺寸应用图标：
- Windows：`icon.ico`（建议含 256/128/64/48/32/16 多尺寸）
- macOS：`icon.icns`（本仓库暂未生成，需用 `iconutil` 从 iconset 转换）
- Linux：`icon.png`（512×512）

---

## 后续阶段（未实现）

- **P3** GitHub Actions 三 runner 矩阵构建 + 签名/公证
- **P4** 自动更新：electron-updater 整包 + UI OTA（见 `docs/zh/desktop-ui-hot-update.md`）
- **P5** 系统托盘、`setWindowOpenHandler`、深链、灰度发布
