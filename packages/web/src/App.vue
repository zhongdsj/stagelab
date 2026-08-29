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
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

/** 点击品牌回到项目总览 */
function goHome() {
  router.push("/");
}
</script>

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
