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
            <span class="tab-main">
              <span class="tab-title">{{ d.title }}</span>
              <span class="diagram-type">{{ typeLabel(d.type) }}</span>
            </span>
            <!-- T8：展示 diagramId（等宽），点击复制，便于与 AI 给的 id 对应 -->
            <button
              class="diagram-id"
              type="button"
              :title="`图 ID：${d.diagramId}（点击复制）`"
              @click.stop="copyId(d.diagramId)"
            >
              {{ d.diagramId }}
            </button>
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

    <!-- 悬浮操作：刷新 + 回到顶部（右下角常驻） -->
    <div class="float-actions">
      <button class="float-btn" type="button" title="刷新图库" @click="onRefresh">⟳</button>
      <button class="float-btn" type="button" title="回到顶部" @click="scrollTop">↑</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getProjectIndex, ApiError } from "../../api/index";
import type { ProjectIndexResult } from "../../api/projects";
import { copyText } from "../../utils/clipboard";
import { message } from "../../utils/message";

const props = defineProps<{ projectId: string }>();

/** 刷新完成后通知父级重拉项目索引（同步顶部统计） */
const emit = defineEmits<{
  (e: "refresh"): void;
}>();

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

/** T8：复制图 ID 到剪贴板（反馈统一走顶部居中轻提示） */
async function copyId(id: string) {
  const ok = await copyText(id);
  if (ok) message.success("图 ID 已复制");
  else message.error("复制失败，请手动选择");
}

/** T24：点击图跳转独立图查看页面（/projects/:id/diagrams/:diagramId） */
function openDiagram(diagramId: string) {
  router.push(`/projects/${props.projectId}/diagrams/${diagramId}`);
}

/** 回到顶部（页面/视口滚动） */
function scrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** 刷新：重拉图列表后通知父级同步顶部统计 */
async function onRefresh() {
  await load();
  emit("refresh");
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
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 150px;
  max-width: 260px;
  padding: 5px 12px;
  font-size: 13px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.tab-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* T8：图 ID 行（等宽、弱化，点击复制） */
.diagram-id {
  padding: 0;
  border: none;
  background: none;
  font-family: monospace;
  font-size: 11px;
  color: #909399;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diagram-id:hover {
  color: #409eff;
  text-decoration: underline;
}
.diagram-tab.active .diagram-id {
  color: rgba(255, 255, 255, 0.85);
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
/* 悬浮操作：刷新 + 回到顶部（右下角常驻） */
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
