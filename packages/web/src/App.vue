<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-brand" @click="goHome">
        <span class="brand-mark">四阶段</span>
        <span class="brand-title">MCP 项目管理工具</span>
      </div>
      <nav class="app-nav">
        <router-link to="/" class="nav-link">项目总览</router-link>
      </nav>
    </header>
    <main class="app-main">
      <router-view />
    </main>
    <!-- 全站唯一的确认弹窗实例（供 confirmDialog() 调用，内容 Teleport 到 body） -->
    <ConfirmDialog />
    <!-- 全站唯一的版本更新弹层（由任意 API 调用触发检查） -->
    <UpdateModal />
    <!-- 全站唯一的轻提示实例（供 message.success/error/info 调用，顶部居中） -->
    <MessageToast />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import ConfirmDialog from "./components/common/ConfirmDialog.vue";
import MessageToast from "./components/common/MessageToast.vue";
import UpdateModal from "./components/common/UpdateModal.vue";
import { ensureVersionChecked } from "./utils/update";

const router = useRouter();

// 首屏即使没有业务请求，也主动检查一次版本（有 24h 缓存，不会重复打外网）
onMounted(() => {
  void ensureVersionChecked();
});

/** 点击品牌回到项目总览 */
function goHome() {
  router.push("/");
}
</script>

<style>
/* 浏览器默认 body 有 8px 外边距，会让整页始终多出一截滚动条；图页需要按视口精确等高 */
html,
body {
  margin: 0;
  padding: 0;
}
</style>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  box-sizing: border-box;
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.brand-mark {
  background: #409eff;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
}
.brand-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.app-nav {
  display: flex;
  align-items: center;
}
.nav-link {
  color: #606266;
  text-decoration: none;
  font-size: 14px;
  padding: 6px 12px;
  border-radius: 4px;
}
.nav-link:hover {
  color: #409eff;
  background: #ecf5ff;
}
.app-main {
  flex: 1;
  padding: 24px;
}
</style>
