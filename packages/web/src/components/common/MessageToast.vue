<script setup lang="ts">
import { computed } from "vue";
import { message, messageState } from "../../utils/message";

/** 关闭当前提示（同时清掉自动关闭计时器） */
function close() {
  message.close();
}

/** 类型图标（纯文本，避免为三个图标引入额外依赖） */
const icon = computed(() => {
  if (messageState.type === "success") return "✓";
  if (messageState.type === "error") return "!";
  return "i";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="mt">
      <div v-if="messageState.visible" class="mt-wrap">
        <div
          class="mt-toast"
          :class="`mt-${messageState.type}`"
          :role="messageState.type === 'error' ? 'alert' : 'status'"
          :aria-live="messageState.type === 'error' ? 'assertive' : 'polite'"
        >
          <span class="mt-icon" aria-hidden="true">{{ icon }}</span>
          <span class="mt-text">{{ messageState.text }}</span>
          <button class="mt-close" type="button" title="关闭提示" @click="close">×</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mt-wrap {
  position: fixed;
  top: 24px;
  left: 0;
  right: 0;
  z-index: 3000;
  display: flex;
  justify-content: center;
  padding: 0 16px;
  pointer-events: none;
}
.mt-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
  max-width: 560px;
  padding: 11px 14px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08);
  pointer-events: auto;
}
.mt-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
}
.mt-success .mt-icon {
  background: #67c23a;
}
.mt-error .mt-icon {
  background: #f56c6c;
}
.mt-info .mt-icon {
  background: #409eff;
}
.mt-text {
  flex: 1;
  font-size: 14px;
  line-height: 1.5;
  color: #303133;
  word-break: break-word;
}
.mt-close {
  flex: 0 0 auto;
  padding: 0 2px;
  border: none;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: #c0c4cc;
  cursor: pointer;
}
.mt-close:hover {
  color: #909399;
}
/* 顶部下滑 + 淡入，关闭时反向收起 */
.mt-enter-active,
.mt-leave-active {
  transition: opacity 0.2s ease;
}
.mt-enter-active .mt-toast,
.mt-leave-active .mt-toast {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}
.mt-enter-from,
.mt-leave-to {
  opacity: 0;
}
.mt-enter-from .mt-toast,
.mt-leave-to .mt-toast {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .mt-enter-active,
  .mt-leave-active,
  .mt-enter-active .mt-toast,
  .mt-leave-active .mt-toast {
    transition: none;
  }
}
</style>
