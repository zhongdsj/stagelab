<template>
  <section class="diagram-page">
    <!-- 左侧侧边导航栏：展开时显示完整图列表，折叠时仅保留窄条切换按钮 -->
    <aside class="diagram-sidebar" :class="{ collapsed }">
      <button class="sidebar-toggle" type="button" @click="collapsed = !collapsed">
        <span class="toggle-icon">≡</span>
        <span v-if="!collapsed" class="toggle-text">图列表</span>
      </button>

      <template v-if="!collapsed">
        <button class="back-btn" type="button" @click="goBack">← 返回项目</button>
        <div v-if="diagrams.length" class="diagram-tabs">
          <span
            v-for="d in diagrams"
            :key="d.diagramId"
            class="diagram-tab"
            :class="{ active: d.diagramId === props.diagramId }"
            @click="openDiagram(d.diagramId)"
          >
            <span class="tab-title">{{ d.title }}</span>
            <span class="diagram-type">{{ typeLabel(d.type) }}</span>
          </span>
        </div>
        <p v-else class="hint">暂无图</p>
      </template>
    </aside>

    <!-- 右侧内容区：渲染选中图，占满剩余宽度（复用 DiagramView，含画布拖拽/缩放与折叠交互） -->
    <main class="diagram-content">
      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="error" class="hint error">{{ error }}</div>
      <DiagramView
        v-else-if="activeDiagram"
        :project-id="props.id"
        :diagram-id="activeDiagram.diagramId"
        :title="`${typeLabel(activeDiagram.type)}：${activeDiagram.title}`"
      />
      <p v-else class="hint">未找到该图，请从左侧列表选择。</p>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import DiagramView from "../components/diagram/DiagramView.vue";
import { getProjectIndex, ApiError } from "../api/index";
import type { ProjectIndexResult } from "../api/projects";

const props = defineProps<{ id: string; diagramId: string }>();

const router = useRouter();

type DiagramItem = ProjectIndexResult["diagrams"][number];

const loading = ref(false);
const error = ref("");
const diagrams = ref<DiagramItem[]>([]);
/** 侧边导航栏折叠状态：false 展开（宽），true 折叠（窄条） */
const collapsed = ref(false);

/** 当前 URL 对应的图（列表中查找，不存在则为 undefined） */
const activeDiagram = computed(() =>
  diagrams.value.find((d) => d.diagramId === props.diagramId)
);

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
    const index: ProjectIndexResult = await getProjectIndex(props.id);
    diagrams.value = index.diagrams;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载图列表失败";
  } finally {
    loading.value = false;
  }
}

/** 点击侧边栏 tab：跳转路由，右侧 DiagramView 随 diagramId 变化重新加载 */
function openDiagram(diagramId: string) {
  if (diagramId === props.diagramId) return;
  router.push(`/projects/${props.id}/diagrams/${diagramId}`);
}

/** 返回项目详情页 */
function goBack() {
  router.push(`/projects/${props.id}`);
}

onMounted(load);
</script>

<style scoped>
.diagram-page {
  display: flex;
  gap: 16px;
  align-items: stretch;
  width: 100%;
  padding: 16px;
  box-sizing: border-box;
}
/* 侧边导航栏：展开宽 / 折叠窄（过渡宽度） */
.diagram-sidebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 240px;
  min-width: 240px;
  padding: 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  transition: width 0.2s ease, min-width 0.2s ease;
  overflow: hidden;
}
.diagram-sidebar.collapsed {
  width: 52px;
  min-width: 52px;
}
.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  white-space: nowrap;
}
.sidebar-toggle:hover {
  border-color: #409eff;
  color: #409eff;
}
.toggle-icon {
  font-size: 15px;
  line-height: 1;
}
.toggle-text {
  font-weight: 600;
}
.back-btn {
  align-self: flex-start;
  border: none;
  background: none;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  white-space: nowrap;
}
.back-btn:hover {
  color: #409eff;
}
.diagram-tabs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diagram-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  white-space: nowrap;
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
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
}
.diagram-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  opacity: 0.85;
  flex-shrink: 0;
}
/* 图内容占满剩余宽度 */
.diagram-content {
  flex: 1;
  min-width: 0;
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