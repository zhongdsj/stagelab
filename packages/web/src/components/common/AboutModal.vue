<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ensureVersionChecked, updateState } from "../../utils/update";
import {
  aboutState,
  CHANGELOG_URL,
  closeAbout,
  GITHUB_URL,
  LOCAL_RELEASE,
  RELEASES_URL,
  type AboutRelease
} from "../../utils/about";

const boxRef = ref<HTMLElement | null>(null);

const info = computed(() => updateState.info);
const version = computed(() => info.value?.current || LOCAL_RELEASE.version);

/**
 * 优先展示版本接口返回的 Release：
 * - 有新版时，它就是最新版说明
 * - 已是最新时，它与当前版本一致
 * 接口不可用、或本地版本领先于 npm 时，回退到构建时打包的 release.json。
 */
const release = computed<AboutRelease | null>(() => {
  const remote = info.value?.release;
  if (
    remote &&
    (info.value?.updateAvailable === true || remote.version === version.value)
  ) {
    return remote;
  }
  if (LOCAL_RELEASE.version === version.value) return LOCAL_RELEASE;
  return null;
});

const highlights = computed(() => release.value?.highlights ?? []);
const releaseUrl = computed(() => release.value?.url ?? "");
const releaseTitle = computed(() => release.value?.title || "项目更新");

