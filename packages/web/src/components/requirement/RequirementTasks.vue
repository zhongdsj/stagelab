<template>
  <div class="req-tasks">
    <div class="req-head">
      <span class="req-title">需求清单</span>
      <button class="btn btn-sm" type="button" @click="showCreateReq = !showCreateReq">
        {{ showCreateReq ? "收起" : "+ 新建需求" }}
      </button>
    </div>

    <!-- 创建需求表单 -->
    <form v-if="showCreateReq" class="inline-form col" @submit.prevent="onCreateRequirement">
      <div class="form-row">
        <input v-model="reqForm.title" class="input" placeholder="需求标题（必填）" maxlength="80" />
        <input v-model="reqForm.branchName" class="input" placeholder="Git 分支名（可选）" maxlength="80" />
        <button class="btn btn-sm btn-primary" type="submit" :disabled="creatingReq">创建</button>
      </div>
      <textarea
        v-model="reqForm.description"
        class="input ta"
        rows="3"
        placeholder="需求描述（markdown，可选）"
      ></textarea>
    </form>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>
    <p v-else-if="requirements.length === 0" class="hint">暂无需求，点击「新建需求」添加</p>

    <!-- 需求卡片（按需求分组展示任务） -->
    <div v-else class="req-list">
      <div v-for="req in requirements" :key="req.requirementId" class="req-card">
        <div class="req-row" @click="toggle(req.requirementId)">
          <span class="req-arrow">{{ expanded.has(req.requirementId) ? "▼" : "▶" }}</span>
          <span class="req-name">{{ req.title }}</span>
          <span v-if="req.branchName" class="req-branch">@{{ req.branchName }}</span>
          <span class="req-count">{{ req.taskCount }} 任务</span>
          <span class="req-status" :class="`req-${req.status}`">{{ statusLabel(req.status) }}</span>
          <!-- 每个需求两个操作按钮：修改 / 删除 -->
          <span class="req-actions" @click.stop>
            <button class="btn btn-sm" type="button" @click="openEditReq(req)">修改</button>
            <button class="btn btn-sm btn-danger" type="button" @click="onDeleteReq(req)">删除</button>
          </span>
        </div>

        <!-- 修改需求表单 -->
        <form v-if="editingReqId === req.requirementId" class="inline-form col" @submit.prevent="onSaveReq">
          <div class="form-row">
            <input v-model="editReqForm.title" class="input" placeholder="需求标题（必填）" maxlength="80" />
            <input v-model="editReqForm.branchName" class="input" placeholder="Git 分支名（可选）" maxlength="80" />
            <!-- T34：需求状态三态（开发/测试/完成），前端可修改 -->
            <select v-model="editReqForm.status" class="input select">
              <option value="dev">开发</option>
              <option value="test">测试</option>
              <option value="done">完成</option>
            </select>
            <button class="btn btn-sm btn-primary" type="submit" :disabled="savingReq">保存</button>
            <button class="btn btn-sm" type="button" @click="editingReqId = null">取消</button>
          </div>
          <textarea
            v-model="editReqForm.description"
            class="input ta"
            rows="3"
            placeholder="需求描述（markdown，可选）"
          ></textarea>
        </form>

        <!-- 需求描述（md 渲染） -->
        <div v-if="req.description && !editingReqId && expanded.has(req.requirementId)" class="md-body req-desc" v-html="renderMd(req.description)"></div>

        <!-- 任务分组列表 -->
        <div v-if="expanded.has(req.requirementId)" class="task-list">
          <div v-for="t in taskMap[req.requirementId] ?? []" :key="t.taskId" class="task-item">
            <!-- 任务编辑态 -->
            <div v-if="editingTaskId === t.taskId" class="task-row col">
              <div class="form-row">
                <input v-model="editTaskForm.title" class="input" placeholder="任务标题（必填）" maxlength="80" />
                <select v-model="editTaskForm.changeType" class="input select">
                  <option value="新增">新增</option>
                  <option value="修改">修改</option>
                  <option value="删除">删除</option>
                </select>
                <button class="btn btn-sm btn-primary" type="button" :disabled="savingTask" @click="onSaveTask(req.requirementId, t.taskId)">
                  保存
                </button>
                <button class="btn btn-sm" type="button" @click="editingTaskId = null">取消</button>
              </div>
              <textarea
                v-model="editTaskForm.description"
                class="input ta"
                rows="3"
                placeholder="任务描述（markdown，可选）"
              ></textarea>
            </div>
            <!-- 任务展示态 -->
            <div v-else class="task-row">
              <span class="task-name">{{ t.title }}</span>
              <select
                class="task-status"
                :value="t.status"
                @change="onStatusChange(req.requirementId, t.taskId, ($event.target as HTMLSelectElement).value as TaskStatus)"
              >
                <option value="pending">待处理</option>
                <option value="in_progress">进行中</option>
                <option value="done">已完成</option>
              </select>
              <!-- 每个任务两个操作按钮：修改 / 删除 -->
              <span class="task-actions" @click.stop>
                <button class="btn btn-sm" type="button" @click="openEditTask(t)">修改</button>
                <button class="btn btn-sm btn-danger" type="button" @click="onDeleteTask(req.requirementId, t)">删除</button>
              </span>
            </div>
            <!-- 任务描述（md 渲染） -->
            <div v-if="t.description && editingTaskId !== t.taskId" class="md-body task-desc" v-html="renderMd(t.description)"></div>
          </div>

          <!-- 创建任务 -->
          <div v-if="showCreateTask === req.requirementId" class="inline-form col task-form">
            <div class="form-row">
              <input v-model="taskForm.title" class="input" placeholder="任务标题（必填）" maxlength="80" />
              <select v-model="taskForm.changeType" class="input select">
                <option value="新增">新增</option>
                <option value="修改">修改</option>
                <option value="删除">删除</option>
              </select>
              <button class="btn btn-sm btn-primary" type="button" :disabled="creatingTask" @click="onCreateTask(req.requirementId)">
                添加
              </button>
            </div>
            <textarea
              v-model="taskForm.description"
              class="input ta"
              rows="3"
              placeholder="任务描述（markdown，可选）"
            ></textarea>
          </div>
          <button v-else class="btn btn-sm add-task" type="button" @click="openCreateTask(req.requirementId)">
            + 添加任务
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  listRequirements,
  createRequirement,
  listTasks,
  createTask,
  updateTaskStatus,
  updateRequirement,
  deleteRequirement,
  updateTask,
  deleteTask,
  ApiError
} from "../../api/index";
import type { RequirementItem, TaskSummary } from "../../api/requirements";
import type { RequirementStatus, TaskStatus } from "@fourstage/shared";

