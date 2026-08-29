<template>
  <div class="doc-fragments">
    <div class="doc-head">
      <span class="doc-title">{{ title || "开发文档" }}</span>
    </div>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>

    <template v-else>
      <!-- 分片导航 -->
      <div class="frag-tabs">
        <button
          v-for="f in fragments"
          :key="f.fragmentId"
          class="frag-tab"
          :class="{ active: activeId === f.fragmentId }"
          type="button"
          @click="openFragment(f.fragmentId)"
        >
          {{ f.title }}
        </button>
      </div>

      <!-- 编辑区 -->
      <div v-if="editing" class="frag-editor">
        <textarea
          v-model="draft"
          class="frag-textarea"
          rows="12"
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
      <!-- 只读视图 -->
      <div v-else-if="active" class="frag-view">
        <pre class="frag-content">{{ active.content }}</pre>
        <div class="view-actions">
          <button class="btn" type="button" @click="startEdit">编辑此分片</button>
        </div>
      </div>

      <p v-if="fragments.length === 0" class="hint">暂无文档分片</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { listFragments, getFragment, updateFragment, ApiError } from "../../api/index";
import type { DocumentFragment } from "@fourstage/shared";
import type { FragmentMeta } from "../../api/documents";

const props = defineProps<{
  projectId: string;
  docId: string;
  title?: string;
}>();

const loading = ref(false);
const error = ref("");
const saving = ref(false);
const fragments = ref<FragmentMeta[]>([]);
const activeId = ref<string | null>(null);
const active = ref<DocumentFragment | null>(null);
const editing = ref(false);
const draft = ref("");

/** 加载分片列表 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    fragments.value = await listFragments(props.projectId, props.docId);
    if (fragments.value.length > 0) {
      await openFragment(fragments.value[0].fragmentId);
    } else {
      active.value = null;
      activeId.value = null;
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载分片失败";
  } finally {
    loading.value = false;
  }
}

/** 打开分片全文 */
async function openFragment(fragmentId: string) {
  activeId.value = fragmentId;
  editing.value = false;
  try {
    active.value = await getFragment(props.projectId, props.docId, fragmentId);
    draft.value = active.value.content;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "读取分片失败";
  }
}

function startEdit() {
  if (!active.value) return;
  draft.value = active.value.content;
  editing.value = true;
}

/** 保存编辑（覆盖当前分片，超长自动再分片） */
async function save() {
  if (!active.value) return;
  saving.value = true;
  error.value = "";
  try {
    await updateFragment(props.projectId, props.docId, active.value.fragmentId, draft.value);
    editing.value = false;
    await load(); // 重新加载（可能产生新分片）
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => props.docId, () => {
  activeId.value = null;
  active.value = null;
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
.frag-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.frag-tab {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.frag-tab.active {
  border-color: #409eff;
  background: #ecf5ff;
  color: #409eff;
}
.frag-view {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  background: #fafbfc;
}
.frag-content {
  margin: 0 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: #303133;
}
.view-actions {
  text-align: right;
}
.frag-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
</style>
