/**
 * 版本信息（单一事实来源）
 *
 * 发布包由 scripts/build-release.mjs 打成 dist/cli.mjs，dist 与根 package.json 同级；
 * 开发态源码位于 packages/server/src，向上也能找到根 package.json。
 * 因此统一从当前模块所在目录向上查找 name === "stagelab" 的 package.json，
 * 避免 MCP/CLI 各自硬编码版本号导致版本不一致。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 根包名 */
const PACKAGE_NAME = "stagelab";

/** 找不到 package.json 时的兜底版本（正常安装/开发不会走到） */
const FALLBACK_VERSION = "0.0.0";

interface RootPackageJson {
  name?: string;
  version?: string;
}

let cachedVersion: string | null = null;

/** 从当前模块向上查找根 package.json */
function findPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    const file = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf-8")) as RootPackageJson;
      if (pkg.name === PACKAGE_NAME) return file;
    } catch {
      // 当前目录没有 package.json 或内容损坏：继续向上
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 当前 stagelab 版本号 */
export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  const file = findPackageJson(path.dirname(fileURLToPath(import.meta.url)));
  if (file) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf-8")) as RootPackageJson;
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        cachedVersion = pkg.version.trim();
        return cachedVersion;
      }
    } catch {
      // 落到兜底版本
    }
  }
  cachedVersion = FALLBACK_VERSION;
  return cachedVersion;
}