const props = defineProps<{ projectId: string }>();

/** Markdown 渲染（marked 解析 + DOMPurify 消毒防 XSS） */
function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}

const loading = ref(false);
const error = ref("");
const requirements = ref<RequirementItem[]>([]);
const expanded = ref<Set<string>>(new Set());
/** 需求 → 任务摘要映射 */
const taskMap = ref<Record<string, TaskSummary[]>>({});

const showCreateReq = ref(false);
const creatingReq = ref(false);
const reqForm = reactive({ title: "", branchName: "", description: "" });

// 修改需求状态
const editingReqId = ref<string | null>(null);
const savingReq = ref(false);
const editReqForm = reactive({ title: "", branchName: "", description: "", status: "dev" as RequirementStatus });

const showCreateTask = ref<string | null>(null);
const creatingTask = ref(false);
const taskForm = reactive({ title: "", changeType: "新增" as "新增" | "修改" | "删除", description: "" });

// 修改任务状态
const editingTaskId = ref<string | null>(null);
const savingTask = ref(false);
const editTaskForm = reactive({ title: "", changeType: "新增" as "新增" | "修改" | "删除", description: "" });

// T34：需求状态三态（开发/测试/完成）
const STATUS_LABELS: Record<string, string> = {
  dev: "开发",
  test: "测试",
  done: "完成"
};
const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

