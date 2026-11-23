/**
 * 版本更新检查
 *
 * 数据源：
 * - npm registry 的 latest：唯一判断「有没有新版本」的事实来源
 * - GitHub Release 资产 release.json：补充标题、更新摘要、完整说明、Release 链接
 *
 * 约束：
 * - 24h 文件缓存（检查失败 10min 后重试），避免每次 API 调用都打外网
 * - npm / GitHub 各自 1.5s 超时，失败静默降级为「无法检查」，不影响主流程
 * - STAGELAB_UPDATE_CHECK=0 / NO_UPDATE_NOTIFIER / CI 下跳过
 */
import fs from "node:fs";
import path from "node:path";
import { registryFilePath } from "./storage/registry.js";
import { getPackageVersion } from "./version.js";

/** npm 最新版本 */
const NPM_LATEST_URL = "https://registry.npmjs.org/stagelab/latest";
/** GitHub Release 稳定资产地址（latest 重定向由 fetch 自动跟随） */
const RELEASE_URL =
  "https://github.com/zhongdsj/stagelab/releases/latest/download/release.json";
/** 成功检查缓存时长 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 失败检查缓存时长（网络抖动后尽早重试） */
const FAIL_CACHE_TTL_MS = 10 * 60 * 1000;
/** 单个外部请求超时 */
const FETCH_TIMEOUT_MS = 1500;

/** 更新状态：current=已是最新，update=有新版，unknown=检查失败，disabled=已关闭 */
export type UpdateStatus = "current" | "update" | "unknown" | "disabled";

/** Release 资产中的结构化更新说明 */
export interface ReleaseInfo {
  version: string;
  publishedAt?: string;
  title?: string;
  level?: "patch" | "minor" | "major" | "security";
  highlights?: string[];
  notes?: string;
  url?: string;
}

/** 对外返回的版本信息 */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  status: UpdateStatus;
  checkedAt: number;
  release: ReleaseInfo | null;
  error?: string;
}

interface CacheFile extends UpdateInfo {
  savedAt: number;
}

let memoryCache: { info: UpdateInfo; savedAt: number } | null = null;
let inflight: Promise<UpdateInfo> | null = null;

/** 更新检查是否启用 */
export function isUpdateCheckEnabled(): boolean {
  const flag = (process.env.STAGELAB_UPDATE_CHECK ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  if (process.env.NO_UPDATE_NOTIFIER) return false;
  if (process.env.CI) return false;
  return true;
}

/** 更新缓存文件（与 registry 同目录，尊重 STAGELAB_DATA_DIR） */
function cacheFilePath(): string {
  return path.join(path.dirname(registryFilePath()), "update-check.json");
}

/** 解析 semver（含 prerelease；build metadata 忽略） */
function parseVersion(
  value: string
): { major: number; minor: number; patch: number; pre: string[] } | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value.trim()
    );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : []
  };
}

/** 比较两个 semver：a>b 返回正数，a<b 返回负数，相等/无法解析返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;

  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }

  // 正式版 > 预发布版
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      continue;
    }
    // 数字标识符优先级低于字母标识符
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** latest 是否比 current 新 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** 限制字符串长度，避免外部资产把弹层撑爆 */
function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
}

/** 只接受 http(s) 链接，防止外部资产注入 javascript: */
function safeUrl(value: unknown): string | undefined {
  const text = clampText(value, 500);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : undefined;
  } catch {
    return undefined;
  }
}

/** 校验并裁剪 release.json 内容 */
function normalizeRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const version = clampText(obj.version, 32);
  if (!version || !parseVersion(version)) return null;

  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights
        .map((item) => clampText(item, 300))
        .filter((item): item is string => Boolean(item))
        .slice(0, 8)
    : undefined;

  const level = obj.level;
  return {
    version,
    publishedAt: clampText(obj.publishedAt, 64),
    title: clampText(obj.title, 200),
    level:
      level === "patch" || level === "minor" || level === "major" || level === "security"
        ? level
        : undefined,
    highlights: highlights?.length ? highlights : undefined,
    notes: clampText(obj.notes, 12000),
    url: safeUrl(obj.url)
  };
}

/** 带超时的 JSON 请求 */
async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/json",
        "user-agent": `stagelab/${getPackageVersion()}`
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 错误转短文案 */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "请求超时";
    return error.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

/** 当前版本 + 不可用状态 */
function stateInfo(
  current: string,
  status: UpdateStatus,
  error?: string
): UpdateInfo {
  return {
    current,
    latest: null,
    updateAvailable: false,
    status,
    checkedAt: Date.now(),
    release: null,
    error
  };
}

