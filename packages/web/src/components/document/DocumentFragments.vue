<template>
  <div class="doc-fragments">
    <div class="doc-head">
      <span class="doc-title">{{ doc?.title || title || "文档" }}</span>
      <button
        class="doc-id"
        type="button"
        :title="`文档 ID：${docId}（点击复制）`"
        @click="copyDocId"
      >
        id: {{ docId }}
      </button>
    </div>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>

    <template v-else>
      <!-- 编辑区（全量编辑：标题/摘要 + 内容） -->
      <div v-if="editing" class="frag-editor">
        <input
          v-model="draftTitle"
          class="frag-input"
          placeholder="文档标题（必填）"
          maxlength="80"
        />
        <textarea
          v-model="draftSummary"
          class="frag-input"
          rows="2"
          placeholder="文档摘要（可选，markdown 文本，帮助快速理解文档性质）"
        ></textarea>
        <textarea
          v-model="draft"
          class="frag-textarea"
          rows="18"
          spellcheck="false"
        ></textarea>
        <div class="editor-actions">
          <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
            {{ saving ? "保存中…" : "保存" }}
          </button>
          <button class="btn" type="button" @click="editing = false">取消</button>
          <span class="char-count">{{ draft.length }} 字</span>
        </div>
      </div>
      <!-- 只读视图：摘要 + 逐分片 markdown 渲染（每分片带 anchor，供搜索跳转定位） -->
      <div v-else ref="viewRef" class="frag-view">
        <div v-if="doc?.summary" class="frag-summary">
          <span class="summary-label">摘要</span>
          <span class="summary-text">{{ doc.summary }}</span>
        </div>
        <section
          v-for="f in fragments"
          :id="`frag-${f.order}`"
          :key="f.order"
          class="frag-section"
        >
          <div v-if="fragments.length > 1" class="frag-section-head">
            <span class="frag-order">分片 {{ f.order + 1 }}</span>
            <span v-if="f.title" class="frag-title">{{ f.title }}</span>
          </div>
          <div class="md-body" v-html="f.html"></div>
        </section>
        <div class="view-actions">
          <button class="btn" type="button" @click="startEdit">编辑文档</button>
        </div>
      </div>
    </template>

    <!-- 文档大纲侧边栏：跟随视窗浮动 + scrollspy 高亮当前章节（标题数不足 2 或编辑态隐藏） -->
    <aside v-if="!editing && outline.length >= 2" ref="outlineListRef" class="doc-outline">
      <div class="outline-title">大纲</div>
      <ul class="outline-list">
        <li
          v-for="h in outline"
          :key="h.id"
          class="outline-item"
          :class="[`lv-${h.level}`, { active: activeHeadingId === h.id }]"
        >
          <button type="button" :title="h.text" @click="scrollToHeading(h.id)">{{ h.text }}</button>
        </li>
      </ul>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  getFullDocument,
  listFragments,
  getFragment,
  updateFullDocument,
  renameDocument,
  ApiError
} from "../../api/index";
import type { FullDocument } from "../../api/documents";
import { confirmDialog } from "../common/ConfirmDialog.vue";
import { copyText } from "../../utils/clipboard";
import { message } from "../../utils/message";

const props = defineProps<{
  projectId: string;
  docId: string;
  title?: string;
  /** 刷新信号：值变化时重新加载当前文档全文（父级刷新按钮触发） */
  refreshTick?: number;
  /** 搜索跳转：命中分片 order（T7 先滚该分片锚点） */
  focusOrder?: number;
  /** 搜索跳转：关键词（T7 定位并高亮） */
  highlightKeyword?: string;
  /** 定位信号：文档/分片/关键词组合变化时重新定位 */
  focusKey?: string;
}>();

const loading = ref(false);
const error = ref("");
const saving = ref(false);
const doc = ref<FullDocument | null>(null);
const editing = ref(false);
const draft = ref("");
const draftTitle = ref("");
const draftSummary = ref("");

/** 逐分片渲染结果（order/title/html）：分片是完整章节单元，保留锚点供定位 */
interface RenderedFragment {
  order: number;
  title: string;
  html: string;
}
const fragments = ref<RenderedFragment[]>([]);

/** markdown 渲染（marked 解析 + DOMPurify 消毒防 XSS） */
function renderMarkdown(md: string): string {
  const raw = marked.parse(md) as string;
  return DOMPurify.sanitize(raw);
}

/* ========== 文档大纲（跟随视窗浮动侧边栏 + scrollspy 高亮当前章节） ========== */

/** 判定“当前章节”时使用的视口顶部偏移（px） */
const HEAD_OFFSET = 12;