/** 加载需求列表 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    requirements.value = await listRequirements(props.projectId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载需求失败";
  } finally {
    loading.value = false;
  }
}

/** 展开/收起需求并懒加载任务 */
async function toggle(requirementId: string) {
  if (expanded.value.has(requirementId)) {
    expanded.value.delete(requirementId);
    return;
  }
  expanded.value.add(requirementId);
  try {
    taskMap.value[requirementId] = await listTasks(props.projectId, requirementId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载任务失败";
  }
}

async function onCreateRequirement() {
  const title = reqForm.title.trim();
  if (!title) {
    error.value = "请填写需求标题";
    return;
  }
  creatingReq.value = true;
  error.value = "";
  try {
    await createRequirement(props.projectId, title, {
      description: reqForm.description.trim() || undefined,
      branchName: reqForm.branchName.trim() || undefined
    });
    reqForm.title = "";
    reqForm.branchName = "";
    reqForm.description = "";
    showCreateReq.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "创建需求失败";
  } finally {
    creatingReq.value = false;
  }
}

function openCreateTask(requirementId: string) {
  taskForm.title = "";
  taskForm.description = "";
  showCreateTask.value = requirementId;
}

/** 打开修改需求表单 */
function openEditReq(req: RequirementItem) {
  editingReqId.value = req.requirementId;
  editReqForm.title = req.title;
  editReqForm.branchName = req.branchName ?? "";
  editReqForm.description = req.description ?? "";
  editReqForm.status = req.status;
}

/** 保存需求修改 */
async function onSaveReq() {
  const rid = editingReqId.value;
  if (!rid) return;
  const title = editReqForm.title.trim();
  if (!title) {
    error.value = "请填写需求标题";
    return;
  }
  savingReq.value = true;
  error.value = "";
  try {
    await updateRequirement(props.projectId, rid, {
      title,
      description: editReqForm.description.trim() || undefined,
      branchName: editReqForm.branchName.trim() || undefined,
      status: editReqForm.status
    });
    editingReqId.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "修改需求失败";
  } finally {
    savingReq.value = false;
  }
}

/** 删除需求（级联删除其下任务，需用户确认） */
async function onDeleteReq(req: RequirementItem) {
  const ok = window.confirm(
    `确定删除需求「${req.title}」吗？该需求下的 ${req.taskCount} 个任务将一并删除，不可恢复。`
  );
  if (!ok) return;
  try {
    await deleteRequirement(props.projectId, req.requirementId);
    expanded.value.delete(req.requirementId);
    delete taskMap.value[req.requirementId];
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "删除需求失败";
  }
}

async function onCreateTask(requirementId: string) {
  const title = taskForm.title.trim();
  if (!title) {
    error.value = "请填写任务标题";
    return;
  }
  creatingTask.value = true;
  error.value = "";
  try {
    await createTask(props.projectId, requirementId, {
      title,
      changeType: taskForm.changeType,
      description: taskForm.description.trim() || "",
      acceptanceCriteria: "",
      files: []
    });
    taskForm.title = "";
    taskForm.description = "";
    showCreateTask.value = null;
    taskMap.value[requirementId] = await listTasks(props.projectId, requirementId);
    await load(); // 刷新需求任务计数
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "创建任务失败";
  } finally {
    creatingTask.value = false;
  }
}

/** 更新任务状态 */
async function onStatusChange(requirementId: string, taskId: string, status: TaskStatus) {
  error.value = "";
  try {
    await updateTaskStatus(props.projectId, taskId, status);
    taskMap.value[requirementId] = await listTasks(props.projectId, requirementId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "更新状态失败";
  }
}

/** 打开修改任务表单 */
function openEditTask(t: TaskSummary) {
  editingTaskId.value = t.taskId;
  editTaskForm.title = t.title;
  editTaskForm.changeType = t.changeType;
  editTaskForm.description = t.description ?? "";
}

/** 保存任务修改 */
async function onSaveTask(requirementId: string, taskId: string) {
  const title = editTaskForm.title.trim();
  if (!title) {
    error.value = "请填写任务标题";
    return;
  }
  savingTask.value = true;
  error.value = "";
  try {
    await updateTask(props.projectId, taskId, {
      title,
      changeType: editTaskForm.changeType,
      description: editTaskForm.description.trim() || ""
    });
    editingTaskId.value = null;
    taskMap.value[requirementId] = await listTasks(props.projectId, requirementId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "修改任务失败";
  } finally {
    savingTask.value = false;
  }
}

/** 删除任务（需用户确认） */
async function onDeleteTask(requirementId: string, t: TaskSummary) {
  const ok = window.confirm(`确定删除任务「${t.title}」吗？该操作不可恢复。`);
  if (!ok) return;
  try {
    await deleteTask(props.projectId, t.taskId);
    taskMap.value[requirementId] = await listTasks(props.projectId, requirementId);
    await load(); // 刷新需求任务计数
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "删除任务失败";
  }
}

onMounted(load);
</script>

<style scoped>
.req-tasks {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
}
.req-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.req-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
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
.input {
  flex: 1;
  min-width: 120px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
}
.input:focus {
  border-color: #409eff;
}
.ta {
  width: 100%;
  resize: vertical;
  line-height: 1.6;
  font-family: inherit;
}
.select {
  flex: 0 0 auto;
  width: auto;
}
.inline-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.inline-form.col {
  flex-direction: column;
  align-items: stretch;
}
.form-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.req-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.req-card {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}
.req-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fafbfc;
  cursor: pointer;
}
.req-row:hover {
  background: #f0f5ff;
}
.req-arrow {
  font-size: 10px;
  color: #909399;
}
.req-name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.req-branch {
  font-size: 11px;
  color: #7c6ad8;
  background: #f5f0ff;
  padding: 2px 6px;
  border-radius: 4px;
}
.req-count {
  font-size: 12px;
  color: #909399;
}
.req-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}
/* 需求操作按钮区 */
.req-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.req-dev {
  background: #ecf5ff;
  color: #409eff;
}
.req-test {
  background: #fdf6ec;
  color: #e6a23c;
}
.req-done {
  background: #f0f9eb;
  color: #67c23a;
}
.task-list {
  padding: 8px 12px 12px;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-item {
  border: 1px solid #f0f2f5;
  border-radius: 6px;
  background: #fff;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
}
.task-row.col {
  flex-direction: column;
  align-items: stretch;
}
.task-name {
  flex: 1;
  font-size: 13px;
  color: #303133;
}
/* 任务操作按钮区 */
.task-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.task-status {
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.task-form {
  margin: 4px 0 0;
}
.add-task {
  align-self: flex-start;
  margin-top: 4px;
}
.hint {
  color: #909399;
  font-size: 13px;
  padding: 16px 0;
}
.hint.error {
  color: #f56c6c;
}
/* 需求/任务描述 md 渲染 */
.req-desc {
  padding: 8px 12px;
  border-bottom: 1px solid #ebeef5;
}
.task-desc {
  padding: 0 8px 8px;
}
.md-body {
  font-size: 13px;
  line-height: 1.7;
  color: #606266;
  word-break: break-word;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.4;
}
.md-body :deep(h1) {
  font-size: 18px;
}
.md-body :deep(h2) {
  font-size: 16px;
}
.md-body :deep(h3) {
  font-size: 15px;
}
.md-body :deep(h4) {
  font-size: 14px;
}
.md-body :deep(p) {
  margin: 0.5em 0;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.md-body :deep(li) {
  margin: 0.2em 0;
}
.md-body :deep(strong) {
  font-weight: 600;
}
.md-body :deep(a) {
  color: #409eff;
  text-decoration: none;
}
.md-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0.8em;
  border-left: 4px solid #dcdfe6;
  color: #909399;
  background: #f8f9fa;
}
.md-body :deep(code) {
  padding: 0.15em 0.4em;
  font-size: 12px;
  font-family: Consolas, Monaco, monospace;
  background: #f0f2f5;
  border-radius: 4px;
  color: #c7254e;
}
.md-body :deep(pre) {
  margin: 0.6em 0;
  padding: 10px 12px;
  background: #282c34;
  border-radius: 6px;
  overflow: auto;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #abb2bf;
}
.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 12px;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 4px 8px;
  text-align: left;
}
.md-body :deep(th) {
  background: #f5f7fa;
  font-weight: 600;
}
.md-body :deep(hr) {
  border: none;
  border-top: 1px solid #e4e7ed;
  margin: 0.8em 0;
}
.md-body :deep(img) {
  max-width: 100%;
}
</style>
