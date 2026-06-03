# Obsidian Manager — Personal Knowledge Base Workflow

从多种外部来源采集内容 → Agent 自动摘要、提取概念、写入 Obsidian vault → 构建可检索、可链接的个人知识图谱。

## Agents

位于 `.opencode/agents/`，在对话中用 `@agent_name` 触发：

| Agent | 功能 |
|-------|------|
| **`@clipper`** | KB 知识库摄取 — 读取 `kb/raw/` 中的原始材料 → 校验字幕一致性 → 写来源摘要 → 创建/更新概念笔记 → 更新索引和日志 |
| **`@reading`** | 哲学读书陪读 — 读 PDF/EPUB，三种模式（章节推进、段落讨论、全书回顾），整理笔记到 KB |

## 项目文件结构

```
obsidian_manager/
├── opencode.jsonc                    # Opencode 配置
├── config.json                       # Cookie & vault 路径 (gitignored)
├── .opencode/agents/
│   ├── clipper.md                    # KB 摄取工作流（含字幕校验 + 重试）
│   └── reading.md                    # 读书陪读工作流
├── scripts/
│   ├── bili-api.ps1                  # B站 API 核心模块（WBI 签名 + 视频/字幕/评论 API）
│   ├── bili-fetch.ps1                # PowerShell 入口：全量抓取（标题/字幕/AI摘要/评论）
│   ├── bili-clipper.user.js          # Tampermonkey 脚本：B站页面一键抓取到 Obsidian
│   ├── wbi-sign.ps1                  # WBI 签名算法（mixin key + MD5）
│   └── sync-token.ps1                # 自动同步 Obsidian API Token + B站 Cookie
├── templates/
│   └── bilibili-clip.md              # B站剪藏笔记模板参考
├── archive/                          # 历史中间文件（不直接使用）
└── output/                           # 查询/lint 报告 (Agent 写入)
```

## 知识库结构 (vault: `brew`)

```
brew/kb/
├── raw/                              # 原始材料（永不修改）
│   ├── bilibili/                     # B站剪藏 Markdown（{标题前50字}_{BVID}.md）
│   ├── web/                          # 网页剪藏 (Obsidian Web Clipper)
│   └── deepseek/                     # DeepSeek 对话导出
├── wiki/                             # Agent 维护的知识库
│   ├── index.md                      # 总目录（每次 ingest 后更新）
│   ├── log.md                        # 操作日志（纯追加）
│   ├── _schema.md                    # 目录结构 + frontmatter 规范
│   ├── concepts/                     # 概念笔记（跨来源抽取的知识节点）
│   └── sources/                      # 单篇来源摘要
└── outputs/                          # 查询结果 / lint 报告
```

## 前置条件

| 依赖 | 说明 |
|------|------|
| **Obsidian** | vault `brew` 已打开 |
| **Opencode** | TUI 或 Obsidian 插件均可 |
| **B站 Cookie (SESSDATA)** | 用于 Tampermonkey 脚本。打开 B站 → 点 Tampermonkey 图标 → "设置 B站 SESSDATA" → 粘贴 Cookie 值 |
| **Obsidian Local REST API 插件** | Tampermonkey 脚本写入 vault（端口 27124，HTTPS） |
| **Tampermonkey** | 浏览器扩展，运行 bili-clipper.user.js |

## 使用

### B站剪藏 — Tampermonkey（推荐）

1. 打开任意 B站视频页
2. 页面右下角点击 **⬇ KB**
3. 脚本自动抓取标题 → 字幕 → 评论
4. 推送到 Obsidian `kb/raw/bilibili/{标题}_{BVID}.md`
5. 通知 `@clipper` 进行 ingest

### B站剪藏 — PowerShell

```powershell
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-fetch.ps1 -Url "https://www.bilibili.com/video/BVxxx"
# → kb/raw/bilibili/{标题前50}_{BVID}.md → 通知 @clipper ingest
```

### 网页剪藏

安装 [Obsidian Web Clipper](https://obsidian.com/clipper) 浏览器插件 → 配置保存目录为 `kb/raw/web/` → 剪藏后通知 `@clipper` ingest。

### 知识库查询

直接对话提问即可，AI 会自动查询 `kb/wiki/` 综合回答。

## 工作流

| 操作 | 触发 | Agent | 动作 |
|------|------|-------|------|
| **Ingest** | `raw/` 有新文件 | `@clipper` | 校验字幕 → 写来源摘要 → 创建/更新概念页 → 互链 → 更新索引和日志 |
| **Reading** | 开始读书会话 | `@reading` | 读 PDF/EPUB → 章节笔记 → 概念抽取 → 讨论 → 入库 |
| **Query** | 用户提问 | — | 读索引定位相关页 → 综合回答 |

## 技术细节

### 采集架构

```
Tampermonkey (浏览器端)                        PowerShell (命令行)
  │                                              │
  ├─ fetch + credentials:include                ├─ WebRequest + Cookie 头
  ├─ x/player/v2 → 字幕                         ├─ x/player/v2 → 字幕
  ├─ x/v2/reply/main → 评论                     ├─ conclusion/get (WBI) → AI摘要
  └─ PUT Obsidian REST API → vault              └─ 直接写文件 → vault
```

### B站 API 说明

| 接口 | 是否需要 | 是否需要 WBI 签名 |
|------|----------|-------------------|
| `x/web-interface/view` | 视频基本信息 | 否 |
| `x/player/v2` | 字幕（推荐，免 WBI） | **否** |
| `x/player/wbi/v2` | 字幕（备选） | 是 |
| `x/web-interface/view/conclusion/get` | AI 摘要 | 是 |
| `x/v2/reply/main` | 评论 | 否 |

### 字幕校验机制（@clipper Ingest Step 0）

标题中文字符与前 5 条字幕对比，交集 < 10% 则判定内容不匹配 → 询问用户是否重抓 → 最多重试 3 次（间隔 2 秒）。

### 已知限制

| 问题 | 原因 | 现状 |
|------|------|------|
| AI 摘要浏览器端 -403 | SESSDATA SameSite 属性限制跨子域 Cookie 发送 | PowerShell 端可用，浏览器端暂时跳过 |
| 字幕 CDN 偶发内容错乱 | B站 CDN auth_key 时效/缓存问题 | 已加字符重叠校验 + 自动重试兜底 |
| 字幕内容为空 | 视频可能无 AI 字幕 | 脚本静默跳过，`@clipper` 校验前检查 |

## 设计反思 & 经验记录

详见 `docs/lessons.md`。
