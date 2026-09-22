<template>
  <div class="doc-library">
    <div class="lib-head">
      <span class="lib-title">文档库</span>
      <button class="btn btn-sm" type="button" @click="showCreate = !showCreate">
        {{ showCreate ? "收起" : "+ 新建文档" }}
      </button>
    </div>

    <!-- 刷新/加载反馈：不隐藏已有列表与正文，避免闪屏 -->
    <p v-if="loading" class="lib-loading">加载中…</p>

    <!-- 文档状态 tab（当前聚焦 → 长期更新 → 留档） -->
    <div class="status-tabs">
      <button
        v-for="t in statusTabs"
        :key="t.value"
        class="status-tab"
        :class="{ active: statusFilter === t.value }"
        type="button"
        @click="statusFilter = t.value"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 新建文档表单 -->
    <form v-if="showCreate" class="create-form" @submit.prevent="onCreate">
      <input v-model="createForm.title" class="input" placeholder="文档名称（必填）" maxlength="80" />
      <input v-model="createForm.docType" class="input" placeholder="文档类型（如：开发文档 / 会议纪要）" maxlength="40" />
      <textarea
        v-model="createForm.content"
        class="input ta"
        rows="4"
        placeholder="初始内容（markdown，可选）"
      ></textarea>
      <button class="btn btn-sm btn-primary" type="submit" :disabled="creating">创建</button>
    </form>

    <!-- 文档 tab 列表（按当前状态过滤） -->
    <div v-if="filteredDocuments.length" class="doc-tabs">
      <span
        v-for="d in filteredDocuments"
        :key="d.docId"
        class="doc-tab"
        :class="{ active: d.docId === activeDocId }"
        @click="activeDocId = d.docId"
      >
        {{ d.title }}
        <span v-if="d.docType" class="doc-type">{{ d.docType }}</span>
      </span>
    </div>
    <p v-else class="hint">该状态下暂无文档</p>

    <!-- 当前文档操作：改状态 / 重命名 / 删除 -->
    <div v-if="activeDoc" class="doc-actions">
      <select v-model="statusDraft" class="status-select" @change="onChangeStatus">
        <option v-for="t in statusTabs" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <button class="btn btn-sm" type="button" @click="openRename">重命名</button>
      <button class="btn btn-sm btn-danger" type="button" @click="onDelete">删除</button>
    </div>

    <!-- 重命名表单 -->
    <form v-if="renaming" class="create-form" @submit.prevent="onRename">
      <input v-model="renameForm.title" class="input" placeholder="文档名称" maxlength="80" />
      <input v-model="renameForm.docType" class="input" placeholder="文档类型" maxlength="40" />
      <button class="btn btn-sm btn-primary" type="submit" :disabled="saving">保存</button>
      <button class="btn btn-sm" type="button" @click="renaming = false">取消</button>
    </form>

    <p v-if="error" class="hint error">{{ error }}</p>

    <!-- 当前文档内容（全量 markdown 视图 + 编辑） -->
    <DocumentFragments
      v-if="activeDocId"
      :project-id="projectId"
      :doc-id="activeDocId"
      :title="activeDoc?.title"
      :refresh-tick="refreshTick"
    />

    <!-- 悬浮操作：刷新 + 回到顶部（右下角常驻） -->
    <div class="float-actions">
      <button class="float-btn" type="button" title="刷新文档库" @click="onRefresh">⟳</button>
      <button class="float-btn" type="button" title="回到顶部" @click="scrollTop">↑</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { getProjectIndex, createDocument, renameDocument, deleteDocument, ApiError } from "../../api/index";
import type { DocumentStatus } from "@stagelab/shared";
import type { DocumentItem } from "../../api/documents";
import DocumentFragments from "./DocumentFragments.vue";
import { confirmDialog } from "../common/ConfirmDialog.vue";

const props = defineProps<{ projectId: string }>();

/** 刷新完成后通知父级重拉项目索引（同步顶部统计） */
const emit = defineEmits<{
  (e: "refresh"): void;
}>();

const documents = ref<DocumentItem[]>([]);
const activeDocId = ref<string>("");
const loading = ref(false);
const error = ref("");
const creating = ref(false);
const saving = ref(false);
const showCreate = ref(false);
const renaming = ref(false);
const refreshTick = ref(0);
const createForm = reactive({ title: "", docType: "", content: "" });
const renameForm = reactive({ title: "", docType: "" });

const activeDoc = computed(() =>
  documents.value.find((d) => d.docId === activeDocId.value)
);

