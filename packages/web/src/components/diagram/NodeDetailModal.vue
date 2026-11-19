<template>
  <div class="node-detail-mask" @click.self="emit('close')">
    <div class="node-detail-panel" role="dialog" aria-modal="true" @click.stop>
      <!-- 头部：label / nodeId / 图类型 + 类型特征字段 -->
      <div class="nd-head">
        <div class="nd-head-main">
          <span class="nd-label">{{ label }}</span>
          <span class="nd-type">{{ diagramTypeLabel }}</span>
          <span v-for="chip in typeChips" :key="chip" class="nd-chip">{{ chip }}</span>
        </div>
        <button class="nd-close" type="button" title="关闭（ESC）" @click="emit('close')">×</button>
      </div>
      <div class="nd-id-row">
        <code class="nd-id">{{ nodeId }}</code>
        <button class="nd-copy" type="button" @click="copy(nodeId)">
          {{ copiedKey === nodeId ? "已复制" : "复制 ID" }}
        </button>
      </div>

      <!-- 描述 -->
      <section v-if="description" class="nd-section">
        <h4>描述</h4>
        <p class="nd-desc">{{ description }}</p>
      </section>

      <!-- 结构风险：打开时单次拉取，404/失败降级「暂无数据」 -->
      <section class="nd-section">
        <h4>结构风险</h4>
        <p v-if="impactState === 'loading'" class="nd-muted">加载中…</p>
        <p v-else-if="impactState === 'empty'" class="nd-muted">暂无数据</p>
        <template v-else-if="impact">
          <div class="nd-risk-row">
            <span class="nd-risk-badge" :class="'risk-' + impact.structuralRisk">
              结构风险：{{ riskLabel(impact.structuralRisk) }}
            </span>
            <span class="nd-metric">扇入 {{ impact.fanIn }}</span>
            <span class="nd-metric">扇出 {{ impact.fanOut }}</span>
            <span class="nd-metric">上游 {{ impact.upstreamHops }} 跳</span>
            <span class="nd-metric">下游 {{ impact.downstreamHops }} 跳</span>
            <span class="nd-metric" :class="{ warn: impact.inCycle }">
              {{ impact.inCycle ? "位于环中" : "不在环中" }}
            </span>
          </div>
          <div v-if="impact.upstream.length" class="nd-rel-line">
            <span class="nd-rel-key">直接上游</span>
            <span class="nd-rel-val">{{ impact.upstream.join("、") }}</span>
          </div>
          <div v-if="impact.downstream.length" class="nd-rel-line">
            <span class="nd-rel-key">直接下游</span>
            <span class="nd-rel-val">{{ impact.downstream.join("、") }}</span>
          </div>
          <div v-if="impact.inCycle && impact.cycleIds.length" class="nd-rel-line">
            <span class="nd-rel-key">环节点</span>
            <span class="nd-rel-val">{{ impact.cycleIds.join("、") }}</span>
          </div>
        </template>
        <p v-else class="nd-muted">暂无数据</p>
      </section>

      <!-- 所属分组：diagram.groups[].nodeIds 反查 -->
      <section v-if="groups.length" class="nd-section">
        <h4>所属分组</h4>
        <div class="nd-chips">
          <span v-for="g in groups" :key="g.groupId" class="nd-chip">{{ g.title }}</span>
        </div>
      </section>

      <!-- 源码锚点 -->
      <section v-if="codeFiles.length" class="nd-section">
        <h4>源码锚点</h4>
        <div v-for="(f, i) in codeFiles" :key="f.path + '-' + i" class="nd-file">
          <button class="nd-code-path" type="button" :title="f.path + '（点击复制）'" @click="copy(f.path)">
            {{ copiedKey === f.path ? "已复制" : f.path }}
          </button>
          <span v-if="f.symbols?.length" class="nd-symbols">{{ f.symbols.join(", ") }}</span>
        </div>
      </section>

      <!-- 关联连线：入边 ← 来源 / 出边 → 目标 -->
      <section v-if="incoming.length || outgoing.length" class="nd-section">
        <h4>关联连线</h4>
        <div class="nd-edges">
          <div class="nd-edge-col">
            <div class="nd-edge-title">← 来源（{{ incoming.length }}）</div>
            <p v-if="!incoming.length" class="nd-muted">无</p>
            <div v-for="e in incoming" :key="e.edgeId" class="nd-edge-item">
              <span class="nd-edge-node">{{ nodeLabel(e.from) }}</span>
              <span v-if="e.label" class="nd-edge-label">{{ e.label }}</span>
            </div>
          </div>
          <div class="nd-edge-col">
            <div class="nd-edge-title">→ 目标（{{ outgoing.length }}）</div>
            <p v-if="!outgoing.length" class="nd-muted">无</p>
            <div v-for="e in outgoing" :key="e.edgeId" class="nd-edge-item">
              <span class="nd-edge-node">{{ nodeLabel(e.to) }}</span>
              <span v-if="e.label" class="nd-edge-label">{{ e.label }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 类成员 -->
      <section v-if="attributes.length" class="nd-section">
        <h4>属性（{{ attributes.length }}）</h4>
        <table class="nd-table">
          <thead>
            <tr><th>可见性</th><th>名称</th><th>类型</th><th>static</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(a, i) in attributes" :key="'a-' + i">
              <td>{{ visibilityLabel(a.visibility) }}</td>
              <td class="mono">{{ a.name }}</td>
              <td class="mono">{{ a.type }}</td>
              <td>{{ a.static ? "✓" : "" }}</td>
              <td class="nd-cell-desc">{{ a.description ?? "" }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="methods.length" class="nd-section">
        <h4>方法（{{ methods.length }}）</h4>
        <table class="nd-table">
          <thead>
            <tr><th>可见性</th><th>方法</th><th>参数</th><th>返回</th><th>static</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(m, i) in methods" :key="'m-' + i">
              <td>{{ visibilityLabel(m.visibility) }}</td>
              <td class="mono">{{ m.name }}{{ m.abstract ? "（抽象）" : "" }}</td>
              <td class="mono">{{ paramsLabel(m) }}</td>
              <td class="mono">{{ m.returnType ?? "" }}</td>
              <td>{{ m.static ? "✓" : "" }}</td>
              <td class="nd-cell-desc">{{ m.description ?? "" }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 扩展数据：aiRiskNote 置顶卡片 + payload JSON 折叠 -->
      <section v-if="aiRiskNote || payloadRest" class="nd-section">
        <h4>扩展数据</h4>
        <div v-if="aiRiskNote" class="nd-risk-note">
          <div class="nd-risk-note-title">⚠ AI 风险注记</div>
          <pre class="nd-pre">{{ aiRiskNoteText }}</pre>
        </div>
        <details v-if="payloadRest" class="nd-json">
          <summary>payload（{{ payloadKeys.length }} 个字段）</summary>
          <pre class="nd-pre">{{ payloadRestText }}</pre>
        </details>
      </section>

      <!-- 关联图：按钮跳转，跳转即关闭弹层 -->
      <section v-if="links.length" class="nd-section">
        <h4>关联图</h4>
        <div class="nd-links">
          <button
            v-for="l in links"
            :key="l.diagramId"
            class="nd-link-btn"
            type="button"
            @click="goto(l.diagramId)"
          >
            {{ jumpLabel(l.type) }}
            <span class="nd-link-sub">{{ l.label || l.diagramId }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  ClassAttribute,
  ClassMethod,
  CodeAnchorFile,
  Diagram,
  Edge,
  ImpactIndexEntry,
  ImpactRiskLevel,
  LinkedDiagram
} from "@stagelab/shared";
import { getNodeImpact, type ImpactRiskMap } from "../../api/index";
import { copyText } from "../../utils/clipboard";

const props = defineProps<{
  projectId: string;
  diagramId: string;
  /** 当前节点语义数据（三种图节点联合类型，按字段探测渲染） */
  node: Record<string, unknown>;
  diagram: Diagram;
  /** 已加载的风险分映射：riskMap 命中时先渲染色级，明细另行拉取 */
  riskMap: ImpactRiskMap;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "navigate", diagramId: string): void;
}>();

const nodeId = computed(() => String(props.node.nodeId ?? ""));
const label = computed(() => String(props.node.label ?? nodeId.value));
const description = computed(() => String(props.node.description ?? ""));

const diagramTypeLabel = computed(() => {
  const t = props.diagram.type;
  return t === "architecture" ? "架构图" : t === "class" ? "类图" : "流程图";
});

/** 头部类型特征 chip：架构图 layer/nodeKind；类图 kind；流程图 nodeKind */
const typeChips = computed(() => {
  const chips: string[] = [];
  const n = props.node;
  if (typeof n.layer === "string" && n.layer) chips.push(`层级：${n.layer}`);
  if (typeof n.nodeKind === "string" && n.nodeKind) chips.push(`类型：${n.nodeKind}`);
  if (typeof n.kind === "string" && n.kind) chips.push(`kind：${n.kind}`);
  return chips;
});

/* ========== 单节点影响面明细 ========== */

type ImpactState = "loading" | "ready" | "empty";
const impactState = ref<ImpactState>("loading");
const impact = ref<ImpactIndexEntry | null>(null);

/** 拉取明细：404/失败一律降级「暂无数据」，不弹错误（doc §8.4） */
async function loadImpact() {
  impactState.value = "loading";
  impact.value = null;
  try {
    const res = await getNodeImpact(props.projectId, props.diagramId, nodeId.value);
    impact.value = res.entry;
    impactState.value = "ready";
  } catch {
    impactState.value = "empty";
  }
}

watch(nodeId, () => loadImpact());

/** 风险等级中文标签 */
function riskLabel(level: ImpactRiskLevel): string {
  return level === "high" ? "高" : level === "medium" ? "中" : "低";
}

/* ========== 所属分组 ========== */

const groups = computed(() =>
  (props.diagram.groups ?? []).filter((g) => g.nodeIds.includes(nodeId.value))
);

/* ========== 源码锚点 ========== */

const codeFiles = computed<CodeAnchorFile[]>(() => {
  const anchor = props.node.codeAnchor as { files?: CodeAnchorFile[] } | undefined;
  return anchor?.files ?? [];
});

/* ========== 关联连线 ========== */

const incoming = computed<Edge[]>(() =>
  (props.diagram.edges ?? []).filter((e) => e.to === nodeId.value)
);
const outgoing = computed<Edge[]>(() =>
  (props.diagram.edges ?? []).filter((e) => e.from === nodeId.value)
);

/** 节点显示名：优先 label，回退 nodeId */
function nodeLabel(id: string): string {
  const nodes = (props.diagram.nodes ?? []) as unknown as Array<Record<string, unknown>>;
  const hit = nodes.find((n) => String(n.nodeId) === id);
  return hit ? String(hit.label ?? id) : id;
}

/* ========== 类成员 ========== */

const attributes = computed<ClassAttribute[]>(
  () => (props.node.attributes as ClassAttribute[] | undefined) ?? []
);
const methods = computed<ClassMethod[]>(
  () => (props.node.methods as ClassMethod[] | undefined) ?? []
);

function visibilityLabel(v?: string): string {
  return v === "private" ? "private" : v === "protected" ? "protected" : v === "public" ? "public" : "-";
}

function paramsLabel(m: ClassMethod): string {
  return (m.params ?? []).map((p) => `${p.name}: ${p.type}`).join(", ");
}

/* ========== 扩展数据 ========== */

const payload = computed<Record<string, unknown>>(
  () => (props.node.payload as Record<string, unknown> | undefined) ?? {}
);
const payloadKeys = computed(() => Object.keys(payload.value));
const aiRiskNote = computed(() => payload.value.aiRiskNote);
const aiRiskNoteText = computed(() =>
  typeof aiRiskNote.value === "string"
    ? aiRiskNote.value
    : JSON.stringify(aiRiskNote.value, null, 2)
);

/** 除 aiRiskNote 外的其余字段（单独折叠展示，避免重复） */
const payloadRest = computed<Record<string, unknown>>(() => {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload.value)) {
    if (k !== "aiRiskNote") rest[k] = v;
  }
  return rest;
});
const payloadRestText = computed(() => JSON.stringify(payloadRest.value, null, 2));

