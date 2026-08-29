<template>
  <div class="diagram-view">
    <!-- 折叠状态提示 + 展开控制 -->
    <div class="diagram-toolbar">
      <span class="diagram-title">{{ title }}</span>
      <button
        v-if="focusModuleId"
        class="btn-sm"
        type="button"
        @click="setFocus(null)"
      >
        展开全部
      </button>
    </div>

    <p v-if="loading" class="hint">布局计算中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>
    <DiagramSvg
      v-else-if="layout && diagram"
      :layout="layout"
      :diagram="diagram"
      :focus-module-id="focusModuleId ?? undefined"
      @focus="setFocus"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import DiagramSvg from "./DiagramSvg.vue";
import { getDiagram, getLayout, ApiError } from "../../api/index";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";

const props = defineProps<{
  projectId: string;
  diagramId: string;
  title?: string;
}>();

const loading = ref(false);
const error = ref("");
const diagram = ref<Diagram | null>(null);
const layout = ref<LayoutDiagram | null>(null);
/** 当前聚焦模块（会话态折叠，刷新恢复默认） */
const focusModuleId = ref<string | null>(null);

/** 加载语义模型 + 布局 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    diagram.value = await getDiagram(props.projectId, props.diagramId);
    layout.value = await getLayout(props.projectId, props.diagramId, focusModuleId.value ?? undefined);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载图失败";
  } finally {
    loading.value = false;
  }
}

/** 折叠/展开：更新聚焦模块并重算布局 */
async function setFocus(moduleId: string | null) {
  focusModuleId.value = moduleId;
  loading.value = true;
  error.value = "";
  try {
    layout.value = await getLayout(props.projectId, props.diagramId, moduleId ?? undefined);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "布局计算失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.diagramId, () => {
  focusModuleId.value = null;
  load();
});
</script>

<style scoped>
.diagram-view {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
}
.diagram-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.diagram-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.btn-sm:hover {
  border-color: #409eff;
  color: #409eff;
}
.hint {
  color: #909399;
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}
.hint.error {
  color: #f56c6c;
}
</style>
