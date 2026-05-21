# Obsidian Manager — Personal Knowledge Base Workflow

通用知识库工作流：从多种外部来源采集原材料 → Agent 自动摘要、提取概念、关联 vault → 构建可检索、可链接的个人知识图谱。

## 架构

```
采集入口                         加工层 (Agent)                  知识库 (vault)
┌──────────┐    raw JSON/MD
│ B站剪藏  │ ──────────────────┐
│ (PS脚本) │                   ▼
└──────────┘          ┌──────────────────┐     ┌───────────────┐
                      │                  │     │ wiki/sources/ │
┌──────────┐          │  Agent Ingest    │────▶│  (单篇摘要)    │
│ 网页剪藏 │─────────▶│                  │     ├───────────────┤
│ (WC插件) │          │  1. 读 raw       │     │ wiki/concepts/│
└──────────┘          │  2. 写来源摘要   │────▶│  (概念笔记)    │
                      │  3. 抽概念+建页  │     ├───────────────┤
┌──────────┐          │  4. 互链+索引    │     │ wiki/index.md │
│ PDF/其他 │─────────▶│  5. 追加日志     │────▶│  (总目录)      │
│ (手动)   │          │                  │     ├───────────────┤
└──────────┘          └──────────────────┘     │ wiki/log.md   │
                                               │  (操作日志)    │
                    ┌──────────────────┐       └───────────────┘
                    │  Agent Query     │
                    │  你问我 → 从 wiki │
                    │  综合回答        │
                    └──────────────────┘
```

## 文件结构

```
obsidian_manager/
├── opencode.jsonc              # Opencode 配置
├── config.json                 # Cookie & vault 路径 (gitignored)
├── .opencode/agents/
│   └── clipper.md              # 工作流定义 (采集/ingest/查询/lint)
├── scripts/
│   ├── wbi-sign.ps1            # WBI 签名算法
│   ├── bili-api.ps1            # B站 API 核心模块
│   └── bili-clipper.ps1        # B站剪藏脚本 (输出到 kb/raw/bilibili/)
└── templates/
    └── bilibili-clip.md        # 笔记模板参考
```

## 知识库目录结构 (位于 vault 内)

```
brew/
├── kb/
│   ├── raw/
│   │   ├── bilibili/           # B站剪藏 raw JSON (由 clipper 写入)
│   │   └── web/                # 网页剪藏 (由 Obsidian Web Clipper 写入)
│   ├── wiki/
│   │   ├── index.md            # 总目录 (Agent 维护)
│   │   ├── log.md              # 操作日志 (Agent 维护)
│   │   ├── concepts/           # 概念笔记 (跨来源抽取)
│   │   └── sources/            # 单篇来源摘要
│   └── outputs/                # 查询结果 / lint 报告
└── .opencode/agents/
    └── wiki.md                 # Schema 定义 (目录结构/命名/frontmatter/流程)
```

## 前置条件

| 依赖 | 说明 |
|---|---|
| **Obsidian** | 使用中，vault 已打开 |
| **Bilibili Cookie** | 需登录后提取 SESSDATA |
| **Obsidian Web Clipper** | 浏览器插件，配置保存到 `kb/raw/web/` |

## 安装

### 1. 配置 Cookie

```powershell
# 浏览器 F12 → Console:
document.cookie.split('; ').find(c=>c.startsWith('SESSDATA='))
# 写入 config.json
```

### 2. 配置 Obsidian Web Clipper

插件设置 → 连接本地 vault `D:\notebooks\Lmc\brew` → 默认目录设为 `kb/raw/web/`

## 使用

### B站剪藏

```powershell
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-clipper.ps1 -Url "https://www.bilibili.com/video/BV1wYL36LEvs"
# → kb/raw/bilibili/{bvid}.json → Agent 自动 ingest
```

### 网页剪藏

浏览器点插件图标 → 自动保存到 `kb/raw/web/{title}.md` → 通知 Agent 进行 ingest

### 查询

直接问 Agent，Agent 会读知识库综合回答。

## 工作流

| 操作 | 触发方式 | Agent 执行动作 |
|---|---|---|
| **Ingest** | raw 目录有新文件 | 写来源摘要 → 创建/更新概念页 → 互链 → 更新索引和日志 |
| **Query** | 用户提问 | 读索引定位相关页 → 综合回答 |
| **Lint** | 定期/手动 | 扫全库找矛盾/孤立页/缺失概念/过时信息 |

## 技术细节

### 内容理解的四层降级策略 (B站)

| Layer | 方法 | 接口 | 认证 |
|---|---|---|---|
| 1 | AI 字幕全文转录 + 摘要 | `GET /x/player/v2` → 字幕 JSON | Cookie |
| 2 | B站官方 AI 摘要 | `GET /x/web-interface/view/conclusion/get` | WBI 签名 + Cookie |
| 3 | 弹幕时间轴分析 | `GET /comment.bilibili.com/{cid}.xml` | 无 |
| 4 | 仅元信息 | `GET /x/web-interface/view` | 无 |

### HTTP 客户端

使用 `[System.Net.HttpWebRequest]` 而非 `Invoke-WebRequest`，因为 PowerShell 5.1 的 `Invoke-WebRequest` 会过滤 `Cookie` 头。