/* ========== 关联图 ========== */

/**
 * 提取节点关联图：优先顶层 linkedDiagrams；兼容架构图/流程图 payload.linkedDiagrams
 * 与遗留 sys-flow 的 payload.linkedDiagram 单值（与 DiagramView 原逻辑一致）。
 */
function linkedDiagramsOf(node: Record<string, unknown>): LinkedDiagram[] {
  const p = (node.payload ?? {}) as Record<string, unknown>;
  if (Array.isArray(node.linkedDiagrams)) return node.linkedDiagrams as LinkedDiagram[];
  if (Array.isArray(p.linkedDiagrams)) return p.linkedDiagrams as LinkedDiagram[];
  if (p.linkedDiagram) return [p.linkedDiagram as LinkedDiagram];
  return [];
}

const links = computed(() => linkedDiagramsOf(props.node));

function jumpLabel(type?: string): string {
  if (type === "class") return "转到类图";
  if (type === "flow") return "转到流程图";
  if (type === "architecture") return "转到架构图";
  return "跳转";
}

function goto(diagramId: string) {
  emit("navigate", diagramId);
}

/* ========== 复制 ========== */

const copiedKey = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(text: string) {
  if (!text) return;
  const ok = await copyText(text);
  if (!ok) return;
  copiedKey.value = text;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedKey.value = "";
  }, 1500);
}

