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
  /** 跨格连线竖线错开总宽度上限（Z 形通道，T47 收尾） */
  edgeChannelSpread: number;
  /** 跨格连线竖线错开槽位数（Z 形通道） */
  edgeChannelSlots: number;
  /** 跨格连线绕行通道间隔（右出向上绕行时相邻边错开的纵向步长） */
  edgeChannelStep: number;
}

/**
 * 获取指定图类型的布局参数预设
 */
export function getLayoutParams(type: DiagramType): LayoutParams {
  switch (type) {
    case "architecture":
      // 架构图：分层自上而下，层级间留白较大以承载组件块（T47 二次加大间距减少连线重叠）
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 56,
        layerSpacing: 120,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 168,
        baseNodeHeight: 60,
        edgeChannelSpread: 90,
        edgeChannelSlots: 5,
        edgeChannelStep: 34
      };
    case "class":
      // 类图：节点较大（容纳属性/方法），间距宽松（T47 二次加大间距减少连线重叠）
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 80,
        layerSpacing: 140,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 210,
        baseNodeHeight: 96,
        edgeChannelSpread: 90,
        edgeChannelSlots: 5,
        edgeChannelStep: 34
      };
    case "flow":
    default:
      // 流程图：紧凑排布，步骤感强（T47 二次加大间距减少连线重叠）
      return {
        algorithm: "layered",
        direction: "DOWN",
        nodeNodeSpacing: 50,
        layerSpacing: 100,
        edgeRouting: "ORTHOGONAL",
        baseNodeWidth: 152,
        baseNodeHeight: 56,
        edgeChannelSpread: 90,
        edgeChannelSlots: 5,
        edgeChannelStep: 34
      };
  }
}
