<template>
  <div class="req-tasks">
    <div class="req-head">
      <span class="req-title">需求清单</span>
      <button class="btn btn-sm" type="button" @click="showCreateReq = !showCreateReq">
        {{ showCreateReq ? "收起" : "+ 新建需求" }}
      </button>
    </div>

    <!-- 创建需求表单 -->
    <form v-if="showCreateReq" class="inline-form" @submit.prevent="onCreateRequirement">
      <input v-model="reqForm.title" class="input" placeholder="需求标题（必填）" maxlength="80" />
      <input v-model="reqForm.branchName" class="input" placeholder="Git 分支名（可选）" maxlength="80" />
      <button class="btn btn-sm btn-primary" type="submit" :disabled="creatingReq">创建</button>
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
        <form v-if="editingReqId === req.requirementId" class="inline-form" @submit.prevent="onSaveReq">
          <input v-model="editReqForm.title" class="input" placeholder="需求标题（必填）" maxlength="80" />
          <input v-model="editReqForm.branchName" class="input" placeholder="Git 分支名（可选）" maxlength="80" />
          <button class="btn btn-sm btn-primary" type="submit" :disabled="savingReq">保存</button>
          <button class="btn btn-sm" type="button" @click="editingReqId = null">取消</button>
        </form>

        <!-- 任务分组列表 -->
        <div v-if="expanded.has(req.requirementId)" class="task-list">
          <div v-for="t in taskMap[req.requirementId] ?? []" :key="t.taskId" class="task-row">
            <!-- 任务编辑态 -->
            <template v-if="editingTaskId === t.taskId">
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
            </template>
            <!-- 任务展示态 -->
            <template v-else>
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
            </template>
          </div>

          <!-- 创建任务 -->
          <div v-if="showCreateTask === req.requirementId" class="inline-form task-form">
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
import type { TaskStatus } from "@fourstage/shared";

const props = defineProps<{ projectId: string }>();

const loading = ref(false);
const error = ref("");
const requirements = ref<RequirementItem[]>([]);
const expanded = ref<Set<string>>(new Set());
/** 需求 → 任务摘要映射 */
const taskMap = ref<Record<string, TaskSummary[]>>({});

const showCreateReq = ref(false);
const creatingReq = ref(false);
const reqForm = reactive({ title: "", branchName: "" });

// 修改需求状态
const editingReqId = ref<string | null>(null);
const savingReq = ref(false);
const editReqForm = reactive({ title: "", branchName: "" });

const showCreateTask = ref<string | null>(null);
const creatingTask = ref(false);
const taskForm = reactive({ title: "", changeType: "新增" as "新增" | "修改" | "删除" });

// 修改任务状态
const editingTaskId = ref<string | null>(null);
const savingTask = ref(false);
const editTaskForm = reactive({ title: "", changeType: "新增" as "新增" | "修改" | "删除" });

const STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  archived: "已归档"
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
    await createRequirement(props.projectId, title, { branchName: reqForm.branchName.trim() || undefined });
    reqForm.title = "";
    reqForm.branchName = "";
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
  showCreateTask.value = requirementId;
}

/** 打开修改需求表单 */
function openEditReq(req: RequirementItem) {
  editingReqId.value = req.requirementId;
  editReqForm.title = req.title;
  editReqForm.branchName = req.branchName ?? "";
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
      branchName: editReqForm.branchName.trim() || undefined
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
      description: "",
      acceptanceCriteria: "",
      files: []
    });
    taskForm.title = "";
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
      changeType: editTaskForm.changeType
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
.req-active {
  background: #ecf5ff;
  color: #409eff;
}
.req-done {
  background: #f0f9eb;
  color: #67c23a;
}
.req-archived {
  background: #f4f4f5;
  color: #909399;
}
.task-list {
  padding: 8px 12px 12px;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #f0f2f5;
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
</style>
