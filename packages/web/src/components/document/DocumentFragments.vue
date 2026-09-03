<template>
  <div class="doc-fragments">
    <div class="doc-head">
      <span class="doc-title">{{ doc?.title || title || "文档" }}</span>
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
      <!-- 只读视图：摘要 + markdown 渲染 -->
      <div v-else class="frag-view">
        <div v-if="doc?.summary" class="frag-summary">
          <span class="summary-label">摘要</span>
          <span class="summary-text">{{ doc.summary }}</span>
        </div>
        <div class="md-body" v-html="html"></div>
        <div class="view-actions">
          <button class="btn" type="button" @click="startEdit">编辑文档</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  getFullDocument,
  updateFullDocument,
  renameDocument,
  ApiError
} from "../../api/index";
import type { FullDocument } from "../../api/documents";

const props = defineProps<{
  projectId: string;
  docId: string;
  title?: string;
}>();

const loading = ref(false);
const error = ref("");
const saving = ref(false);
const doc = ref<FullDocument | null>(null);
const editing = ref(false);
const draft = ref("");
const draftTitle = ref("");
const draftSummary = ref("");

/** markdown 渲染（marked 解析 + DOMPurify 消毒防 XSS） */
const html = computed(() => {
  if (!doc.value) return "";
  const raw = marked.parse(doc.value.content) as string;
  return DOMPurify.sanitize(raw);
});

/** 加载文档全文 */
async function load() {
  loading.value = true;
  error.value = "";
  editing.value = false;
  try {
    doc.value = await getFullDocument(props.projectId, props.docId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载文档失败";
  } finally {
    loading.value = false;
  }
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
    const msg =
      len > 4000
        ? `内容已超过 4000 字（当前 ${len} 字），将作为单分片保存，后续读取成本较高。确定仍保存吗？`
        : `内容已超过 2000 字（当前 ${len} 字）。系统不再自动切分，将作为单分片保存。确定继续吗？`;
    if (!window.confirm(msg)) return;
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

onMounted(load);
watch(() => props.docId, () => {
  doc.value = null;
  load();
});
</script>

<style scoped>
.doc-fragments {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
}
.doc-head {
  margin-bottom: 12px;
}
.doc-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
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
