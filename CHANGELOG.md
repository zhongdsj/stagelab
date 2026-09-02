# 更新日志

本文件记录 `stagelab` 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.3.1] - 2026-09-02

### 修复

- **npm 发布版打开图报错（布局 Worker 缺失）**
  - 现象：通过 npm 全局安装 `stagelab` 后，新建项目（或任何尚无坐标的图）打开时报 `500 Cannot find module '.../stagelab/dist/worker.js'`，而已有坐标的旧图不受影响。
  - 原因：发布构建（`build-release.mjs`）用 esbuild 将服务端与共享代码打进单文件 `dist/cli.mjs`，其中 `worker.ts` 被内联，但运行时按相对路径 `new Worker(new URL('./worker.js', import.meta.url))` 加载的独立 `worker.js` 从未随包产出，导致布局 Worker 无法启动。旧图因已固化坐标、前端跳过 `/layout` 而幸免。
  - 修复：
    - `build-release.mjs` 新增第二个 esbuild 入口，将 `packages/server/src/layout/worker.ts` 独立打包为 `dist/worker.mjs` 随发布包一起提供。
    - `packages/server/src/layout/worker.ts` 按运行形态选择 Worker 脚本名：dev(tsx) 用 `worker.ts`、esbuild 发布包用 `worker.mjs`、tsc 编译产物用 `worker.js`。

## [0.3.0]

- 四阶段 MCP 项目管理工具首个发布版本（继承此前开发迭代全部功能）。
