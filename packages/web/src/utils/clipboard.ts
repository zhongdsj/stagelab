/**
 * 复制文本到剪贴板。
 * 优先用异步 Clipboard API；在非安全上下文（如局域网 http）或旧浏览器下回退到隐藏 textarea + execCommand，
 * 避免复制按钮点了没反应（T8：图库/侧栏/工具栏复制 diagramId 复用）。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Clipboard API 被拒绝：继续走回退方案 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
