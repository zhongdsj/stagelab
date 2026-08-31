<template>
  <div class="diagram-library">
    <div class="lib-head">
      <span class="lib-title">图库</span>
      <span v-if="diagrams.length" class="lib-count">{{ diagrams.length }} 张图</span>
    </div>

    <!-- T24：图 tab 列表（点击跳转独立图查看页面，详情页不再内嵌渲染整图） -->
    <div v-if="diagrams.length" class="diagram-tabs">
      <span
        v-for="d in diagrams"
        :key="d.diagramId"
        class="diagram-tab"
        @click="openDiagram(d.diagramId)"
      >
        {{ d.title }}
        <span class="diagram-type">{{ typeLabel(d.type) }}</span>
      </span>
    </div>
    <p v-else class="hint">暂无图，可通过 MCP 工具创建（create_diagram）。</p>

    <p v-if="error" class="hint error">{{ error }}</p>

    <!-- 引导文案：整图渲染在独立页面（左右结构） -->
    <p v-if="diagrams.length" class="hint entry-hint">
      点击上方图可进入独立查看页面（左侧图列表 + 右侧图渲染）。
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getProjectIndex, ApiError } from "../../api/index";
import type { ProjectIndexResult } from "../../api/projects";

const props = defineProps<{ projectId: string }>();

const router = useRouter();

type DiagramItem = ProjectIndexResult["diagrams"][number];

const diagrams = ref<DiagramItem[]>([]);
const loading = ref(false);
const error = ref("");

/** 图类型中文标签 */
function typeLabel(type: string): string {
  const map: Record<string, string> = {
    architecture: "架构图",
    class: "类图",
    flow: "流程图"
  };
  return map[type] ?? type;
}

/** 加载项目图列表（来自项目索引） */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const index: ProjectIndexResult = await getProjectIndex(props.projectId);
    diagrams.value = index.diagrams;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载图列表失败";
  } finally {
    loading.value = false;
  }
}

/** T24：点击图跳转独立图查看页面（/projects/:id/diagrams/:diagramId） */
function openDiagram(diagramId: string) {
  router.push(`/projects/${props.projectId}/diagrams/${diagramId}`);
}

onMounted(load);
watch(() => props.projectId, load);
</script>

<style scoped>
.diagram-library {
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
.lib-count {
  font-size: 12px;
  color: #909399;
}
.diagram-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 10px;
}
.diagram-tab {
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
.diagram-tab:hover {
  border-color: #409eff;
  color: #409eff;
}
.diagram-tab.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.diagram-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  opacity: 0.85;
}
.hint {
  color: #909399;
  font-size: 13px;
}
.hint.error {
  color: #f56c6c;
}
</style>