/** 发布日期只显示到天；无效日期不显示 */
const releaseDate = computed(() => {
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

/** 关闭前先触发一次版本判断：若检查期间发现了新版，会在离场动画后补弹更新层 */
function close(): void {
  closeAbout();
  window.setTimeout(() => void ensureVersionChecked(), 260);
}

/** Esc 关闭；Tab 在弹层内循环，避免焦点跑到被遮罩的页面 */
function onKeydown(event: KeyboardEvent): void {
  if (!aboutState.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
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
  () => aboutState.visible,
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
    <Transition name="am">
      <div v-if="aboutState.visible" class="am-mask" @click.self="close">
        <div
          ref="boxRef"
          class="am-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="am-title"
          aria-describedby="am-intro"
          tabindex="-1"
        >
          <header class="am-head">
            <div class="am-logo" aria-hidden="true">四阶段</div>
            <div class="am-head-main">
              <h2 id="am-title" class="am-title">
                Stagelab
                <span class="am-version">v{{ version }}</span>
              </h2>
              <p class="am-tagline">面向 AI 协作的项目管理工具</p>
            </div>
            <button class="am-close" type="button" title="关闭" aria-label="关闭关于" @click="close">
              ×
            </button>
          </header>

          <div class="am-body">
            <p id="am-intro" class="am-intro">
              把需求、任务、文档和架构 / 类 / 流程三类图放进同一个仓库，通过 Web 界面与
              MCP 同时管理。让 AI 先读上下文、再写代码，人负责阶段推进与验收。
            </p>

            <section class="am-section">
              <h3 class="am-section-title">核心能力</h3>
              <ul class="am-features">
                <li class="am-feature">
                  <span class="am-feature-icon" aria-hidden="true">流</span>
                  <div>
                    <strong>四阶段工作流</strong>
                    <p>需求、拆解、编码、验收四步推进，阶段与任务状态清晰可查。</p>
                  </div>
                </li>
                <li class="am-feature">
                  <span class="am-feature-icon" aria-hidden="true">图</span>
                  <div>
                    <strong>三类语义图</strong>
                    <p>架构图、类图、流程图，节点可关联源码锚点与影响面。</p>
                  </div>
                </li>
                <li class="am-feature">
                  <span class="am-feature-icon" aria-hidden="true">M</span>
                  <div>
                    <strong>MCP 接入</strong>
                    <p>把项目上下文暴露给 AI 客户端，先定位范围再改代码，减少盲改。</p>
                  </div>
                </li>
                <li class="am-feature">
                  <span class="am-feature-icon" aria-hidden="true">本</span>
                  <div>
                    <strong>本地优先</strong>
                    <p>项目数据写在仓库 .stagelab/ 下，随 Git 提交、审查和回滚。</p>
                  </div>
                </li>
              </ul>
            </section>

            <section class="am-section">
              <div class="am-section-head">
                <h3 class="am-section-title">最新更新</h3>
                <span v-if="releaseDate" class="am-date">{{ releaseDate }}</span>
              </div>

              <div v-if="release" class="am-release">
                <div class="am-release-head">
                  <strong class="am-release-title">{{ releaseTitle }}</strong>
                  <span class="am-release-version">v{{ release.version }}</span>
                </div>
                <ul v-if="highlights.length" class="am-list">
                  <li v-for="(item, index) in highlights" :key="index">{{ item }}</li>
                </ul>
                <p v-else class="am-muted">该版本暂无摘要，可前往 GitHub 查看完整记录。</p>
                <a
                  v-if="releaseUrl"
                  class="am-link"
                  :href="releaseUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看本次 Release 说明 →
                </a>
              </div>
              <p v-else class="am-muted">暂未获取到更新说明，可前往 GitHub 查看提交与版本记录。</p>
            </section>

            <section class="am-section am-links">
              <a
                class="am-github"
                :href="GITHUB_URL"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="在 GitHub 打开 stagelab 仓库"
              >
                <span class="am-github-mark" aria-hidden="true">GH</span>
                <span class="am-github-text">
                  <strong>GitHub 仓库</strong>
                  <small>zhongdsj/stagelab</small>
                </span>
                <span class="am-github-arrow" aria-hidden="true">↗</span>
              </a>
              <div class="am-sub-links">
                <a :href="CHANGELOG_URL" target="_blank" rel="noopener noreferrer">更新日志</a>
                <span class="am-sub-dot" aria-hidden="true">·</span>
                <a :href="RELEASES_URL" target="_blank" rel="noopener noreferrer">所有版本</a>
              </div>
            </section>
          </div>

          <footer class="am-foot">
            <span class="am-foot-note">数据保存在项目仓库的 .stagelab/ 目录</span>
            <button class="am-btn am-primary" type="button" @click="close">关闭</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.am-mask {
  --am-surface: #ffffff;
  --am-text: #1f2329;
  --am-muted: #7a8290;
  --am-border: #e4e7ed;
  --am-primary: #409eff;
  --am-primary-soft: #ecf5ff;
  --am-radius: 16px;

  position: fixed;
  inset: 0;
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.am-box {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 640px;
  max-width: 100%;
  max-height: 88vh;
  overflow: hidden;
  background: var(--am-surface);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: var(--am-radius);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24), 0 4px 12px rgba(15, 23, 42, 0.1);
  outline: none;
}
.am-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 22px 22px 18px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
  border-bottom: 1px solid #f0f2f5;
}
.am-logo {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #66b1ff, #409eff);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.28);
}
.am-head-main {
  flex: 1;
  min-width: 0;
}
.am-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--am-text);
}
.am-version {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--am-primary);
  background: var(--am-primary-soft);
  border: 1px solid #d9ecff;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.am-tagline {
  margin: 5px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--am-muted);
}
.am-close {
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
.am-close:hover {
  color: #606266;
  background: #f5f7fa;
}
.am-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 16px;
}
.am-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: #4b5563;
}
.am-section {
  margin-top: 20px;
}
.am-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.am-section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.am-section-head .am-section-title {
  margin-bottom: 10px;
}
.am-date {
  flex: 0 0 auto;
  font-size: 12px;
  color: #909399;
  font-variant-numeric: tabular-nums;
}
.am-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.am-feature {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: #fafbfc;
  border: 1px solid #eef1f5;
  border-radius: 10px;
}
.am-feature-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 12px;
  font-weight: 600;
  color: var(--am-primary);
  background: var(--am-primary-soft);
  border-radius: 7px;
}
.am-feature strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: #303133;
}
.am-feature p {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.65;
  color: #7a8290;
}
.am-release {
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #edf1f7;
  border-radius: 12px;
}
.am-release-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.am-release-title {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  color: #303133;
}
.am-release-version {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--am-primary);
  font-variant-numeric: tabular-nums;
}
.am-list {
  margin: 10px 0 0;
  padding-left: 19px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.75;
}
.am-list li + li {
  margin-top: 4px;
}
.am-list li::marker {
  color: var(--am-primary);
}
.am-muted {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--am-muted);
}
.am-release .am-muted {
  margin-top: 8px;
  font-size: 12px;
}
.am-link {
  display: inline-block;
  margin-top: 10px;
  font-size: 12px;
  color: var(--am-primary);
  text-decoration: none;
}
.am-link:hover {
  text-decoration: underline;
}
.am-links {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 16px;
  border-top: 1px solid #f0f2f5;
}
.am-github {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 12px;
  color: #303133;
  text-decoration: none;
  background: #fff;
  border: 1px solid var(--am-border);
  border-radius: 10px;
  transition: border-color 0.18s ease, background 0.18s ease;
}
.am-github:hover {
  background: #f8fbff;
  border-color: #a0cfff;
}
.am-github-mark {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #24292f;
  border-radius: 7px;
}
.am-github-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}
.am-github-text strong {
  font-size: 13px;
  font-weight: 600;
}
.am-github-text small {
  font-size: 11px;
  color: #909399;
}
.am-github-arrow {
  flex: 0 0 auto;
  margin-left: 4px;
  font-size: 14px;
  color: #909399;
}
.am-sub-links {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  font-size: 12px;
}
.am-sub-links a {
  color: #606266;
  text-decoration: none;
}
.am-sub-links a:hover {
  color: var(--am-primary);
  text-decoration: underline;
}
.am-sub-dot {
  color: #c0c4cc;
}
.am-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 22px;
  background: #fcfcfd;
  border-top: 1px solid #f0f2f5;
}
.am-foot-note {
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}
.am-btn {
  flex: 0 0 auto;
  padding: 7px 18px;
  font-family: inherit;
  font-size: 13px;
  border-radius: 7px;
  cursor: pointer;
}
.am-primary {
  color: #fff;
  background: var(--am-primary);
  border: 1px solid var(--am-primary);
}
.am-primary:hover {
  background: #66b1ff;
  border-color: #66b1ff;
}
/* 遮罩淡入 + 弹窗上浮 */
.am-enter-active,
.am-leave-active {
  transition: opacity 0.18s ease;
}
.am-enter-active .am-box,
.am-leave-active .am-box {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
}
.am-enter-from,
.am-leave-to {
  opacity: 0;
}
.am-enter-from .am-box,
.am-leave-to .am-box {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}
@media (max-width: 640px) {
  .am-mask {
    padding: 12px;
  }
  .am-box {
    max-height: 92vh;
  }
  .am-head,
  .am-body,
  .am-foot {
    padding-left: 16px;
    padding-right: 16px;
  }
  .am-features {
    grid-template-columns: 1fr;
  }
  .am-foot {
    flex-direction: column;
    align-items: stretch;
  }
  .am-btn {
    width: 100%;
  }
  .am-links {
    flex-direction: column;
    align-items: stretch;
  }
  .am-sub-links {
    justify-content: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .am-enter-active,
  .am-leave-active,
  .am-enter-active .am-box,
  .am-leave-active .am-box {
    transition: none;
  }
}
</style>
