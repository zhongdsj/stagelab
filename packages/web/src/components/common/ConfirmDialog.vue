<script lang="ts">
import { reactive } from "vue";

/** 确认弹窗入参 */
export interface ConfirmOptions {
  /** 标题（可选，不传则只显示正文） */
  title?: string;
  /** 正文（必填） */
  message: string;
  /** 确认按钮文案（默认「确定」） */
  confirmText?: string;
  /** 取消按钮文案（默认「取消」） */
  cancelText?: string;
  /** 危险操作：确认按钮使用警示色（默认 false） */
  danger?: boolean;
}

/** 弹窗单例状态（模块级：全站共用一次渲染，见 App.vue） */
export const confirmState = reactive({
  visible: false,
  title: "",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  danger: false
});

/** 当前弹窗的 Promise 结算函数（同一时刻仅允许一个弹窗） */
let resolver: ((ok: boolean) => void) | null = null;

/** 结算当前弹窗并关闭 */
function settle(ok: boolean) {
  confirmState.visible = false;
  const done = resolver;
  resolver = null;
  done?.(ok);
}

/**
 * 打开确认弹窗（Promise 化）。
 * 用法：if (!(await confirmDialog({ message: "确定删除吗？", danger: true }))) return;
 * 点遮罩外部 / Esc / 取消 均返回 false。
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  // 若已有未结算弹窗，先按取消结算，避免上一个 Promise 永久挂起
  if (resolver) settle(false);

  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  confirmState.title = opts.title ?? "";
  confirmState.message = opts.message;
  confirmState.confirmText = opts.confirmText ?? "确定";
  confirmState.cancelText = opts.cancelText ?? "取消";
  confirmState.danger = opts.danger ?? false;
  confirmState.visible = true;

  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

/** 确认（true） */
function onConfirm() {
  settle(true);
}

/** 取消 / 点击遮罩外部（false） */
function onCancel() {
  settle(false);
}

/** Esc 关闭：等价于取消 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && confirmState.visible) onCancel();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="cd">
      <div v-if="confirmState.visible" class="cd-mask" @click.self="onCancel">
        <div
          class="cd-box"
          role="dialog"
          aria-modal="true"
          :aria-label="confirmState.title || '确认操作'"
        >
          <h3 v-if="confirmState.title" class="cd-title">{{ confirmState.title }}</h3>
          <p class="cd-message">{{ confirmState.message }}</p>
          <div class="cd-actions">
            <button class="cd-btn" type="button" @click="onCancel">
              {{ confirmState.cancelText }}
            </button>
            <button
              class="cd-btn cd-primary"
              :class="{ 'cd-danger': confirmState.danger }"
              type="button"
              @click="onConfirm"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 组件级语义 token：改这里即可整体换肤 */
.cd-mask {
  --cd-mask-bg: rgba(15, 23, 42, 0.28);
  --cd-mask-blur: 3px;
  --cd-radius: 14px;
  --cd-surface: rgba(255, 255, 255, 0.72);
  --cd-border: rgba(255, 255, 255, 0.65);
  --cd-blur: 18px;
  --cd-shadow: 0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
  --cd-title: #1f2329;
  --cd-text: #4b5563;
  --cd-btn-bg: rgba(255, 255, 255, 0.6);
  --cd-btn-border: rgba(15, 23, 42, 0.12);
  --cd-btn-text: #4b5563;
  --cd-primary-bg: #409eff;
  --cd-primary-text: #fff;
  --cd-danger-bg: #f56c6c;

  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--cd-mask-bg);
  backdrop-filter: blur(var(--cd-mask-blur));
  -webkit-backdrop-filter: blur(var(--cd-mask-blur));
}
.cd-box {
  width: 380px;
  max-width: 100%;
  padding: 22px 22px 18px;
  border-radius: var(--cd-radius);
  background: var(--cd-surface);
  border: 1px solid var(--cd-border);
  box-shadow: var(--cd-shadow);
  backdrop-filter: blur(var(--cd-blur));
  -webkit-backdrop-filter: blur(var(--cd-blur));
}
.cd-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--cd-title);
}
.cd-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cd-text);
  word-break: break-word;
}
.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.cd-btn {
  padding: 7px 16px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid var(--cd-btn-border);
  border-radius: 8px;
  background: var(--cd-btn-bg);
  color: var(--cd-btn-text);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.cd-btn:hover {
  border-color: var(--cd-primary-bg);
  color: var(--cd-primary-bg);
}
.cd-primary {
  background: var(--cd-primary-bg);
  border-color: var(--cd-primary-bg);
  color: var(--cd-primary-text);
}
.cd-primary:hover {
  filter: brightness(1.08);
  color: var(--cd-primary-text);
}
.cd-primary.cd-danger {
  background: var(--cd-danger-bg);
  border-color: var(--cd-danger-bg);
}
.cd-primary.cd-danger:hover {
  border-color: var(--cd-danger-bg);
}
/* 入场/出场动画：遮罩淡入 + 弹窗轻微上浮缩放 */
.cd-enter-active,
.cd-leave-active {
  transition: opacity 0.18s ease;
}
.cd-enter-active .cd-box,
.cd-leave-active .cd-box {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
}
.cd-enter-from,
.cd-leave-to {
  opacity: 0;
}
.cd-enter-from .cd-box,
.cd-leave-to .cd-box {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
