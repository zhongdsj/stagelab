<template>
  <div ref="rootRef" class="search-box" :class="[`align-${align}`, { open }]">
    <div class="search-row">
      <input
        ref="inputRef"
        v-model="keyword"
        class="search-input"
        type="text"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        @keydown="onKeydown"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @focus="onFocus"
      />
      <button
        class="search-btn"
        type="button"
        :disabled="!keyword.trim() || loading"
        @click="runSearch"
      >
        {{ loading ? "搜索中…" : "搜索" }}
      </button>
    </div>

    <!-- 结果浮层：显式触发（Enter/按钮），不做输入即搜 -->
    <div v-if="open" class="search-panel" @mousedown.prevent>
      <div v-if="loading" class="search-progress"></div>

      <p v-if="error" class="search-error">{{ error }}</p>
      <template v-else>
        <p v-if="!flatHits.length && searched" class="search-empty">
          未找到「{{ lastQuery }}」相关内容
        </p>
        <div v-for="g in groups" :key="g.kind" class="search-group">
          <div class="search-group-title">
            <span>{{ g.label }}</span>
            <span class="search-group-count">{{ g.items.length }}</span>
          </div>
          <button
            v-for="h in g.items"
            :key="hitKey(h)"
            type="button"
            class="search-hit"
            :class="{ active: activeKey === hitKey(h) }"
            @mouseenter="activeKey = hitKey(h)"
            @click="openHit(h)"
          >
            <div class="hit-head">
              <span class="hit-title">{{ h.title }}</span>
              <span v-if="h.subtitle" class="hit-sub">{{ h.subtitle }}</span>
            </div>
            <div v-if="h.snippet" class="hit-snippet">
              <template v-for="(part, i) in snippetParts(h)" :key="i">
                <mark v-if="part.hit">{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { searchProject, ApiError, type SearchHit, type SearchKind } from "../../api/index";

const props = withDefaults(
  defineProps<{
    projectId: string;
    placeholder?: string;
    /** 浮层对齐方向：项目页靠右，侧栏靠左 */
    align?: "left" | "right";
  }>(),
  { placeholder: "搜索文档 / 图 / 需求 / 任务…", align: "left" }
);

const router = useRouter();

/** 关键词（仅输入，不触发请求） */
const keyword = ref("");
/** 已提交搜索的关键词（结果归属 + 跳转 q 参数） */
const lastQuery = ref("");
/** 结果浮层开合 */
const open = ref(false);
/** 是否完成过至少一次搜索（用于空态文案） */
const searched = ref(false);
/** loading 兼作互斥锁：await 前同步置位，finally 清锁 */
const loading = ref(false);
const error = ref("");
/** 输入法组合态：拼音选词时 Enter 不触发搜索 */
const composing = ref(false);
/** 键盘高亮项（kind:id） */
const activeKey = ref("");

const results = ref<SearchHit[]>([]);

const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);

/** 分组顺序与中文标签 */
const KIND_GROUPS: Array<{ kind: SearchKind; label: string }> = [
  { kind: "document", label: "文档" },
  { kind: "fragment", label: "文档分片" },
  { kind: "diagram", label: "图" },
  { kind: "requirement", label: "需求" },
  { kind: "task", label: "任务" }
];

const groups = computed(() =>
  KIND_GROUPS.map(({ kind, label }) => ({
    kind,
    label,
    items: results.value.filter((h) => h.kind === kind)
  })).filter((g) => g.items.length > 0)
);

/** 扁平结果序列（键盘上下移动用，顺序与视觉分组一致） */
const flatHits = computed(() => groups.value.flatMap((g) => g.items));

const activeHit = computed(
  () => flatHits.value.find((h) => hitKey(h) === activeKey.value) ?? null
);

function hitKey(h: SearchHit): string {
  return `${h.kind}:${h.id}`;
}

/** 拆 snippet 为普通/命中片段（ranges 为服务端给出的字符偏移） */
function snippetParts(h: SearchHit): Array<{ text: string; hit: boolean }> {
  const text = h.snippet ?? "";
  const ranges = (h.ranges ?? [])
    .filter((r) => r.end > r.start && r.start < text.length)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(text.length, r.end) }))
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return [{ text, hit: false }];

  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue; // 重叠区间跳过
    if (r.start > cursor) parts.push({ text: text.slice(cursor, r.start), hit: false });
    parts.push({ text: text.slice(r.start, r.end), hit: true });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

