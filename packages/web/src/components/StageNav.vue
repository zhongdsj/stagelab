<template>
  <div class="stage-nav" role="tablist" aria-label="四阶段流程导航">
    <template v-for="(s, idx) in stages" :key="s.value">
      <!-- 阶段间连线 -->
      <div v-if="idx > 0" class="stage-connector" :class="{ done: stageIndex() > idx - 1 }" />
      <!-- 阶段节点 -->
      <button
        class="stage-node"
        :class="{
          active: s.value === currentStage,
          done: stageIndex() > idx,
          locked: stageIndex() < idx
        }"
        :disabled="switching"
        type="button"
        @click="onSwitch(s.value)"
      >
        <span class="stage-badge">{{ s.value.toUpperCase() }}</span>
        <span class="stage-name">{{ s.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Stage } from "@stagelab/shared";

/** 四阶段定义（与开发文档/任务文档一致） */
const stages: Array<{ value: Stage; label: string }> = [
  { value: "s1", label: "需求讨论" },
  { value: "s2", label: "任务生成" },
  { value: "s3", label: "编码实现" },
  { value: "s4", label: "Bug修复" }
];

const props = defineProps<{
  /** 当前阶段 */
  currentStage: Stage;
  /** 切换请求进行中（禁用点击） */
  switching?: boolean;
}>();

const emit = defineEmits<{
  (e: "switch", stage: Stage): void;
}>();

/** 当前阶段在数组中的下标（用于点亮已完成连线） */
const stageIndex = (): number =>
  stages.findIndex((s) => s.value === props.currentStage);

/** 点击阶段发起切换（目标非当前阶段才触发） */
function onSwitch(stage: Stage) {
  if (stage === props.currentStage) return;
  emit("switch", stage);
}
</script>

<style scoped>
.stage-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}
.stage-connector {
  flex: 1;
  min-width: 24px;
  height: 2px;
  background: #e4e7ed;
}
.stage-connector.done {
  background: #67c23a;
}
.stage-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}
.stage-node:hover:not(:disabled) {
  border-color: #409eff;
}
.stage-node:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.stage-badge {
  font-size: 11px;
  font-weight: 700;
  color: #909399;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f5f7fa;
}
.stage-name {
  font-size: 14px;
  color: #606266;
}
.stage-node.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.stage-node.active .stage-badge {
  background: #409eff;
  color: #fff;
}
.stage-node.active .stage-name {
  color: #409eff;
  font-weight: 600;
}
.stage-node.done {
  border-color: #67c23a;
}
.stage-node.done .stage-badge {
  background: #67c23a;
  color: #fff;
}
.stage-node.done .stage-name {
  color: #67c23a;
}
.stage-node.locked .stage-badge {
  background: #f5f7fa;
  color: #c0c4cc;
}
.stage-node.locked .stage-name {
  color: #c0c4cc;
}
</style>
