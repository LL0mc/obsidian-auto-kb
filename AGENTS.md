# Agents Notes

## DeepSeek Export

### 脚本文件
- `scripts/deepseek-export.user.js` — 油猴脚本 (v10.0.0)，浏览器端直接使用
- `scripts/deepseek-fetch.py` — Python/Playwright 脚本，命令行运行

### 油猴脚本逻辑 (deepseek-export.user.js)

**运行时机**: `@run-at document-start`，拦截页面 JS 加载前的 API 请求

**数据获取策略**:
1. **私聊页** (`/chat/s/{session_id}`): 从 IndexedDB `deepseek-chat.history-message` 读取
   - 打开 IndexedDB → 查找 `chat_session.id` 匹配的记录
   - 取出 `chat_messages` 数组
   - 用 `parent_id` 链从最新消息往回走到根消息，`reverse()` 得到正确对话顺序
   - 从 `fragments` 提取内容: `REQUEST`→用户输入, `RESPONSE`→AI回答, `THINK`→思考过程
2. **分享页** (`/share/{share_id}`): 优先用 XHR 拦截捕获的数据，兜底直接调 `/api/v0/share/content?share_id=...`

**API 拦截机制**:
- `XMLHttpRequest.prototype.open/send` 拦截: 捕获 `/api/` 响应，累积消息到 `capturedMsgs`（按内容前100字符去重）
- `window.fetch` 拦截: 同上，作为兜底

**输出**:
- 文件名: 对话标题（去除非法字符，截断80字符），无标题则用时间戳
- 保存: PUT `https://127.0.0.1:27124/vault/kb/raw/deepseek/{name}.md`
- 降级: Obsidian 不可达时下载 md 文件
- 通知: 按钮下方浮动文字，3 秒自动消失，不用弹窗

### Python 脚本逻辑 (deepseek-fetch.py)

**用途**: 分享链接导出（需要分享页 URL）

**流程**:
1. Playwright 打开分享页（或用 Edge profile 打开私聊页）
2. `page.on("response")` 拦截 API 响应，匹配 `/api/v0/share/content` 等端点
3. `extract_messages_from_api()` 解析 `data.data.biz_data.messages`
4. 去重（按 message_id）→ 排序 → 生成 Markdown
5. 保存到 `D:\notebooks\Lmc\brew\kb\raw\deepseek\{title}.md`
6. 同时尝试 Obsidian REST API (PUT)

---

## Bilibili Clipper

### 脚本文件
- `scripts/bili-clipper.user.js` — 油猴脚本 (v1.4)，浏览器端直接使用

### 抓取流程 (onFetchClick)

**Step 1/3 — 视频信息**:
- `GET /x/web-interface/view?bvid={bvid}` → 获取 aid, cid, title, desc, owner, stat, duration 等

**Step 2/3 — 字幕**:

字幕 API 调用策略（模拟播放器行为）:
1. **主路径**: `GET /x/player/wbi/v2` (WBI 签名 + 播放器同款参数)
   - 参数: `aid`, `cid`, `isGaiaAvoided=false`, `web_location=1315873`, `dm_img_list=[]`, `dm_img_str=V2ViR0Y=`, `wts`, `w_rid`
   - WBI 签名: `img_key + sub_key` → `MIXIN_TAB` 混淆 → MD5 哈希
   - 使用 `credentials: 'include'` 发送 HttpOnly SESSDATA cookie
2. **降级**: `GET /x/player/v2` (无 WBI 签名，简单调用)
3. **最终降级**: 从 Obsidian vault 中已有的同名 md 文件恢复字幕
   - 读取 `## 字幕` 部分，解析 `mm:ss 文本` 格式的行

字幕校验（防 CDN 返回错误视频字幕）:
- 下载字幕后检查: `最后一条字幕时间 > 视频时长 × 1.5` 或 `< 视频时长 × 0.1` → 跳过
- 遍历所有可用字幕，直到找到校验通过的

字幕优先级: 用户上传 > AI 生成 (`ai-zh`)

**Step 3/3 — 评论**:
- `GET /x/v2/reply/main?type=1&oid={aid}&pn=1&ps=8&mode=3` → 热门评论

**输出**:
- 文件名: `{标题前50字}_{BVID}.md`
- Frontmatter: bvid, aid, cid, title, owner, duration, pubdate, pages, fetched_at, subtitle_segments, subtitle_lang, comments, stat
- 正文: 简介 → 字幕(带时间戳) → 热门评论

### SPA 导航兼容
- 拦截 `history.pushState` + `popstate` + 轮询检测 URL 变化
- URL 变化时重新初始化 UI 按钮

---

## KB 知识库管理

### Git 仓库
- KB 目录 `D:\notebooks\Lmc\brew\kb` 是独立 git repo
- 用 `git status raw/ --porcelain` 检测新 raw 文件（`??` = 新增，`M` = 修改）
- Ingest 完成后 `git add wiki/ raw/{source_file}` + `git commit`
- `.gitignore` 排除 cookie/token 文件

### Ingest 流程
详见 `.opencode/agents/clipper.md`，核心步骤：
0. Delta 检测（git status）
1. 写来源摘要 → `kb/wiki/sources/summary-{slug}.md`
2. 写/更新概念笔记 → `kb/wiki/concepts/{概念}.md`
3. 建立互链
4. 更新索引 `kb/wiki/index.md`
5. 追加日志 `kb/wiki/log.md`
6. Git 提交

### Query 归档
好的分析可以写回 wiki 成为 `kb/wiki/sources/archive-{slug}.md`，query 本身也变成知识积累。

### Lint 分级
- 确定性检查（index 一致性/断链/frontmatter）→ 自动修复
- 启发式检查（矛盾/孤儿/过时）→ 仅报告，用户决策

---

## 已知限制

- Obsidian REST API 自签证书偶尔被浏览器拦截（bilibili 脚本用 `credentials: 'include'` 能过，DeepSeek 脚本用 `fetch` 有时被拦）
- bilibili CDN 偶发返回错误视频的字幕（服务端 bug），已通过时间戳校验缓解
- DeepSeek share API (`/api/v0/share/create`) 参数结构未知，已放弃分享降级方案
- Playwright 无法复用 Edge profile（运行时锁死），测试时需关闭 Edge
- bilibili 字幕 API 需要登录态（SESSDATA cookie），无 cookie 一律返回空

## User Preferences

- 每次回复必须包含「我做了什么」+「需要用户做什么」
- 不要弹窗通知，状态显示在按钮下方即可
