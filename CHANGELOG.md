# 更新日志

本文件记录 `stagelab` 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.6.0] - 2026-11-20

### 新增

- **版本更新检测**：`stagelab start` / `http` 启动后输出当前版本与最新版本判断；`stagelab mcp` 连接后写入 stderr；新增 `GET /api/system/version` 与 `stagelab --version`。
- **Web 更新弹层**：发现新版本时展示更新摘要、完整说明与升级命令，支持 1/3/7 天后再提醒、跳过当前版本、关闭本次会话提示。更新说明来自 GitHub Release 资产 `release.json`。
- **「关于」弹层**：顶栏新增入口，集中展示项目简介、核心能力、当前版本更新摘要与 GitHub / Release / 更新日志链接。
- **图元 MCP 描述层**：节点、连线、分组字段补充语义描述，三类图提供 JSON 示例，减少 AI 按 schema 试错。
- **全项目搜索**：跨文档、图、需求、任务搜索，支持文档分片锚点定位；新增 `GET /api/projects/:id/search`。
- **节点详情弹层**：单击节点查看属性、影响面与源码锚点；新增单节点影响面接口。
- **diagramId 展示**：图库、图页侧栏与工具栏展示并支持复制 diagramId。

### 优化

- 复制反馈统一为顶部居中轻提示，不再把按钮原地改成「已复制」。
- 图页左右两栏等高，左侧图列表独立滚动，长列表不再撑高整页。

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
