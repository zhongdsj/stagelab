/**
 * 布局引擎：三种图类型布局参数预设
 *
 * 针对架构图/类图/流程图分别配置 ELK 布局参数与默认节点尺寸，
 * 提升不同类型图的可视化效果（开发文档十一、风险应对：多套预设）。
 */
import type { DiagramType } from "@fourstage/shared";

export interface LayoutParams {
  /** ELK 布局算法 */
  algorithm: string;
  /** 布局方向 */
  direction: "DOWN" | "RIGHT" | "LEFT" | "UP";
  /** 同层节点间距 */
  nodeNodeSpacing: number;
  /** 层间间距 */
  layerSpacing: number;
  /** 连线路径方式 */
  edgeRouting: "ORTHOGONAL" | "POLYLINE";
  /** 基础节点宽度 */
  baseNodeWidth: number;
  /** 基础节点高度 */
  baseNodeHeight: number;
}

/**
 * 获取指定图类型的布局参数预设
 */
export function getLayoutParams(type: DiagramType): LayoutParams {
  switch (type) {
    case "architecture":
      // 架构图：分层自上而下，层级间留白较大以承载组件块
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 28,
        layerSpacing: 56,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 168,
        baseNodeHeight: 60
      };
    case "class":
      // 类图：节点较大（容纳属性/方法），间距宽松
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 44,
        layerSpacing: 72,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 210,
        baseNodeHeight: 96
      };
    case "flow":
    default:
      // 流程图：紧凑排布，步骤感强
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 24,
        layerSpacing: 48,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 152,
        baseNodeHeight: 56
      };
  }
}