/** 读取文件缓存（损坏/版本不符/过期均忽略） */
function readCache(current: string): { info: UpdateInfo; savedAt: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFilePath(), "utf-8")) as Partial<CacheFile>;
    if (
      typeof raw.savedAt !== "number" ||
      raw.current !== current ||
      typeof raw.checkedAt !== "number" ||
      (raw.status !== "current" &&
        raw.status !== "update" &&
        raw.status !== "unknown" &&
        raw.status !== "disabled")
    ) {
      return null;
    }
    const ttl = raw.status === "unknown" ? FAIL_CACHE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - raw.savedAt > ttl) return null;
    return {
      savedAt: raw.savedAt,
      info: {
        current,
        latest: typeof raw.latest === "string" ? raw.latest : null,
        updateAvailable: raw.updateAvailable === true,
        status: raw.status,
        checkedAt: raw.checkedAt,
        release: normalizeRelease(raw.release),
        error: typeof raw.error === "string" ? raw.error : undefined
      }
    };
  } catch {
    return null;
  }
}

/** 原子写缓存；失败不影响版本检查结果 */
function writeCache(info: UpdateInfo): void {
  const file = cacheFilePath();
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ ...info, savedAt: Date.now() }, null, 2), "utf-8");
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 忽略清理失败
    }
  }
}

/** 真正执行一次外部检查 */
async function performCheck(current: string): Promise<UpdateInfo> {
  let npmVersion: string | null = null;
  let npmError = "";
  try {
    const data = (await fetchJson(NPM_LATEST_URL)) as { version?: unknown };
    if (typeof data.version === "string" && parseVersion(data.version)) {
      npmVersion = data.version.trim();
    } else {
      npmError = "npm 返回的版本号无效";
    }
  } catch (error) {
    npmError = errorText(error);
  }

  let release: ReleaseInfo | null = null;
  let releaseError = "";
  try {
    release = normalizeRelease(await fetchJson(RELEASE_URL));
    if (!release) releaseError = "release.json 格式无效";
  } catch (error) {
    releaseError = errorText(error);
  }

  // release.json 与 npm latest 必须指向同一版本，避免展示过期说明
  // 用 semver 比较而不是字符串比较，兼容 release.json 写 v0.6.0 的情况
  if (npmVersion && release && compareVersions(release.version, npmVersion) !== 0) {
    release = null;
  }

  const latest = npmVersion ?? release?.version ?? null;
  if (!latest) {
    return stateInfo(
      current,
      "unknown",
      [npmError, releaseError].filter(Boolean).join("；") || "无法获取最新版本"
    );
  }

  const updateAvailable = isNewerVersion(latest, current);

  // 即使当前已是最新，也保留 release：Web 端「关于」弹层需要展示当前版本说明。
  // 更新弹层是否出现只由 status === "update" 决定，不受 release 是否存在影响。
  return {
    current,
    latest,
    updateAvailable,
    status: updateAvailable ? "update" : "current",
    checkedAt: Date.now(),
    release,
    error: npmError && !npmVersion ? npmError : undefined
  };
}

/**
 * 获取版本信息（默认优先内存/文件缓存，force=true 跳过缓存）。
 * 任何网络/解析失败都返回 status="unknown"，不抛异常。
 */
export async function getUpdateInfo(options: { force?: boolean } = {}): Promise<UpdateInfo> {
  const current = getPackageVersion();
  if (!isUpdateCheckEnabled()) {
    return stateInfo(current, "disabled");
  }

  const force = options.force === true;
  if (!force) {
    if (
      memoryCache &&
      memoryCache.info.current === current &&
      Date.now() - memoryCache.savedAt <=
        (memoryCache.info.status === "unknown" ? FAIL_CACHE_TTL_MS : CACHE_TTL_MS)
    ) {
      return memoryCache.info;
    }
    const cached = readCache(current);
    if (cached) {
      memoryCache = cached;
      return cached.info;
    }
  }

  if (inflight) return inflight;
  inflight = (async () => {
    const info = await performCheck(current);
    memoryCache = { info, savedAt: Date.now() };
    writeCache(info);
    return info;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** CLI/MCP 控制台单行状态文案 */
export function formatUpdateStatus(info: UpdateInfo): string {
  if (info.status === "disabled") {
    return `当前版本 ${info.current}（版本检查已关闭）`;
  }
  if (info.status === "unknown") {
    return `当前版本 ${info.current}，检查更新失败${info.error ? `：${info.error}` : ""}`;
  }
  if (info.status === "update" && info.latest) {
    return `当前版本 ${info.current}，发现新版本 ${info.latest}，可执行：npm i -g stagelab@latest`;
  }
  return `当前版本 ${info.current}（已是最新版本）`;
}
