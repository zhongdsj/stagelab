/**
 * T10 HTTP API 冒烟验证脚本（验证后删除）
 *
 * 用 Fastify app.inject 内联请求，覆盖开发文档第九章全部路由：
 * 项目列表/创建/详情/切阶段/索引、图布局（含折叠）、文档分片列表/读取、
 * CORS 预检、错误分类（404/422）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initRepoProject } from "../services/workspace.service.js";
import { createDiagram, updateDiagramElements } from "../services/diagram.service.js";
import { createDocument, writeDocumentFragment } from "../services/document.service.js";
import { createHttpServer } from "./server.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ok - ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL - ${msg}`);
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fourstage-http-"));

async function main() {
  const ws = await initRepoProject(tmpRoot);
  const projectId = ws.entry.projectId;
  const app = createHttpServer();

  console.log("[1] 项目路由");
  const create = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { projectName: "HTTP 测试项目", repoRoot: tmpRoot }
  });
  const created = create.json<{ projectId: string; currentStage: string }>();
  assert(create.statusCode === 200 && created.projectId === projectId, "POST /api/projects 创建项目");
  assert(created.currentStage === "s1", "创建项目默认阶段 s1");

  const list = await app.inject({ method: "GET", url: "/api/projects" });
  const listBody = list.json<unknown[]>();
  assert(list.statusCode === 200 && listBody.length >= 1, "GET /api/projects 列表");

  const detail = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
  assert(detail.statusCode === 200 && detail.json<{ projectName: string }>().projectName === "HTTP 测试项目", "GET /api/projects/:id 详情");

  const stage = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/stage`,
    payload: { stage: "s2" }
  });
  assert(stage.statusCode === 200 && stage.json<{ currentStage: string }>().currentStage === "s2", "PUT /:id/stage 切换阶段");

  const badStage = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/stage`,
    payload: { stage: "s9" }
  });
  assert(badStage.statusCode === 400, "非法 stage → 400");

  const index = await app.inject({ method: "GET", url: `/api/projects/${projectId}/index` });
  const indexBody = index.json<{ requirements: unknown[] }>();
  assert(index.statusCode === 200 && Array.isArray(indexBody.requirements), "GET /:id/index 项目索引");

  console.log("[2] 图布局（实时调用布局引擎）");
  await createDiagram(ws, "arch1", "architecture", "系统架构");
  await updateDiagramElements(ws, "arch1", [
    { action: "addNode", node: { nodeId: "gw", label: "网关", layer: "接入层", nodeKind: "gateway" } },
    { action: "addNode", node: { nodeId: "svc", label: "订单服务", layer: "服务层", nodeKind: "service" } },
    { action: "addEdge", edge: { edgeId: "e1", from: "gw", to: "svc" } }
  ]);
  const layout = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/diagrams/arch1/layout`
  });
  const layoutBody = layout.json<{ width: number; height: number; nodes: unknown[]; edges: unknown[]; groups: unknown[] }>();
  assert(layout.statusCode === 200 && layoutBody.nodes.length === 2 && layoutBody.edges.length === 1, "GET layout 返回带坐标结果");
  assert(layoutBody.width > 0 && layoutBody.height > 0, "layout 输出画布尺寸");

  // 布局折叠：带纵向分组的图 + focusModuleId
  await createDiagram(ws, "arch2", "architecture", "带分区架构");
  await updateDiagramElements(ws, "arch2", [
    { action: "addNode", node: { nodeId: "a1", label: "A1", layer: "模块A", nodeKind: "service" } },
    { action: "addNode", node: { nodeId: "a2", label: "A2", layer: "模块A", nodeKind: "service" } },
    { action: "addNode", node: { nodeId: "b1", label: "B1", layer: "模块B", nodeKind: "service" } },
    { action: "addGroup", group: { groupId: "gA", title: "模块A", axis: "vertical", nodeIds: ["a1", "a2"], collapsible: true } },
    { action: "addGroup", group: { groupId: "gB", title: "模块B", axis: "vertical", nodeIds: ["b1"], collapsible: true } },
    { action: "addEdge", edge: { edgeId: "c1", from: "a2", to: "b1" } }
  ]);
  const layoutFocus = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/diagrams/arch2/layout?focusModuleId=gA`
  });
  const focusBody = layoutFocus.json<{ nodes: Array<{ nodeId: string }> }>();
  assert(
    layoutFocus.statusCode === 200 &&
      focusBody.nodes.some((n) => n.nodeId === "gB::aggregate"),
    "layout?focusModuleId 折叠非聚焦模块"
  );

  console.log("[3] 文档分片");
  await createDocument(ws, "doc1", "开发文档", "登录功能设计");
  await writeDocumentFragment(ws, "doc1", "第二段内容", { order: 1 });

  const frags = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/documents/doc1/fragments`
  });
  const fragsBody = frags.json<Array<{ fragmentId: string; order: number; title: string; content?: string }>>();
  assert(frags.statusCode === 200 && fragsBody.length === 2, "GET fragments 分片列表");
  assert(!("content" in fragsBody[0]), "分片列表不含全文（轻量）");

  const frag = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/documents/doc1/fragments/doc1-f0`
  });
  const fragBody = frag.json<{ content: string }>();
  assert(frag.statusCode === 200 && fragBody.content.includes("登录"), "GET fragments/:fid 读取分片内容");

  const fragWrongDoc = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/documents/otherdoc/fragments/doc1-f0`
  });
  assert(fragWrongDoc.statusCode === 404, "分片不属于该文档 → 404");

  console.log("[4] 错误分类");
  const notFound = await app.inject({ method: "GET", url: "/api/projects/no-such-project" });
  assert(notFound.statusCode === 404, "未知项目 → 404");

  const noName = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
  assert(noName.statusCode === 400, "缺 projectName → 400");

  // 模拟 Git 冲突：写损坏 JSON，layout 读取报格式损坏
  const badPath = path.join(tmpRoot, ".fourstage", "store", "diagrams", "bad.json");
  fs.mkdirSync(path.dirname(badPath), { recursive: true });
  fs.writeFileSync(badPath, '{"diagramId": "bad", >>> conflict <<<', "utf-8");
  const corrupt = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/diagrams/bad/layout`
  });
  assert(corrupt.statusCode === 422 && corrupt.json<{ error: string }>().error.includes("格式损坏"), "损坏 JSON → 422 格式损坏");

  console.log("[5] CORS");
  const preflight = await app.inject({ method: "OPTIONS", url: "/api/projects" });
  assert(preflight.statusCode === 204 && preflight.headers["access-control-allow-origin"] === "*", "OPTIONS 预检 204 + CORS 头");
  const getRes = await app.inject({ method: "GET", url: "/api/projects" });
  assert(getRes.headers["access-control-allow-origin"] === "*", "正常响应带 CORS 头");

  await app.close();

  console.log(`\nT10 冒烟结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