/* ========== 关闭：ESC ========== */

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    emit("close");
  }
}

onMounted(() => {
  loadImpact();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<style scoped>
.node-detail-mask {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.node-detail-panel {
  width: 680px;
  max-width: 100%;
  max-height: 88vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px 20px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
  color: #303133;
  font-size: 13px;
  line-height: 1.6;
}
.nd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.nd-head-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.nd-label {
  font-size: 17px;
  font-weight: 600;
}
.nd-type {
  padding: 1px 8px;
  border-radius: 10px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}
.nd-chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  background: #f4f4f5;
  color: #606266;
  font-size: 12px;
}
.nd-close {
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: #909399;
  cursor: pointer;
  border-radius: 4px;
}
.nd-close:hover {
  background: #f2f6fc;
  color: #303133;
}
.nd-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.nd-id {
  font-family: monospace;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  padding: 2px 8px;
  border-radius: 4px;
  word-break: break-all;
}
.nd-copy {
  flex: none;
  padding: 2px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 12px;
  cursor: pointer;
}
.nd-copy:hover {
  border-color: #409eff;
  color: #409eff;
}
.nd-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}
.nd-section h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #909399;
  font-weight: 600;
}
.nd-desc {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.nd-muted {
  margin: 0;
  color: #a8abb2;
  font-size: 12px;
}
.nd-risk-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.nd-risk-badge {
  padding: 1px 9px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.risk-low {
  background: #f0f9eb;
  color: #529b2e;
}
.risk-medium {
  background: #fdf6ec;
  color: #b88230;
}
.risk-high {
  background: #fef0f0;
  color: #c45656;
}
.nd-metric {
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  padding: 1px 8px;
  border-radius: 10px;
}
.nd-metric.warn {
  background: #fef0f0;
  color: #c45656;
}
.nd-rel-line {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.nd-rel-key {
  flex: none;
  color: #909399;
}
.nd-rel-val {
  font-family: monospace;
  color: #606266;
  word-break: break-all;
}
.nd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.nd-file {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.nd-code-path {
  padding: 1px 6px;
  border: none;
  border-radius: 4px;
  background: #f5f7fa;
  font-family: monospace;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  word-break: break-all;
  text-align: left;
}
.nd-code-path:hover {
  background: #ecf5ff;
}
.nd-symbols {
  font-family: monospace;
  font-size: 12px;
  color: #67c23a;
  word-break: break-all;
}
.nd-edges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.nd-edge-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.nd-edge-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
}
.nd-edge-node {
  font-family: monospace;
  color: #303133;
}
.nd-edge-label {
  color: #a8abb2;
}
.nd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.nd-table th,
.nd-table td {
  border: 1px solid #ebeef5;
  padding: 4px 6px;
  text-align: left;
  vertical-align: top;
}
.nd-table th {
  background: #fafafa;
  color: #909399;
  font-weight: 500;
}
.mono {
  font-family: monospace;
}
.nd-cell-desc {
  color: #909399;
  word-break: break-word;
}
.nd-risk-note {
  border: 1px solid #f5dab1;
  background: #fdf6ec;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.nd-risk-note-title {
  font-size: 12px;
  font-weight: 600;
  color: #b88230;
  margin-bottom: 4px;
}
.nd-pre {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: #606266;
}
.nd-json summary {
  cursor: pointer;
  font-size: 12px;
  color: #409eff;
}
.nd-json .nd-pre {
  margin-top: 6px;
  padding: 8px 10px;
  background: #fafafa;
  border-radius: 4px;
}
.nd-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.nd-link-btn {
  padding: 4px 10px;
  border: 1px solid #b3d8ff;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  cursor: pointer;
}
.nd-link-btn:hover {
  background: #d9ecff;
}
.nd-link-sub {
  margin-left: 4px;
  color: #79a9d1;
}
</style>