const viewRef = ref<HTMLElement | null>(null);
const outlineListRef = ref<HTMLElement | null>(null);
/** 当前文档大纲（h1-h4 标题），标题 id 稳定注入，供 scrollspy 与点击定位 */
const outline = ref<Array<{ id: string; level: number; text: string }>>([]);
const activeHeadingId = ref("");

/** 扫描渲染后的正文标题，注入稳定 id 并生成大纲 */
function scanHeadings() {
  outline.value = [];
  activeHeadingId.value = "";
  const md = viewRef.value?.querySelector(".md-body");
  if (!md) return;
  const heads = Array.from(md.querySelectorAll("h1, h2, h3, h4")) as HTMLElement[];
  heads.forEach((el, i) => {
    const id = `doc-h-${i}`;
    el.id = id;
    outline.value.push({
      id,
      level: Number(el.tagName[1]),
      text: el.textContent?.trim() || `章节 ${i + 1}`
    });
  });
  updateActive();
}

/** scrollspy：高亮当前正在浏览的章节（最后一个顶部越过偏移线的标题） */
function updateActive() {
  let current = "";
  for (const h of outline.value) {
    const el = document.getElementById(h.id);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= HEAD_OFFSET) current = h.id;
  }
  if (current !== activeHeadingId.value) {
    activeHeadingId.value = current;
    // 让高亮项保持在侧边栏可视区内（页面滚动后不被卷出）
    outlineListRef.value
      ?.querySelector(".outline-item.active")
      ?.scrollIntoView({ block: "nearest" });
  }
}

/** 点击大纲条目：平滑滚动定位到对应章节 */
function scrollToHeading(id: string) {
  activeHeadingId.value = id;
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - HEAD_OFFSET;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/** 视口滚动时刷新高亮（滚动容器为页面/视口） */
function onWindowScroll() {
  updateActive();
}

/* ========== T7：搜索定位与关键词高亮 ========== */

/** 已应用过的定位信号（避免文档切换/手动浏览时重复跳转） */
let appliedFocusKey = "";
/** 定位待执行（文档切换中内容未就绪时由 load 完成后补做） */
let pendingFocus = false;
let markTimer: ReturnType<typeof setTimeout> | undefined;

/** 清理已插入的 mark（还原文本节点，避免重复高亮叠加） */
function clearMarks() {
  if (markTimer) {
    clearTimeout(markTimer);
    markTimer = undefined;
  }
  const root = viewRef.value;
  if (!root) return;
  root.querySelectorAll("mark.search-hit").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
    parent.normalize();
  });
}

/**
 * 在容器内给关键词包 <mark>：仅处理单文本节点内命中，
 * 关键词被加粗/链接等格式拆开时无法安全建区间，保留分片锚点即可。
 */
function markKeyword(root: HTMLElement, keyword: string): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && node.textContent.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Text);
    n = walker.nextNode();
  }

  const lower = keyword.toLowerCase();
  let first: HTMLElement | null = null;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const hay = text.toLowerCase();
    const starts: number[] = [];
    let from = 0;
    while (from <= hay.length - lower.length) {
      const idx = hay.indexOf(lower, from);
      if (idx === -1) break;
      starts.push(idx);
      from = idx + lower.length;
    }
    // 同一文本节点内从后往前包，避免前一次 DOM 变更影响后续偏移
    for (let i = starts.length - 1; i >= 0; i--) {
      const idx = starts[i];
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + keyword.length);
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      range.surroundContents(mark);
      if (!first) first = mark;
    }
  }
  return first;
}

