# Agents Notes

## DeepSeek Export 脚本 (v10.0.0)

- 私聊页从 IndexedDB `deepseek-chat.history-message` 读消息
- 分享页用 XHR/fetch 拦截 + 直接调 `/api/v0/share/content`
- `parent_id` 链重建对话顺序，文件名用对话标题
- IndexedDB 无数据则通知，Obsidian 不可达则下载 md
- 按钮下方状态提示 3 秒消失，不用弹窗
- Share API 参数未知（试过 chat_session_id + message_ids + token 均报错），已放弃

## Bilibili Clipper 字幕修复

- 根因：脚本调 `x/player/v2`（无 WBI 签名），播放器用 `x/player/wbi/v2`（有 WBI + 额外参数）
- 修复：改用 WBI 签名 + 播放器同款参数（`isGaiaAvoided`, `web_location`, `dm_img`）
- 字幕优先级：用户上传 > AI 生成
- CDN 偶发返回错误视频字幕（bilibili 服务端 bug），通过时戳校验缓解（lastFrom 超出视频时长 150% 或不足 10% 则跳过）
- API 失败时从 Obsidian 已有文件恢复

## 已知限制

- Obsidian REST API 自签证书偶尔被浏览器拦截
- bilibili CDN 字幕抖动已缓解但未根治
- DeepSeek share API 参数结构未知
- Playwright 无法复用 Edge profile（运行时锁死）

## User Preferences

- 每次回复必须包含「我做了什么」+「需要用户做什么」
- 不要弹窗通知，状态显示在按钮下方即可
