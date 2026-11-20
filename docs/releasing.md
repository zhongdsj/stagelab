# 发布与版本更新

本文说明 `stagelab` 的版本更新检测机制，以及发布新版本时需要同步的 GitHub Release 资产。

## 更新检测的数据源

| 数据源 | 地址 | 作用 |
| --- | --- | --- |
| npm registry | `https://registry.npmjs.org/stagelab/latest` | 唯一判断“有没有新版本”的事实来源 |
| GitHub Release 资产 | `https://github.com/zhongdsj/stagelab/releases/latest/download/release.json` | 提供标题、更新摘要、完整说明与 Release 链接 |

- npm 请求失败时，才用 `release.json` 的 `version` 兜底判断版本。
- `release.json` 的 `version` 必须与 npm latest 完全一致，否则后端会丢弃这份说明（避免展示过期内容）。
- 两个请求各自 1.5s 超时，失败静默降级为“无法检查”，不影响启动、MCP 或业务接口。
- 检查结果缓存 24 小时；失败结果缓存 10 分钟。

## 触发点

- `stagelab start` / `stagelab http`：服务监听成功后，在控制台输出一行版本判断。
- `stagelab mcp`：stdio 连接成功后写入 stderr（不能写 stdout，避免污染 MCP 协议）。
- Web：任意 `/api/` 请求后触发前端检查；发现新版本时弹出更新弹层。
- `GET /api/system/version`：返回当前版本、最新版本、是否有更新、Release 说明；`?force=1` 跳过服务端缓存。

## 关闭检查

满足任一条件即跳过：

- `STAGELAB_UPDATE_CHECK=0`（也接受 `false` / `off` / `no`）
- `NO_UPDATE_NOTIFIER=1`
- `CI=1`

## release.json 格式

仓库根目录的 `release.json` 是发布时的模板/事实来源：

```json
{
  "version": "0.6.0",
  "publishedAt": "2026-11-20T00:00:00.000Z",
  "title": "本次更新的短标题",
  "level": "minor",
  "highlights": [
    "面向用户的一条更新摘要",
    "建议 1-5 条，每条不超过 300 字"
  ],
  "notes": "完整更新说明，支持换行；最多 12000 字",
  "url": "https://github.com/zhongdsj/stagelab/releases/tag/v0.6.0"
}
```

- `version`：必填，合法 semver。
- `level`：可选，`patch` / `minor` / `major` / `security`。
- `url`：仅接受 http(s)，避免外部资产注入脚本链接。
- `highlights` 最多取 8 条，`notes` 超长会被截断。

## 发布步骤

1. 更新 `CHANGELOG.md`，修改根 `package.json` 的 `version`。
2. 同步修改根 `release.json` 的 `version`、`publishedAt`、`highlights`、`notes`、`url`。
3. 构建发布包并发布 npm：

   ```powershell
   npm run build:release
   npm publish
   ```

4. 打 tag 并推送：

   ```powershell
   git tag v0.6.0
   git push origin v0.6.0
   ```

5. 在 GitHub 创建对应 Release，**上传 `release.json` 作为资产，文件名必须是 `release.json`**。
   稳定下载地址是 `releases/latest/download/release.json`，所以它必须挂在“最新”Release 上。

> `release.json` 只用于 GitHub Release，不在 npm 包的 `files` 中（npm 包只包含 `dist` 与 `CHANGELOG.md`），因此修改它不会影响安装包体积。