/** 触发搜索（唯一入口：Enter / 搜索按钮） */
async function runSearch() {
  const q = keyword.value.trim();
  if (!q || loading.value) return;
  // 同步置锁，重入直接返回（连点/连按只产生一个请求）
  loading.value = true;
  open.value = true;
  error.value = "";
  activeKey.value = "";

  const controller = new AbortController();
  // 10s 超时兜底解锁
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    results.value = await searchProject(props.projectId, q.slice(0, 100), {
      signal: controller.signal
    });
    lastQuery.value = q;
    searched.value = true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      error.value = "搜索超时，请稍后重试";
    } else {
      error.value = e instanceof ApiError ? e.message : "搜索失败，请稍后重试";
    }
  } finally {
    clearTimeout(timer);
    loading.value = false;
  }
}

/** 键盘：↑↓ 选择、Esc 关闭、Enter 有高亮跳转否则搜索 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    open.value = false;
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!open.value || !flatHits.value.length) return;
    e.preventDefault();
    moveActive(e.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (e.key !== "Enter") return;
  // 输入法组合态（含 keyCode 229 兼容）不触发
  if (composing.value || e.isComposing || e.keyCode === 229) return;
  if (open.value && activeHit.value) {
    e.preventDefault();
    openHit(activeHit.value);
    return;
  }
  e.preventDefault();
  void runSearch();
}

/** 在扁平结果内循环移动高亮 */
function moveActive(step: number) {
  const list = flatHits.value;
  if (!list.length) return;
  const idx = list.findIndex((h) => hitKey(h) === activeKey.value);
  const next = idx === -1 ? (step > 0 ? 0 : list.length - 1) : (idx + step + list.length) % list.length;
  activeKey.value = hitKey(list[next]);
}

function onFocus() {
  if (searched.value || results.value.length) open.value = true;
}

/** 点击结果：按类型跳转到对应页面与定位参数（定位由 T7 消费） */
function openHit(h: SearchHit) {
  open.value = false;
  if (h.kind === "diagram") {
    const diagramId = h.diagramId ?? h.id;
    if (diagramId) {
      void router.push({
        name: "diagram-page",
        params: { id: props.projectId, diagramId }
      });
    }
    return;
  }

  const query: Record<string, string> = {};
  if (h.kind === "document" || h.kind === "fragment") {
    query.tab = "doc";
    query.docId = h.docId ?? "";
    if (h.kind === "fragment" && h.fragmentOrder !== undefined) {
      query.f = String(h.fragmentOrder);
    }
    if (lastQuery.value) query.q = lastQuery.value;
  } else {
    query.tab = "req";
    if (h.requirementId) query.requirementId = h.requirementId;
    if (h.kind === "task" && h.taskId) query.taskId = h.taskId;
  }
  void router.push({ path: `/projects/${props.projectId}`, query });
}

/** 点击外部关闭浮层 */
function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return;
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("mousedown", onDocMouseDown));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocMouseDown));
</script>

<style scoped>
.search-box {
  position: relative;
  width: 100%;
  min-width: 180px;
}
.search-row {
  display: flex;
  gap: 6px;
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
  color: #303133;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.search-input:focus {
  border-color: #409eff;
}
.search-btn {
  flex: 0 0 auto;
  padding: 6px 12px;
  font-size: 13px;
  color: #fff;
  background: #409eff;
  border: 1px solid #409eff;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.search-btn:hover:not(:disabled) {
  background: #66b1ff;
  border-color: #66b1ff;
}
.search-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 结果浮层 */
.search-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 300;
  width: 420px;
  max-width: 88vw;
  max-height: 60vh;
  overflow-y: auto;
  padding: 8px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}
.align-right .search-panel {
  left: auto;
  right: 0;
}
/* 在途细进度条（旧结果保留，不清空） */
.search-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  overflow: hidden;
  background: #ecf5ff;
  border-radius: 8px 8px 0 0;
}
.search-progress::after {
  content: "";
  display: block;
  width: 40%;
  height: 100%;
  background: #409eff;
  animation: search-progress 0.9s ease-in-out infinite;
}
@keyframes search-progress {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(260%);
  }
}
.search-error {
  margin: 8px;
  font-size: 13px;
  color: #f56c6c;
}
.search-empty {
  margin: 12px 8px;
  font-size: 13px;
  color: #909399;
  text-align: center;
}
.search-group + .search-group {
  margin-top: 6px;
  border-top: 1px dashed #ebeef5;
  padding-top: 6px;
}
.search-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: #909399;
}
.search-group-count {
  font-weight: 400;
  color: #c0c4cc;
}
.search-hit {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 8px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.search-hit.active {
  background: #ecf5ff;
}
.hit-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.hit-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hit-sub {
  flex: 0 0 auto;
  font-size: 11px;
  color: #909399;
}
.hit-snippet {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
  word-break: break-word;
}
.hit-snippet mark {
  padding: 0 1px;
  color: #c7254e;
  background: #fff3c4;
  border-radius: 2px;
}
</style>
