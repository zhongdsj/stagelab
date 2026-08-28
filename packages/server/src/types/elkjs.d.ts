/**
 * elkjs 模块类型声明修正
 *
 * elkjs 0.12 的 lib/main.d.ts 声明为 ESM `export default`，
 * 但实际 lib/main.js 是 CJS（module.exports = ELKNode），
 * 在 NodeNext 严格 ESM 下导致 `new ELK()` 报 not constructable。
 * 此处重声明为 CJS 构造签名，绕开类型入口问题。
 */
declare module "elkjs" {
  import {
    type ElkNode,
    type ElkExtendedEdge,
    type ElkLayoutArguments
  } from "elkjs/lib/elk-api";

  class ELK {
    constructor(args?: { defaultLayoutOptions?: Record<string, string> });
    layout<T extends ElkNode>(
      graph: T,
      args?: ElkLayoutArguments
    ): Promise<
      Omit<T, "children"> & {
        children?: ElkNode[];
        edges?: ElkExtendedEdge[];
      }
    >;
    terminateWorker(): void;
  }

  export default ELK;
  export type { ElkNode, ElkExtendedEdge };
}
