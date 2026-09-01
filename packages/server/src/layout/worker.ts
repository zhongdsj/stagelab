/**
 * 布局引擎 Worker Thread 封装
 *
 * 大图布局在独立 Worker 中执行，避免阻塞主线程；支持取消（AbortSignal）。
 * 本文件同时承担两种角色：
 * - 主线程：导出 layoutInWorker() 异步调用布局
 * - Worker 线程：接收 { id, diagram, options }，执行 computeLayout 并回传结果
 */
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import type { Diagram, LayoutDiagram } from "@fourstage/shared";
import { computeLayout, type LayoutOptions, type LayoutOverrides } from "./engine.ts";

export type { LayoutOverrides };

/* ---------- Worker 侧：布局执行器 ---------- */
if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on("message", async (msg: LayoutWorkerRequest) => {
    try {
      const result = await computeLayout(msg.diagram, msg.options ?? {});
      port.postMessage({ id: msg.id, ok: true, result });
    } catch (err) {
      port.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
}

interface LayoutWorkerRequest {
  id: number;
  diagram: Diagram;
  options?: LayoutOptions;
}

interface LayoutWorkerResponse {
  id: number;
  ok: boolean;
  result?: LayoutDiagram;
  error?: string;
}

let requestSeq = 0;

/**
 * 在 Worker Thread 中计算图布局
 * @param diagram 业务语义图
 * @param options 布局选项
 * @param signal 取消信号；abort 后终止 Worker 并抛出 AbortError
 */
export function layoutInWorker(
  diagram: Diagram,
  options: LayoutOptions = {},
  signal?: AbortSignal
): Promise<LayoutDiagram> {
  return new Promise<LayoutDiagram>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("布局已取消", "AbortError"));
      return;
    }
    // dev(tsx) 下入口为 .ts，编译产物(dist)下为 .js
    const isTs = import.meta.url.endsWith(".ts");
    const worker = new Worker(new URL(`./worker${isTs ? ".ts" : ".js"}`, import.meta.url));
    const id = ++requestSeq;

    let settled = false;
    const cleanup = () => {
      worker.removeListener("message", onMessage);
      worker.removeListener("error", onError);
      worker.removeListener("exit", onExit);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
      void worker.terminate();
    };
    const onAbort = () => {
      finish(() => reject(new DOMException("布局已取消", "AbortError")));
    };
    const onMessage = (msg: LayoutWorkerResponse) => {
      if (msg.id !== id) return;
      finish(() => {
        if (msg.ok && msg.result) resolve(msg.result);
        else reject(new Error(msg.error ?? "布局失败"));
      });
    };
    const onError = (err: Error) => {
      finish(() => reject(err));
    };
    const onExit = (code: number) => {
      if (!settled) finish(() => reject(new Error(`布局 Worker 异常退出(code=${code})`)));
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ id, diagram, options });
  });
}

export { computeLayout };
