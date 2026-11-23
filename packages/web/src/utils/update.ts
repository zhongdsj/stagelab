/**
 * 前端版本更新状态
 *
 * - 任意 API 调用后触发 ensureVersionChecked()；本地 24h 缓存，失败 10min 后重试
 * - 只有 status=update 且未 snooze / 未跳过本版本 / 本会话未关闭时才自动弹层
 * - 弹层只负责展示与升级指引，不提供「一键更新」按钮
 */
import { reactive } from "vue";
import type { ReleaseInfo, VersionInfo } from "../api/system";
import { aboutState } from "./about";
import { copyText } from "./clipboard";
import { message } from "./message";

/** 固定升级命令：复制到剪贴板，用户自行执行 */
export const UPGRADE_COMMAND = "npm i -g stagelab@latest\nstagelab start";

/** 全局更新弹层状态（App.vue 只渲染一次） */
export const updateState = reactive<{
  visible: boolean;
  checking: boolean;
  info: VersionInfo | null;
}>({
  visible: false,
  checking: false,
  info: null
});

const INFO_KEY = "stagelab.update.info.v1";
const PREFS_KEY = "stagelab.update.prefs.v1";
const SESSION_DISMISSED_KEY = "stagelab.update.dismissed.v1";
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface CachedInfo {
  savedAt: number;
  info: VersionInfo;
}

interface UpdatePrefs {
  snoozeUntil?: number;
  skippedVersion?: string;
}

let lastAttemptAt = 0;
let inflight: Promise<void> | null = null;

/** localStorage 可能在隐私模式/配额满时抛错，统一吞掉 */
function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不下也不影响本次弹层
  }
}

function readPrefs(): UpdatePrefs {
  return readJson<UpdatePrefs>(window.localStorage, PREFS_KEY) ?? {};
}

function writePrefs(prefs: UpdatePrefs): void {
  writeJson(window.localStorage, PREFS_KEY, prefs);
}

function sessionDismissedVersion(): string {
  try {
    return window.sessionStorage.getItem(SESSION_DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

function setSessionDismissedVersion(version: string): void {
  try {
    window.sessionStorage.setItem(SESSION_DISMISSED_KEY, version);
  } catch {
    // 忽略
  }
}

function isVersionInfo(value: unknown): value is VersionInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.current === "string" &&
    (info.latest === null || typeof info.latest === "string") &&
    (info.status === "current" ||
      info.status === "update" ||
      info.status === "unknown" ||
      info.status === "disabled") &&
    typeof info.checkedAt === "number"
  );
}

function readCachedInfo(): CachedInfo | null {
  const cached = readJson<CachedInfo>(window.localStorage, INFO_KEY);
  if (!cached || typeof cached.savedAt !== "number" || !isVersionInfo(cached.info)) {
    return null;
  }
  const ttl = cached.info.status === "unknown" ? FAIL_TTL_MS : SUCCESS_TTL_MS;
  return Date.now() - cached.savedAt <= ttl ? cached : null;
}

function persistInfo(info: VersionInfo): void {
  writeJson(window.localStorage, INFO_KEY, { savedAt: Date.now(), info });
}

/** 根据更新内容与本地偏好决定是否弹出 */
function applyInfo(info: VersionInfo): void {
  updateState.info = info;

  // 「关于」弹层打开时不叠加更新提示；关闭后会再触发一次版本判断
  if (aboutState.visible) {
    updateState.visible = false;
    return;
  }

  if (info.status !== "update" || !info.latest) {
    updateState.visible = false;
    return;
  }

  const prefs = readPrefs();
  if (prefs.snoozeUntil && prefs.snoozeUntil > Date.now()) {
    updateState.visible = false;
    return;
  }
  if (prefs.skippedVersion === info.latest) {
    updateState.visible = false;
    return;
  }
  if (sessionDismissedVersion() === info.latest) {
    updateState.visible = false;
    return;
  }
  updateState.visible = true;
}

/** 拉取 GET /api/system/version；错误静默，不打断业务 */
async function fetchVersionInfo(): Promise<VersionInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/system/version", {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!isVersionInfo(data)) throw new Error("版本接口返回格式无效");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 确保版本信息已检查（任意 API 调用后调用，内部去重 + 24h 缓存）。
 * force=true 时绕过前端缓存，但仍受服务端 24h 缓存约束。
 */
export async function ensureVersionChecked(force = false): Promise<void> {
  if (inflight) return inflight;

  if (!force) {
    const cached = readCachedInfo();
    if (cached) {
      applyInfo(cached.info);
      return;
    }
    if (Date.now() - lastAttemptAt < RETRY_MS) return;
  }

  lastAttemptAt = Date.now();
  updateState.checking = true;
  const task = (async () => {
    try {
      const info = await fetchVersionInfo();
      persistInfo(info);
      applyInfo(info);
    } catch {
      // 版本检查失败不影响业务请求；下次 API 调用会按 RETRY_MS 重试
    } finally {
      updateState.checking = false;
    }
  })();
  inflight = task;
  try {
    await task;
  } finally {
    if (inflight === task) inflight = null;
  }
}

/** 关闭本次会话的更新提醒（刷新同标签页仍不再弹，新标签页会重新判断） */
export function closeUpdateModal(): void {
  if (updateState.info?.latest) {
    setSessionDismissedVersion(updateState.info.latest);
  }
  updateState.visible = false;
}

/** 1 / 3 / 7 天内不再提醒 */
export function snoozeUpdate(days: 1 | 3 | 7): void {
  const prefs = readPrefs();
  prefs.snoozeUntil = Date.now() + days * 24 * 60 * 60 * 1000;
  writePrefs(prefs);
  updateState.visible = false;
  message.success(`已设置 ${days} 天内不再提醒`);
}

/** 跳过当前版本；出现更高版本时仍会提醒 */
export function skipUpdateVersion(): void {
  const latest = updateState.info?.latest;
  if (!latest) return;
  const prefs = readPrefs();
  prefs.skippedVersion = latest;
  writePrefs(prefs);
  updateState.visible = false;
  message.info(`已跳过 ${latest}，有更新版本时会再提醒`);
}

/** 复制固定升级命令 */
export async function copyUpgradeCommand(): Promise<void> {
  const ok = await copyText(UPGRADE_COMMAND);
  if (ok) message.success("升级命令已复制");
  else message.error("复制失败，请手动选择命令");
}

/** 更新说明中的 Release 信息（模板便捷访问） */
export type UpdateRelease = ReleaseInfo;
