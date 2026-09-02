/**
 * 单包发布构建：将 monorepo 打包为单一 npm CLI 包 stagelab。
 *
 * 产物布局（发布包 files 只含 dist）：
 * - dist/cli.js   server + shared 业务代码经 esbuild bundle（运行时第三方依赖外部化）
 * - dist/web/     web 生产构建产物（由 stagelab start 静态托管）
 *
 * 运行时依赖声明在根 package.json dependencies 中，安装 stagelab 时由 npm 解析。
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // scripts/../ = 仓库根

function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root });
}

console.log("[build:release] 构建 shared ...");
run("npm run build -w @stagelab/shared");

console.log("[build:release] 构建 web ...");
run("npm run build -w @stagelab/web");

console.log("[build:release] bundle server+shared -> dist/cli.mjs ...");
await build({
  entryPoints: [path.join(root, "packages/server/src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // 第三方运行时依赖外部化，由根 package.json dependencies 安装；@stagelab/shared 被 bundle 进业务代码
  external: ["fastify", "@fastify/static", "@modelcontextprotocol/sdk", "elkjs", "zod"],
  outfile: path.join(root, "dist/cli.mjs"),
  // 入口 cli.ts 首行 shebang 由 esbuild 自动保留到 bundle 顶部，无需 banner
  logLevel: "info"
});

// 布局 Worker 独立产物：worker.ts 被 cli.mjs 内联后，运行时按相对路径 new Worker
// 加载独立脚本（esbuild 单文件 bundle 不会产出分文件），故单独打包出 dist/worker.mjs。
// cli.mjs 内通过 import.meta.url 后缀(.mjs) 定位到同目录的 worker.mjs。
console.log("[build:release] bundle layout worker -> dist/worker.mjs ...");
await build({
  entryPoints: [path.join(root, "packages/server/src/layout/worker.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // elkjs 外部化，由根 package.json dependencies 提供（Worker 内运行时解析 node_modules）
  external: ["elkjs"],
  outfile: path.join(root, "dist/worker.mjs"),
  logLevel: "info"
});

console.log("[build:release] 拷贝 web 产物 -> dist/web ...");
const webTarget = path.join(root, "dist/web");
mkdirSync(webTarget, { recursive: true });
cpSync(path.join(root, "packages/web/dist"), webTarget, { recursive: true });

console.log("[build:release] 完成");