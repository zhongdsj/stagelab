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

      <!-- 阶段内容区（T12：按当前阶段渲染文档/图表/需求任务） -->
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
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ index?.tasks.length ?? 0 }}</span>
            <span class="stat-label">任务</span>
          </div>
        </div>

        <!-- 阶段1：开发文档分片 + 架构图 -->
        <template v-if="project.currentStage === 's1'">
          <DocumentFragments
            v-if="stage1DocId"
            :project-id="props.id"
            :doc-id="stage1DocId"
            title="开发文档"
          />
          <DiagramView
            v-if="archDiagram"
            :project-id="props.id"
            :diagram-id="archDiagram.diagramId"
            :title="`架构图：${archDiagram.title}`"
          />
          <p v-if="!stage1DocId && !archDiagram" class="placeholder-hint">
            尚无开发文档或架构图，可通过 MCP 工具创建（create_document / create_diagram）。
          </p>
        </template>

        <!-- 阶段2/3：需求清单（按需求分组任务 + 状态追踪）+ 类图/流程图 -->
        <template v-else-if="project.currentStage === 's2' || project.currentStage === 's3'">
          <RequirementTasks :project-id="props.id" />
          <DiagramView
            v-if="classFlowDiagram"
            :project-id="props.id"
            :diagram-id="classFlowDiagram.diagramId"
            :title="`${diagramTypeLabel(classFlowDiagram.type)}：${classFlowDiagram.title}`"
          />
        </template>

        <!-- 阶段4：Bug 记录（暂定占位） -->
        <template v-else>
          <p class="placeholder-hint">阶段「Bug修复」的记录视图将在后续迭代实现。</p>
        </template>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import StageNav from "../components/StageNav.vue";
import DocumentFragments from "../components/document/DocumentFragments.vue";
import DiagramView from "../components/diagram/DiagramView.vue";
import RequirementTasks from "../components/requirement/RequirementTasks.vue";
import { getProject, getProjectIndex, switchStage, ApiError } from "../api/index";
import type { Project, Stage } from "@fourstage/shared";
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

const stageLabel = (s: Stage) => STAGE_LABELS[s];
const stageDesc = (s: Stage) => STAGE_DESCS[s];
const formatTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", { hour12: false });

/** 阶段1开发文档（索引首条文档） */
const stage1DocId = computed(() => index.value?.documents[0]?.docId ?? "");
/** 架构图（阶段1展示） */
const archDiagram = computed(() =>
  index.value?.diagrams.find((d) => d.type === "architecture")
);
/** 类图/流程图（阶段2/3 展示，优先流程图） */
const classFlowDiagram = computed(() =>
  index.value?.diagrams.find((d) => d.type === "flow") ??
  index.value?.diagrams.find((d) => d.type === "class")
);

/** 图类型中文标签 */
function diagramTypeLabel(type: string): string {
  const map: Record<string, string> = {
    architecture: "架构图",
    class: "类图",
    flow: "流程图"
  };
  return map[type] ?? type;
}

/** 加载项目详情与索引 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await getProject(props.id);
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
.placeholder-hint {
  margin: 0;
  font-size: 13px;
  color: #c0c4cc;
  text-align: center;
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