/** 文档状态三态（排序：当前聚焦 → 长期更新 → 留档） */
const statusTabs: Array<{ value: DocumentStatus; label: string }> = [
  { value: "focused", label: "当前聚焦" },
  { value: "maintained", label: "长期更新" },
  { value: "archived", label: "留档" }
];
const statusFilter = ref<DocumentStatus>("focused");
const statusDraft = ref<DocumentStatus>("focused");
const filteredDocuments = computed(() =>
  documents.value.filter((d) => (d.status ?? "focused") === statusFilter.value)
);

/** 加载项目文档列表（来自项目索引） */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const index = await getProjectIndex(props.projectId);
    documents.value = index.documents as DocumentItem[];
    // 保持当前选中文档；若不存在（如删除/刷新）则回退到第一个
    if (!activeDocId.value || !documents.value.some((d) => d.docId === activeDocId.value)) {
      activeDocId.value = documents.value[0]?.docId ?? "";
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载文档列表失败";
  } finally {
    loading.value = false;
  }
}

/** 新建文档 */
async function onCreate() {
  const title = createForm.title.trim();
  if (!title) {
    error.value = "请填写文档名称";
    return;
  }
  creating.value = true;
  error.value = "";
  try {
    await createDocument(props.projectId, {
      title,
      docType: createForm.docType.trim() || undefined,
      content: createForm.content
    });
    createForm.title = "";
    createForm.docType = "";
    createForm.content = "";
    showCreate.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "创建文档失败";
  } finally {
    creating.value = false;
  }
}

function openRename() {
  if (!activeDoc.value) return;
  renameForm.title = activeDoc.value.title;
  renameForm.docType = activeDoc.value.docType ?? "";
  renaming.value = true;
}

/** 重命名文档 */
async function onRename() {
  const title = renameForm.title.trim();
  if (!title) {
    error.value = "请填写文档名称";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await renameDocument(props.projectId, activeDocId.value, {
      title,
      docType: renameForm.docType.trim() || undefined
    });
    renaming.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "重命名失败";
  } finally {
    saving.value = false;
  }
}

/** 修改文档状态（当前聚焦/长期更新/留档） */
async function onChangeStatus() {
  if (!activeDoc.value) return;
  try {
    await renameDocument(props.projectId, activeDocId.value, {
      status: statusDraft.value
    });
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "修改状态失败";
  }
}

/** 删除文档 */
async function onDelete() {
  if (!activeDoc.value) return;
  const ok = await confirmDialog({
    title: "删除文档",
    message: `确定删除文档「${activeDoc.value.title}」吗？该文档全部内容将被删除，不可恢复。`,
    confirmText: "删除",
    danger: true
  });
  if (!ok) return;
  try {
    await deleteDocument(props.projectId, activeDocId.value);
    activeDocId.value = "";
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "删除文档失败";
  }
}

/** 回到顶部（页面/视口滚动） */
function scrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** 刷新：重新拉取文档列表 + 递增 refreshTick 让当前阅读的文档全文重新加载 */
async function onRefresh() {
  refreshTick.value += 1;
  await load();
  // 通知父级重拉项目索引，使顶部文档统计同步
  emit("refresh");
}

onMounted(load);
watch(() => props.projectId, () => {
  activeDocId.value = "";
  load();
});
watch(activeDoc, (doc) => {
  statusDraft.value = doc?.status ?? "focused";
});
</script>

<style scoped>
.doc-library {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lib-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
/* 刷新/加载提示（与需求 Tab 的「加载中…」保持一致观感） */
.lib-loading {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
.status-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #e4e7ed;
}
.status-tab {
  flex: none;
  padding: 7px 16px;
  font-size: 13px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #606266;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.status-tab:hover {
  color: #409eff;
}
.status-tab.active {
  color: #409eff;
  border-bottom-color: #409eff;
  font-weight: 600;
}
.doc-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 10px;
}
.doc-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.doc-tab:hover {
  border-color: #409eff;
  color: #409eff;
}
.doc-tab.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.doc-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  opacity: 0.85;
}
.doc-actions {
  display: flex;
  gap: 8px;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}
.create-form .row {
  display: flex;
  gap: 8px;
}
.input {
  flex: 1;
  min-width: 120px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.input:focus {
  border-color: #409eff;
}
.ta {
  resize: vertical;
  line-height: 1.6;
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
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.btn-danger {
  border-color: #f56c6c;
  color: #f56c6c;
}
.btn-danger:hover {
  background: #fef0f0;
  border-color: #f56c6c;
  color: #f56c6c;
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
}
.hint.error {
  color: #f56c6c;
}
.float-actions {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
}
.float-btn {
  width: 36px;
  height: 36px;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 50%;
  background: #fff;
  color: #606266;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: border-color 0.2s, color 0.2s;
}
.float-btn:hover {
  border-color: #409eff;
  color: #409eff;
}
</style>
