<template>
  <div class="diagram-library">
    <div class="lib-head">
      <span class="lib-title">图库</span>
      <span v-if="diagrams.length" class="lib-count">{{ diagrams.length }} 张图</span>
    </div>

    <!-- T24：图列表按类型分块展示（类图 / 架构图 / 流程图，点击跳转独立图查看页面） -->
    <template v-if="diagrams.length">
      <div v-for="group in groups" :key="group.key" class="diagram-block">
        <div class="block-head">
          <span class="block-title">{{ group.label }}</span>
          <span class="block-count">{{ group.items.length }} 张</span>
        </div>
        <div class="diagram-tabs">
          <span
            v-for="d in group.items"
            :key="d.diagramId"
            class="diagram-tab"
            @click="openDiagram(d.diagramId)"
          >
            {{ d.title }}
            <span class="diagram-type">{{ typeLabel(d.type) }}</span>
          </span>
        </div>
      </div>
    </template>
    <p v-else class="hint">暂无图，可通过 MCP 工具创建（create_diagram）。</p>

    <p v-if="error" class="hint error">{{ error }}</p>

    <!-- 引导文案：整图渲染在独立页面（左右结构） -->
    <p v-if="diagrams.length" class="hint entry-hint">
      点击上方图可进入独立查看页面（左侧图列表 + 右侧图渲染）。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getProjectIndex, ApiError } from "../../api/index";
import type { ProjectIndexResult } from "../../api/projects";

const props = defineProps<{ projectId: string }>();

const router = useRouter();

type DiagramItem = ProjectIndexResult["diagrams"][number];

const diagrams = ref<DiagramItem[]>([]);
const loading = ref(false);
const error = ref("");

/** 图类型分组顺序与中文标签 */
const typeGroups: Array<{ key: string; label: string }> = [
  { key: "class", label: "类图" },
  { key: "architecture", label: "架构图" },
  { key: "flow", label: "流程图" }
];

/** 按类型分块分组：仅保留有图的块，未知类型归入「其他」块 */
const groups = computed(() => {
  const known = typeGroups
    .map(({ key, label }) => ({
      key,
      label,
      items: diagrams.value.filter((d) => d.type === key)
    }))
    .filter((g) => g.items.length);
  const others = diagrams.value.filter(
    (d) => !typeGroups.some((t) => t.key === d.type)
  );
  if (others.length) {
    known.push({ key: "other", label: "其他", items: others });
  }
  return known;
});

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
/* 按类型分块的层级展示 */
.diagram-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #e4e7ed;
}
.diagram-block:last-of-type {
  border-bottom: none;
  padding-bottom: 0;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.block-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}
.block-count {
  font-size: 12px;
  color: #909399;
}
.diagram-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
