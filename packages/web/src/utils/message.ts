import { reactive } from "vue";

/** 轻提示类型（与 Element Plus Message 的常用类型对齐） */
export type MessageType = "success" | "error" | "info";

/** 轻提示单例状态（模块级：全站共用一次渲染，见 App.vue） */
export const messageState = reactive({
  visible: false,
  text: "",
  type: "info" as MessageType
});

/** 成功 / 提示自动关闭时长；错误不自动关闭（对齐 serverManagement 的 toast 约定） */
const AUTO_CLOSE_MS = 3000;

let timer: ReturnType<typeof setTimeout> | undefined;

/** 关闭当前提示 */
function close() {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  messageState.visible = false;
}

/**
 * 显示一条顶部居中轻提示。
 * 同一文案连续触发时只保留一个实例，并重新计时，避免连点刷屏。
 */
export function showMessage(
  text: string,
  type: MessageType = "info",
  duration: number = type === "error" ? 0 : AUTO_CLOSE_MS
) {
  const content = String(text ?? "").trim();
  if (!content) return;

  messageState.text = content;
  messageState.type = type;
  messageState.visible = true;

  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (duration > 0) {
    timer = setTimeout(close, duration);
  }
}

/** 轻提示快捷方法：message.success / error / info / close */
export const message = {
  success: (text: string, duration?: number) => showMessage(text, "success", duration),
  error: (text: string, duration?: number) => showMessage(text, "error", duration),
  info: (text: string, duration?: number) => showMessage(text, "info", duration),
  close
};
