<template>
  <section class="project-detail-page">
    <!-- 加载/错误 -->
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>

    <template v-else-if="project">
      <!-- 头部：项目名 -->
      <div class="detail-head">
        <div>
          <button class="back-link" type="button" @click="goBack">← 返回总览</button>
          <h2 class="page-title">{{ project.projectName }}</h2>
        </div>
        <span class="meta-line">
          ID: {{ project.projectId.slice(0, 8) }} · 创建于 {{ formatTime(project.createdAt) }}
        </span>
      </div>

      <!-- 四阶段流程导航 -->
      <StageNav
        :current-stage="project.currentStage"
        :switching="switching"
        @switch="onSwitchStage"
      />

      <!-- 阶段内容区（T52：阶段切换仅改描述文案，内容区固定为 Tab 切换） -->
      <div class="stage-content">
        <h3 class="content-title">{{ stageLabel(project.currentStage) }}</h3>
        <p class="content-desc">{{ stageDesc(project.currentStage) }}</p>

        <div class="stat-grid">
          <div class="stat-item">
            <span class="stat-num">{{ index?.documents.length ?? 0 }}</span>
            <span class="stat-label">文档</span>
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ index?.diagrams.length ?? 0 }}</span>
            <span class="stat-label">图</span>
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ index?.requirements.length ?? 0 }}</span>
            <span class="stat-label">需求</span>
            <!-- T53：需求按状态细分（开发/测试/完成） -->
            <span class="stat-sub">{{ reqStatusSummary }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ index?.tasks.length ?? 0 }}</span>
            <span class="stat-label">任务</span>
            <!-- T53：任务按状态细分（待处理/进行中/已完成） -->
            <span class="stat-sub">{{ taskStatusSummary }}</span>
          </div>
        </div>

        <!-- 内容区 Tab：文档库 / 需求 / 图库（T52） -->
        <div class="content-tabs">
          <button
            v-for="t in CONTENT_TABS"
            :key="t.key"
            type="button"
            class="content-tab"
            :class="{ active: activeTab === t.key }"
            @click="onTabChange(t.key)"
          >
            {{ t.label }}
          </button>
        </div>

        <DocumentLibrary v-if="activeTab === 'doc'" :project-id="props.id" />
        <RequirementTasks v-else-if="activeTab === 'req'" :project-id="props.id" />
        <DiagramLibrary v-else :project-id="props.id" />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import StageNav from "../components/StageNav.vue";
import DocumentLibrary from "../components/document/DocumentLibrary.vue";
import DiagramLibrary from "../components/diagram/DiagramLibrary.vue";
import RequirementTasks from "../components/requirement/RequirementTasks.vue";
import { getProject, getProjectIndex, switchStage, ApiError } from "../api/index";
import type { Project, Stage } from "@stagelab/shared";
import type { ProjectIndexResult } from "../api/projects";

const props = defineProps<{ id: string }>();

const router = useRouter();

const loading = ref(false);
const error = ref("");
const switching = ref(false);
const project = ref<Project | null>(null);
const index = ref<ProjectIndexResult | null>(null);

const STAGE_LABELS: Record<Stage, string> = {
  s1: "需求讨论",
  s2: "任务生成",
  s3: "编码实现",
  s4: "Bug修复"
};

const STAGE_DESCS: Record<Stage, string> = {
  s1: "以方案设计为主：输出开发文档、绘制业务图，约定技术选型与风险点。",
  s2: "拆解可落地任务清单：每项任务包含文件范围、变更类型与验收标准。",
  s3: "依据任务文档编码实现，对齐项目风格，完成后记录变更。",
  s4: "定位 Bug 根因、输出修复方案，并进行回归校验。"
};

/* ========== 内容区 Tab（T52）：阶段切换仅改描述文案，内容区固定 Tab 切换 ========== */
type ContentTabKey = "doc" | "req" | "diagram";

const CONTENT_TABS: Array<{ key: ContentTabKey; label: string }> = [
  { key: "doc", label: "文档库" },
  { key: "req", label: "需求" },
  { key: "diagram", label: "图库" }
];

/** 当前激活 Tab（会话态；阶段切换不影响已选 Tab） */
const activeTab = ref<ContentTabKey>("doc");

/** 用户主动切换 Tab 标记（一旦手动切换，后续阶段变化不再强改默认 Tab） */
let tabTouched = false;

