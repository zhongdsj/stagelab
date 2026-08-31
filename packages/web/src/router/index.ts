/**
 * 前端路由（T11）
 *
 * - /               项目总览面板（列表 + 创建）
 * - /projects/:id   项目详情（四阶段流程导航 + 阶段切换）
 */
import { createRouter, createWebHistory } from "vue-router";
import ProjectListView from "../views/ProjectListView.vue";
import ProjectDetailView from "../views/ProjectDetailView.vue";
import DiagramPageView from "../views/DiagramPageView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "projects", component: ProjectListView },
    {
      path: "/projects/:id",
      name: "project-detail",
      component: ProjectDetailView,
      props: true
    },
    // T22：独立图查看页面（左右结构：图列表 + 图渲染）
    {
      path: "/projects/:id/diagrams/:diagramId",
      name: "diagram-page",
      component: DiagramPageView,
      props: true
    }
  ]
});
