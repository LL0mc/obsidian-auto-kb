# Obsidian Manager — Personal Knowledge Base Workflow

从多种外部来源采集内容 → Agent 自动摘要、提取概念、写入 Obsidian vault → 构建可检索、可链接的个人知识图谱。

## Agents

位于 `.opencode/agents/`，在对话中用 `@agent_name` 触发：

| Agent | 功能 |
|-------|------|
| **`@clipper`** | KB 知识库摄取 — 读取 `kb/raw/` 中的原始材料 → 写来源摘要 → 创建/更新概念笔记 → 更新索引和日志 |
| **`@reading`** | 哲学读书陪读 — 读 PDF/EPUB，三种模式（章节推进、段落讨论、全书回顾），整理笔记到 KB |

## 项目文件结构

```
obsidian_manager/
├── opencode.jsonc                    # Opencode 配置
├── config.json                       # Cookie & vault 路径 (gitignored)
├── .opencode/agents/
│   ├── clipper.md                    # KB 摄取工作流
│   └── reading.md                    # 读书陪读工作流
├── scripts/
│   ├── bili-api.ps1                  # B站 API 核心模块
│   ├── bili-clipper.ps1              # B站剪藏脚本 (输出到 kb/raw/bilibili/)
│   ├── wbi-sign.ps1                  # WBI 签名算法
│   └── deepseek-export.user.js       # Tampermonkey 脚本：DeepSeek 对话导出
├── templates/
│   └── bilibili-clip.md              # B站剪藏笔记模板参考
├── archive/                          # 历史中间文件（不直接使用）
└── output/                           # 查询/lint 报告 (Agent 写入)
```

## 知识库结构 (vault: `brew`)

```
brew/kb/
├── raw/                              # 原始材料（永不修改）
│   ├── bilibili/                     # B站剪藏 raw JSON
│   ├── web/                          # 网页剪藏 (Obsidian Web Clipper)
│   └── deepseek/                     # DeepSeek 对话导出 (Tampermonkey → Local REST API)
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
| **Bilibili Cookie** | 需登录后提取 SESSDATA（用于 B站剪藏） |
| **Obsidian Local REST API 插件** | 让 Tampermonkey 脚本直接写入 vault（端口 27124） |
| **Tampermonkey** | 浏览器扩展，运行 DeepSeek 导出脚本 |

## 使用

### DeepSeek 对话导出

1. 打开 DeepSeek 任意对话页面（`https://chat.deepseek.com/a/chat/s/xxx`）
2. 页面左下角点击 **📝 Export**
3. 文件自动保存到 `kb/raw/deepseek/`
4. 通知 `@clipper` 进行 ingest

### B站剪藏

```powershell
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-clipper.ps1 -Url "https://www.bilibili.com/video/BVxxx"
# → kb/raw/bilibili/{bvid}.json → 通知 @clipper ingest
```

### 网页剪藏

安装 [Obsidian Web Clipper](https://obsidian.com/clipper) 浏览器插件 → 配置保存目录为 `kb/raw/web/` → 剪藏后通知 `@clipper` ingest。

### 知识库查询

直接对话提问即可，AI 会自动查询 `kb/wiki/` 综合回答。

## 工作流

| 操作 | 触发 | Agent | 动作 |
|------|------|-------|------|
| **Ingest** | `raw/` 有新文件 | `@clipper` | 读 raw → 写来源摘要 → 创建/更新概念页 → 互链 → 更新索引和日志 |
| **Reading** | 开始读书会话 | `@reading` | 读 PDF/EPUB → 章节笔记 → 概念抽取 → 讨论 → 入库 |
| **Query** | 用户提问 | — | 读索引定位相关页 → 综合回答 |

## 技术细节

### B站内容降级策略

| Layer | 内容 | 依赖 |
|-------|------|------|
| 1 | AI 字幕全文 + 摘要 | Cookie |
| 2 | B站官方 AI 摘要 | WBI 签名 + Cookie |
| 3 | 弹幕分析 | 无 |
| 4 | 仅元数据 | 无 |

### DeepSeek 导出技术栈

```
Tampermonkey script (deepseek-export.user.js)
  → 提取对话消息 (User/Assistant 分离)
  → HTML → Markdown 转换 (内联转换器，零外部依赖)
  → POST Obsidian Local REST API (https://127.0.0.1:27124/vault/kb/raw/deepseek/...)
  → 文件落盘 → @clipper ingest
```
