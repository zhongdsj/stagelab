/**
 * 系统级运维 API（对接 /api/system/* 路由）
 *
 * registry 临时文件手动清理（G1）：不做任何自动清理，仅响应显式操作。
 */
import { http } from "./client.js";

/** registry 临时文件条目 */
export interface RegistryTmpFile {
  /** 文件名（registry.json.tmp-<时间戳>-<随机串>） */
  name: string;
  /** 文件字节数 */
  size: number;
  /** 创建时间（优先取文件名内时间戳，回退文件 mtime） */
  createdAt: number;
}

/** 列出 registry 临时文件 */
export function listRegistryTmp(): Promise<RegistryTmpFile[]> {
  return http.get<RegistryTmpFile[]>("/api/system/registry-tmp");
}

/** 删除单个 registry 临时文件（服务端做文件名白名单校验） */
export function deleteRegistryTmp(
  name: string
): Promise<{ name: string; deleted: boolean }> {
  return http.del(
    `/api/system/registry-tmp?name=${encodeURIComponent(name)}`
  );
}

/** 清空全部 registry 临时文件 */
export function clearRegistryTmp(): Promise<{ deleted: number; total: number }> {
  return http.del("/api/system/registry-tmp/all");
}