/** 先滚命中分片锚点，再尝试在分片内精确滚到关键词；3 秒后淡出清理 */
function locate(keyword: string) {
  clearMarks();
  const root = viewRef.value;
  if (!root) return;

  const target =
    props.focusOrder !== undefined
      ? root.querySelector<HTMLElement>(`#frag-${props.focusOrder}`)
      : null;

  const firstMark = markKeyword(target ?? root, keyword);
  if (firstMark) {
    firstMark.scrollIntoView({ block: "center", behavior: "smooth" });
    markTimer = setTimeout(clearMarks, 3000);
    return;
  }
  // 关键词跨格式边界无法建 DOM 区间：停留在分片锚点
  if (target) {
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

/** 有定位信号时执行一次跳转（内容未就绪则置 pending，由 load 完成后补做） */
async function applyFocusIfNeeded() {
  const keyword = props.highlightKeyword?.trim();
  if (!keyword) {
    appliedFocusKey = props.focusKey ?? "";
    pendingFocus = false;
    return;
  }
  const sameKey =
    props.focusKey !== undefined && props.focusKey === appliedFocusKey;
  if (sameKey && !pendingFocus) return;

  await nextTick();
  // 文档切换中（全文/分片尚未对齐）先挂起，load 完成后重试
  if (!fragments.value.length || (doc.value && doc.value.docId !== props.docId)) {
    pendingFocus = true;
    return;
  }
  appliedFocusKey = props.focusKey ?? "";
  pendingFocus = false;
  locate(keyword);
}

// 同一文档连续搜索不同关键词（或跳不同分片）时重新定位
watch(
  () => props.focusKey,
  () => {
    pendingFocus = true;
    void applyFocusIfNeeded();
  }
);

/** 加载文档：全文（编辑/摘要用）+ 逐分片内容（渲染/锚点用） */
async function load() {
  loading.value = true;
  error.value = "";
  editing.value = false;
  fragments.value = [];
  try {
    const [full, metas] = await Promise.all([
      getFullDocument(props.projectId, props.docId),
      listFragments(props.projectId, props.docId)
    ]);
    doc.value = full;
    // 按 order 排序后逐分片取正文（分片是完整章节单元，渲染效果与拼接一致）
    const sorted = [...metas].sort((a, b) => a.order - b.order);
    const contents = await Promise.all(
      sorted.map((m) => getFragment(props.projectId, props.docId, m.fragmentId))
    );
    fragments.value = contents
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        order: f.order,
        title: f.title,
        html: renderMarkdown(f.content)
      }));
    // 先退出 loading 让只读视图渲染出 ref，再扫描大纲与执行定位
    // （applyFocusIfNeeded 依赖 viewRef，loading 未清时 DOM 仍是「加载中」占位）
    loading.value = false;
    await nextTick();
    scanHeadings();
    await applyFocusIfNeeded();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载文档失败";
  } finally {
    loading.value = false;
  }
}

/** 复制文档 ID 到剪贴板（供 AI 交互时直接引用，免去先读文档列表） */
async function copyDocId() {
  const ok = await copyText(props.docId);
  if (ok) message.success("文档 ID 已复制");
  else message.error("复制失败，请手动选择");
}

function startEdit() {
  if (!doc.value) return;
  draftTitle.value = doc.value.title;
  draftSummary.value = doc.value.summary ?? "";
  draft.value = doc.value.content;
  editing.value = true;
}

/** 保存全量编辑（meta：标题/摘要；正文：清空其他分片 + order0 单分片全量覆盖，不自动切分；超长给分级警告） */
async function save() {
  if (!doc.value) return;
  const title = draftTitle.value.trim();
  if (!title) {
    error.value = "文档标题不能为空";
    return;
  }
  // 超长分级警告（不阻断，用户确认后仍作为单分片保存）
  const len = draft.value.length;
  if (len > 2000) {
    const overLimit = len > 4000;
    const msg = overLimit
      ? `内容已超过 4000 字（当前 ${len} 字），将作为单分片保存，后续读取成本较高。确定仍保存吗？`
      : `内容已超过 2000 字（当前 ${len} 字）。系统不再自动切分，将作为单分片保存。确定继续吗？`;
    const ok = await confirmDialog({
      title: overLimit ? "内容超长提醒" : "内容偏长提醒",
      message: msg,
      confirmText: "仍要保存",
      danger: overLimit
    });
    if (!ok) return;
  }
  saving.value = true;
  error.value = "";
  try {
    // 更新标题/摘要（meta）
    await renameDocument(props.projectId, props.docId, {
      title,
      summary: draftSummary.value.trim()
    });
    // 更新正文（order0 单分片全量覆盖，不自动切分）
    await updateFullDocument(props.projectId, props.docId, draft.value, title);
    editing.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  load();
  // scrollspy 依赖视口滚动事件（滚动容器为页面/视口）
  window.addEventListener("scroll", onWindowScroll);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onWindowScroll);
});
watch(() => props.docId, () => {
  doc.value = null;
  appliedFocusKey = "";
  load();
});
watch(() => props.refreshTick, () => {
  if (props.refreshTick !== undefined) {
    load();
  }
});
</script>

<style scoped>
.doc-fragments {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
}