/** 切换 Tab（记录用户主动操作） */
function onTabChange(key: ContentTabKey) {
  tabTouched = true;
  activeTab.value = key;
}

/** 默认 Tab 与当前阶段弱关联：s1 文档库 / s2、s3 需求 / s4 文档库 */
const defaultTabOf = (s: Stage): ContentTabKey =>
  s === "s2" || s === "s3" ? "req" : "doc";

/** 阶段切换后对齐默认 Tab（仅当用户尚未主动切换过） */
function pickDefaultTabFor(stage: Stage) {
  if (!tabTouched) activeTab.value = defaultTabOf(stage);
}

const stageLabel = (s: Stage) => STAGE_LABELS[s];
const stageDesc = (s: Stage) => STAGE_DESCS[s];
const formatTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", { hour12: false });

/* ========== 统计按状态细分（T53）：需求/任务各状态数量，展示于现有 stat-item ========== */

const REQ_STATUS_LABELS: Record<string, string> = {
  dev: "开发",
  test: "测试",
  done: "完成"
};
const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  done: "已完成"
};

/** 需求按状态计数摘要：开发 x · 测试 y · 完成 z */
const reqStatusSummary = computed(() => {
  const counts: Record<string, number> = { dev: 0, test: 0, done: 0 };
  for (const r of index.value?.requirements ?? []) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return ["dev", "test", "done"]
    .map((s) => `${REQ_STATUS_LABELS[s]} ${counts[s] ?? 0}`)
    .join(" · ");
});

/** 任务按状态计数摘要：待处理 x · 进行中 y · 已完成 z */
const taskStatusSummary = computed(() => {
  const counts: Record<string, number> = { pending: 0, in_progress: 0, done: 0 };
  for (const t of index.value?.tasks ?? []) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  return ["pending", "in_progress", "done"]
    .map((s) => `${TASK_STATUS_LABELS[s]} ${counts[s] ?? 0}`)
    .join(" · ");
});

/** 加载项目详情与索引 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await getProject(props.id);
    // 初始对齐默认 Tab（s1 文档库 / s2、s3 需求）
    pickDefaultTabFor(project.value.currentStage);
    try {
      index.value = await getProjectIndex(props.id);
    } catch {
      index.value = null; // 索引可能尚未生成，不影响详情展示
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载项目详情失败";
  } finally {
    loading.value = false;
  }
}

/** 切换项目阶段 */
async function onSwitchStage(stage: Stage) {
  if (!project.value || stage === project.value.currentStage) return;
  switching.value = true;
  error.value = "";
  try {
    project.value = await switchStage(props.id, stage);
    // T52：阶段切换仅更新描述文案；未手动切 Tab 时对齐默认 Tab
    pickDefaultTabFor(project.value.currentStage);
    // 阶段切换后刷新索引（实体集合可能变化）
    try {
      index.value = await getProjectIndex(props.id);
    } catch {
      /* 忽略索引刷新失败 */
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "阶段切换失败";
  } finally {
    switching.value = false;
  }
}

function goBack() {
  router.push("/");
}

onMounted(load);
watch(() => props.id, load);
</script>

<style scoped>
.project-detail-page {
  max-width: 1080px;
  margin: 0 auto;
}
.detail-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}
.back-link {
  border: none;
  background: none;
  color: #909399;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 6px;
}
.back-link:hover {
  color: #409eff;
}
.page-title {
  margin: 0;
  font-size: 22px;
  color: #303133;
}
.meta-line {
  font-size: 12px;
  color: #909399;
}
.stage-content {
  margin-top: 20px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 20px;
}
.content-title {
  margin: 0 0 6px;
  font-size: 16px;
  color: #303133;
}
.content-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: #909399;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px;
  background: #f5f7fa;
  border-radius: 8px;
}
.stat-num {
  font-size: 22px;
  font-weight: 700;
  color: #409eff;
}
.stat-label {
  font-size: 13px;
  color: #909399;
}
/* T53：统计项状态细分 */
.stat-sub {
  font-size: 11px;
  color: #b0b3b8;
  text-align: center;
  line-height: 1.4;
}
/* T52：内容区 Tab 切换 */
.content-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 12px;
}
.content-tab {
  padding: 6px 18px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.content-tab:hover {
  border-color: #409eff;
  color: #409eff;
}
.content-tab.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.hint {
  color: #909399;
  font-size: 14px;
  padding: 24px 0;
}
.hint.error {
  color: #f56c6c;
}
</style>
