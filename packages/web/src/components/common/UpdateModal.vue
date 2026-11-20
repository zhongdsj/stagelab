<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  closeUpdateModal,
  copyUpgradeCommand,
  skipUpdateVersion,
  snoozeUpdate,
  updateState
} from "../../utils/update";

const boxRef = ref<HTMLElement | null>(null);

const info = computed(() => updateState.info);
const release = computed(() => info.value?.release ?? null);
const currentText = computed(() => info.value?.current ?? "");
const latestText = computed(() => info.value?.latest ?? "");
const highlights = computed(() => release.value?.highlights ?? []);
const notes = computed(() => release.value?.notes ?? "");
const releaseUrl = computed(() => release.value?.url ?? "");
const tagline = computed(() => release.value?.title ?? "");

/** 发布日期只显示到天；无效日期不显示 */
const publishedText = computed(() => {
  const raw = release.value?.publishedAt;
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
});

/** Esc 关闭；Tab 在弹层内循环，避免焦点跑到被遮罩的页面 */
function onKeydown(event: KeyboardEvent): void {
  if (!updateState.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeUpdateModal();
    return;
  }
  if (event.key !== "Tab" || !boxRef.value) return;

  const focusables = Array.from(
    boxRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => updateState.visible,
  async (visible) => {
    if (!visible) return;
    await nextTick();
    boxRef.value?.focus();
  }
);

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="um">
      <div v-if="updateState.visible && info" class="um-mask" @click.self="closeUpdateModal">
        <div
          ref="boxRef"
          class="um-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="um-title"
          tabindex="-1"
        >
          <header class="um-head">
            <div class="um-icon" aria-hidden="true">↑</div>
            <div class="um-head-main">
              <h2 id="um-title" class="um-title">
                发现新版本 <span class="um-version">{{ latestText }}</span>
              </h2>
              <p class="um-sub">
                <span>当前 {{ currentText }}</span>
                <span class="um-arrow" aria-hidden="true">→</span>
                <span>最新 {{ latestText }}</span>
                <template v-if="publishedText">
                  <span class="um-dot" aria-hidden="true">·</span>
                  <span>{{ publishedText }}</span>
                </template>
              </p>
              <p v-if="tagline" class="um-tagline">{{ tagline }}</p>
            </div>
            <button class="um-close" type="button" title="关闭" aria-label="关闭更新提示" @click="closeUpdateModal">
              ×
            </button>
          </header>

          <div class="um-body">
            <section v-if="highlights.length" class="um-section">
              <h3 class="um-section-title">本次更新</h3>
              <ul class="um-list">
                <li v-for="(item, index) in highlights" :key="index">{{ item }}</li>
              </ul>
            </section>

            <details v-if="notes" class="um-details" :open="!highlights.length">
              <summary>{{ highlights.length ? "查看完整更新说明" : "更新说明" }}</summary>
              <pre class="um-notes">{{ notes }}</pre>
            </details>

            <p v-if="!highlights.length && !notes" class="um-muted">
              暂未获取到本次更新详情，可直接按下方命令升级。
            </p>

            <section class="um-upgrade">
              <div class="um-upgrade-head">
                <h3 class="um-section-title">升级方式</h3>
                <span class="um-upgrade-tip">更新后需重启服务</span>
              </div>
              <div class="um-command">
                <code><span>npm i -g stagelab@latest</span><span>stagelab start</span></code>
                <button class="um-copy" type="button" @click="copyUpgradeCommand">复制命令</button>
              </div>
              <p class="um-hint">复制后在终端执行；已在运行的服务需重启后生效。</p>
            </section>

            <a
              v-if="releaseUrl"
              class="um-link"
              :href="releaseUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看 GitHub Release 完整说明 →
            </a>
          </div>

          <footer class="um-foot">
            <div class="um-snooze">
              <span class="um-snooze-label">稍后提醒</span>
              <button class="um-btn um-btn-quiet" type="button" @click="snoozeUpdate(1)">1 天</button>
              <button class="um-btn um-btn-quiet" type="button" @click="snoozeUpdate(3)">3 天</button>
              <button class="um-btn um-btn-quiet" type="button" @click="snoozeUpdate(7)">7 天</button>
            </div>
            <div class="um-actions">
              <button class="um-btn" type="button" @click="skipUpdateVersion">跳过本版本</button>
              <button class="um-btn um-primary" type="button" @click="closeUpdateModal">关闭</button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.um-mask {
  --um-mask-bg: rgba(15, 23, 42, 0.34);
  --um-surface: #ffffff;
  --um-border: #e4e7ed;
  --um-text: #1f2329;
  --um-muted: #7a8290;
  --um-primary: #409eff;
  --um-primary-soft: #ecf5ff;
  --um-radius: 16px;

  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--um-mask-bg);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.um-box {
  display: flex;
  flex-direction: column;
  width: 620px;
  max-width: 100%;
  max-height: 86vh;
  overflow: hidden;
  background: var(--um-surface);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: var(--um-radius);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24), 0 4px 12px rgba(15, 23, 42, 0.1);
  outline: none;
}
.um-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 22px 22px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.um-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-top: 1px;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  background: linear-gradient(135deg, #66b1ff, #409eff);
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.28);
}
.um-head-main {
  flex: 1;
  min-width: 0;
}
.um-title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--um-text);
}
.um-version {
  margin-left: 4px;
  color: var(--um-primary);
  font-variant-numeric: tabular-nums;
}
.um-sub {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--um-muted);
}
.um-arrow,
.um-dot {
  margin: 0 6px;
  color: #c0c4cc;
}
.um-tagline {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
}
.um-close {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 22px;
  line-height: 1;
  color: #a8abb2;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.um-close:hover {
  color: #606266;
  background: #f5f7fa;
}
.um-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 16px;
}
.um-section + .um-section {
  margin-top: 18px;
}
.um-section-title {
  margin: 0 0 9px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.um-list {
  margin: 0;
  padding-left: 20px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.75;
}
.um-list li + li {
  margin-top: 4px;
}
.um-list li::marker {
  color: var(--um-primary);
}
.um-details {
  margin-top: 14px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #edf1f7;
  border-radius: 8px;
}
.um-details summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  user-select: none;
}
.um-notes {
  margin: 10px 0 0;
  max-height: 220px;
  overflow: auto;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
  color: #606266;
  white-space: pre-wrap;
  word-break: break-word;
}
.um-muted {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--um-muted);
}
.um-upgrade {
  margin-top: 18px;
  padding: 14px;
  background: #f8fbff;
  border: 1px solid #d9ecff;
  border-radius: 10px;
}
.um-upgrade-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.um-upgrade-head .um-section-title {
  margin: 0;
}
.um-upgrade-tip {
  flex: 0 0 auto;
  font-size: 12px;
  color: #909399;
}
.um-command {
  display: flex;
  align-items: stretch;
  gap: 10px;
  margin-top: 10px;
}
.um-command code {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  overflow-x: auto;
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #1f2d3d;
  background: #fff;
  border: 1px solid #d9ecff;
  border-radius: 7px;
  white-space: nowrap;
}
.um-copy {
  flex: 0 0 auto;
  padding: 0 14px;
  font-size: 13px;
  color: var(--um-primary);
  background: #fff;
  border: 1px solid #a0cfff;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}
.um-copy:hover {
  background: var(--um-primary-soft);
  border-color: var(--um-primary);
}
.um-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}
.um-link {
  display: inline-block;
  margin-top: 14px;
  font-size: 13px;
  color: var(--um-primary);
  text-decoration: none;
}
.um-link:hover {
  text-decoration: underline;
}
.um-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 22px;
  background: #fcfcfd;
  border-top: 1px solid #f0f2f5;
}
.um-snooze,
.um-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.um-snooze-label {
  margin-right: 2px;
  font-size: 12px;
  color: #909399;
}
.um-btn {
  padding: 7px 14px;
  font-family: inherit;
  font-size: 13px;
  color: #4b5563;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 7px;
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}
.um-btn:hover {
  color: var(--um-primary);
  border-color: #a0cfff;
}
.um-btn-quiet {
  padding: 5px 9px;
  font-size: 12px;
  color: #606266;
  background: transparent;
  border-color: transparent;
}
.um-btn-quiet:hover {
  color: var(--um-primary);
  background: var(--um-primary-soft);
}
.um-primary {
  color: #fff;
  background: var(--um-primary);
  border-color: var(--um-primary);
}
.um-primary:hover {
  color: #fff;
  background: #66b1ff;
  border-color: #66b1ff;
}
/* 遮罩淡入 + 弹窗上浮 */
.um-enter-active,
.um-leave-active {
  transition: opacity 0.18s ease;
}
.um-enter-active .um-box,
.um-leave-active .um-box {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
}
.um-enter-from,
.um-leave-to {
  opacity: 0;
}
.um-enter-from .um-box,
.um-leave-to .um-box {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}
@media (max-width: 640px) {
  .um-mask {
    padding: 12px;
  }
  .um-box {
    max-height: 92vh;
  }
  .um-head,
  .um-body,
  .um-foot {
    padding-left: 16px;
    padding-right: 16px;
  }
  .um-foot {
    flex-direction: column;
    align-items: stretch;
  }
  .um-actions {
    justify-content: flex-end;
  }
  .um-command {
    flex-direction: column;
  }
  .um-copy {
    min-height: 34px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .um-enter-active,
  .um-leave-active,
  .um-enter-active .um-box,
  .um-leave-active .um-box {
    transition: none;
  }
}
</style>