/* ===== 文档大纲侧边栏（fixed 跟随视窗浮动 + scrollspy 高亮） ===== */
.doc-outline {
  position: fixed;
  right: 20px;
  top: 100px;
  width: 210px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 10px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  z-index: 100;
}
.outline-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  padding: 0 6px 8px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 6px;
}
.outline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: calc(70vh - 46px);
  overflow-y: auto;
}
.outline-item {
  margin: 1px 0;
}
.outline-item button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 6px;
  font-size: 13px;
  line-height: 1.5;
  color: #606266;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outline-item button:hover {
  color: #409eff;
  background: #ecf5ff;
}
/* 层级缩进：h1 最深，h4 最浅 */
.outline-item.lv-1 {
  padding-left: 0;
}
.outline-item.lv-2 {
  padding-left: 12px;
}
.outline-item.lv-3 {
  padding-left: 24px;
}
.outline-item.lv-4 {
  padding-left: 36px;
}
/* 当前正在浏览的章节高亮 */
.outline-item.active button {
  color: #409eff;
  font-weight: 600;
  background: #ecf5ff;
}
.doc-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.doc-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.doc-id {
  padding: 1px 8px;
  font-size: 12px;
  font-family: Consolas, Monaco, monospace;
  color: #909399;
  background: #f4f4f5;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  cursor: pointer;
}
.doc-id:hover {
  color: #409eff;
  border-color: #409eff;
  background: #ecf5ff;
}
.frag-view {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px 16px;
  background: #fafbfc;
}
.view-actions {
  text-align: right;
  margin-top: 12px;
}
.frag-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.frag-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
  resize: vertical;
}
.frag-input:focus {
  border-color: #409eff;
}
/* 摘要展示区 */
.frag-summary {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
}
.summary-label {
  flex: 0 0 auto;
  color: #e6a23c;
  font-weight: 600;
}
.summary-text {
  word-break: break-word;
  white-space: pre-wrap;
}
.frag-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.7;
  font-family: inherit;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
  resize: vertical;
}
.frag-textarea:focus {
  border-color: #409eff;
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.char-count {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}
.btn {
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.btn:hover {
  border-color: #409eff;
  color: #409eff;
}
.btn-primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.btn-primary:hover {
  background: #66b1ff;
  color: #fff;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.hint {
  color: #909399;
  font-size: 13px;
  padding: 16px 0;
}
.hint.error {
  color: #f56c6c;
}

/* 逐分片渲染：分片之间用虚线分隔，标题标注分片序号便于对照搜索命中 */
.frag-section {
  scroll-margin-top: 16px;
}
.frag-section + .frag-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed #e4e7ed;
}
.frag-section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
}
.frag-order {
  flex: none;
  padding: 1px 6px;
  background: #f0f2f5;
  border-radius: 3px;
  color: #606266;
}
.frag-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 搜索命中高亮：脚本插入 mark 后 3 秒淡出，定时器负责移除节点 */
.md-body :deep(mark.search-hit) {
  background: #ffe58f;
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
  animation: search-hit-fade 3s ease forwards;
}
@keyframes search-hit-fade {
  0%,
  60% {
    background: #ffe58f;
  }
  100% {
    background: transparent;
  }
}

/* markdown 渲染样式（v-html 内容需 :deep 命中） */
.md-body {
  font-size: 14px;
  line-height: 1.75;
  color: #303133;
  word-break: break-word;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  margin: 1.2em 0 0.6em;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.4;
}
.md-body :deep(h1) {
  font-size: 22px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 0.3em;
}
.md-body :deep(h2) {
  font-size: 18px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 0.3em;
}
.md-body :deep(h3) {
  font-size: 16px;
}
.md-body :deep(h4) {
  font-size: 15px;
}
.md-body :deep(p) {
  margin: 0.6em 0;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.6em;
}
.md-body :deep(li) {
  margin: 0.25em 0;
}
.md-body :deep(strong) {
  font-weight: 600;
}
.md-body :deep(a) {
  color: #409eff;
  text-decoration: none;
}
.md-body :deep(a:hover) {
  text-decoration: underline;
}
.md-body :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.2em 1em;
  border-left: 4px solid #dcdfe6;
  color: #606266;
  background: #f8f9fa;
}
.md-body :deep(code) {
  padding: 0.15em 0.4em;
  font-size: 13px;
  font-family: Consolas, Monaco, monospace;
  background: #f0f2f5;
  border-radius: 4px;
  color: #c7254e;
}
.md-body :deep(pre) {
  margin: 0.8em 0;
  padding: 12px 14px;
  background: #282c34;
  border-radius: 6px;
  overflow: auto;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #abb2bf;
  font-size: 13px;
  line-height: 1.6;
}
.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.8em 0;
  font-size: 13px;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 6px 10px;
  text-align: left;
}
.md-body :deep(th) {
  background: #f5f7fa;
  font-weight: 600;
}
.md-body :deep(tr:nth-child(2n)) {
  background: #fafbfc;
}
.md-body :deep(hr) {
  border: none;
  border-top: 1px solid #e4e7ed;
  margin: 1.2em 0;
}
.md-body :deep(img) {
  max-width: 100%;
}
</style>
