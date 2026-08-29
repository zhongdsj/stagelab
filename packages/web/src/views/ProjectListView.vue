<template>
  <section class="project-list-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">项目总览</h2>
        <p class="page-sub">四阶段 MCP 项目管理工具的仓库项目</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate">
        + 新建项目
      </button>
    </div>

    <!-- 创建项目表单 -->
    <form v-if="showCreate" class="create-form" @submit.prevent="onCreate">
      <input
        v-model="form.name"
        class="input"
        placeholder="项目名称（必填）"
        maxlength="60"
      />
      <input
        v-model="form.repoRoot"
        class="input"
        placeholder="仓库根目录（可选，默认当前工作区）"
      />
      <button class="btn btn-primary" type="submit" :disabled="creating">
        {{ creating ? "创建中…" : "确认创建" }}
      </button>
      <button class="btn" type="button" @click="showCreate = false">取消</button>
    </form>

    <!-- 加载/错误/空态 -->
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>
    <div v-else-if="projects.length === 0" class="empty">
      <p class="empty-icon">📂</p>
      <p>暂无项目，点击右上角「新建项目」创建第一个项目</p>
    </div>

    <!-- 项目列表 -->
    <div v-else class="project-grid">
      <div
        v-for="p in projects"
        :key="p.projectId"
        class="project-card"
        @click="openProject(p.projectId)"
      >
        <div class="card-top">
          <span class="card-name">{{ p.projectName }}</span>
          <span class="stage-tag" :class="`stage-${p.currentStage}`">
            {{ stageLabel(p.currentStage) }}
          </span>
        </div>
        <div class="card-meta">
          <span>ID: {{ shortId(p.projectId) }}</span>
          <span>更新于 {{ formatTime(p.updatedAt) }}</span>
        </div>
        <!-- 每个项目两个操作按钮：修改 / 删除 -->
        <div class="card-actions" @click.stop>
          <button class="btn btn-sm" type="button" @click="openRename(p)">修改</button>
          <button class="btn btn-sm btn-danger" type="button" @click="onDeleteProject(p)">删除</button>
        </div>
      </div>
    </div>

    <!-- 修改项目名称弹窗 -->
    <div v-if="showRename" class="modal-mask" @click.self="showRename = false">
      <div class="modal">
        <h3 class="modal-title">修改项目名称</h3>
        <input
          v-model="renameForm.name"
          class="input"
          placeholder="项目名称（必填）"
          maxlength="60"
        />
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" :disabled="renaming" @click="onRename">
            {{ renaming ? "保存中…" : "保存" }}
          </button>
          <button class="btn" type="button" @click="showRename = false">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createProject,
  listProjects,
  renameProject,
  deleteProject,
  ApiError
} from "../api/index";
import type { Project, Stage } from "@fourstage/shared";

const router = useRouter();

const loading = ref(false);
const error = ref("");
const creating = ref(false);
const showCreate = ref(false);
const projects = ref<Project[]>([]);
const form = reactive({ name: "", repoRoot: "" });

// 修改项目名称弹窗状态
const showRename = ref(false);
const renaming = ref(false);
const renameForm = reactive({ id: "", name: "" });

/** 阶段 → 中文标签 */
const STAGE_LABELS: Record<Stage, string> = {
  s1: "需求讨论",
  s2: "任务生成",
  s3: "编码实现",
  s4: "Bug修复"
};

const stageLabel = (s: Stage) => STAGE_LABELS[s];
const shortId = (id: string) => id.slice(0, 8);
const formatTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", { hour12: false });

/** 加载项目列表 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    projects.value = await listProjects();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载项目列表失败";
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  showCreate.value = !showCreate.value;
  if (showCreate.value) {
    form.name = "";
    form.repoRoot = "";
  }
}

/** 创建项目并进入详情页 */
async function onCreate() {
  const name = form.name.trim();
  if (!name) {
    error.value = "请填写项目名称";
    return;
  }
  creating.value = true;
  error.value = "";
  try {
    const project = await createProject(name, form.repoRoot.trim() || undefined);
    router.push(`/projects/${project.projectId}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "创建项目失败";
  } finally {
    creating.value = false;
  }
}

function openProject(id: string) {
  router.push(`/projects/${id}`);
}

/** 打开修改项目名称弹窗 */
function openRename(p: Project) {
  renameForm.id = p.projectId;
  renameForm.name = p.projectName;
  showRename.value = true;
}

/** 保存项目重命名 */
async function onRename() {
  const name = renameForm.name.trim();
  if (!name) {
    error.value = "请填写项目名称";
    return;
  }
  renaming.value = true;
  error.value = "";
  try {
    await renameProject(renameForm.id, name);
    showRename.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "修改项目失败";
  } finally {
    renaming.value = false;
  }
}

/** 删除项目（需用户确认） */
async function onDeleteProject(p: Project) {
  const ok = window.confirm(`确定删除项目「${p.projectName}」吗？该操作不可恢复。`);
  if (!ok) return;
  try {
    await deleteProject(p.projectId);
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "删除项目失败";
  }
}

onMounted(load);
</script>

<style scoped>
.project-list-page {
  max-width: 1080px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  margin: 0 0 4px;
  font-size: 22px;
  color: #303133;
}
.page-sub {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
.btn {
  padding: 8px 16px;
  font-size: 14px;
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
/* 卡片操作按钮区 */
.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
/* 修改名称弹窗 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 360px;
  background: #fff;
  border-radius: 8px;
  padding: 20px;
}
.modal-title {
  margin: 0 0 14px;
  font-size: 15px;
  color: #303133;
}
.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}
.create-form {
  display: flex;
  gap: 10px;
  padding: 14px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  flex-wrap: wrap;
}
.input {
  flex: 1;
  min-width: 180px;
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
}
.input:focus {
  border-color: #409eff;
}
.hint {
  color: #909399;
  font-size: 14px;
  padding: 24px 0;
}
.hint.error {
  color: #f56c6c;
}
.empty {
  text-align: center;
  padding: 48px 0;
  color: #909399;
  font-size: 14px;
}
.empty-icon {
  font-size: 36px;
  margin: 0 0 8px;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.project-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.project-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.card-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-tag {
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.stage-s1 {
  background: #ecf5ff;
  color: #409eff;
}
.stage-s2 {
  background: #fdf6ec;
  color: #e6a23c;
}
.stage-s3 {
  background: #f0f9eb;
  color: #67c23a;
}
.stage-s4 {
  background: #fef0f0;
  color: #f56c6c;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #909399;
}
</style>
