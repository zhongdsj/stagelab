/**
 * 「关于」弹层状态与项目元信息
 *
 * - 入口在顶部导航，弹层全站只渲染一次
 * - 更新内容优先用版本接口返回的 Release 信息；接口不可用时回退到打包进前端的 release.json
 */
import { reactive } from "vue";
import releaseJson from "../../../../release.json";

/** 项目主页 */
export const GITHUB_URL = "https://github.com/zhongdsj/stagelab";
/** 更新日志 */
export const CHANGELOG_URL = `${GITHUB_URL}/blob/master/CHANGELOG.md`;
/** 全部 Release */
export const RELEASES_URL = `${GITHUB_URL}/releases`;

/** 弹层需要的 Release 字段（与后端 ReleaseInfo 对齐，额外字段忽略） */
export interface AboutRelease {
  version: string;
  publishedAt?: string;
  title?: string;
  highlights?: string[];
  url?: string;
}

/** 构建时随前端一起打包的版本说明，作为接口不可用/本地开发时的兜底 */
export const LOCAL_RELEASE: AboutRelease = releaseJson;

/** 全局「关于」弹层开关 */
export const aboutState = reactive<{ visible: boolean }>({
  visible: false
});

/** 打开关于弹层 */
export function openAbout(): void {
  aboutState.visible = true;
}

/** 关闭关于弹层 */
export function closeAbout(): void {
  aboutState.visible = false;
}
