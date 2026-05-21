---
description: KB 知识库工作流 — B站/网页/PDF 采集、ingest、查询、lint 全流程
mode: subagent
---

# KB 知识库工作流

## 架构

```
bili-clipper.ps1  →  kb/raw/bilibili/{bvid}.json  →  Agent Ingest
                                                        ↓
                                              kb/wiki/sources/
                                              kb/wiki/concepts/
                                              kb/wiki/index.md
                                              kb/wiki/log.md
```

采集入口：
- **B站**: `bili-clipper.ps1` → `kb/raw/bilibili/`
- **网页**: Obsidian Web Clipper → `kb/raw/web/`
- **PDF/其他**: 手动 → `kb/raw/`

---

## Ingest 流程（每笔新 raw 数据触发）

读取 raw JSON 后，执行以下步骤：

### 1. 写来源摘要
写入 `kb/wiki/sources/summary-{slug}.md`，格式见 kb wiki schema。

### 2. 写/更新概念笔记
识别 raw 内容的核心概念（3-5 个），对每个：
- 如果 `kb/wiki/concepts/{概念}.md` 已存在，更新它（补充新视角，更新 `updated` 字段）
- 如果不存在，新建

### 3. 建立互链
- 概念笔记之间用 `[[需要链接的概念]]` 互链
- 来源摘要末尾列出涉及的概念：`涉及概念： [[存在主义]]、[[马克思主义]]`

### 4. 更新索引
在 `kb/wiki/index.md` 添加：

**来源摘要：**
```markdown
| 标题 | bilibili | BV1xxx | 概念A、概念B | 2026-05-20 |
```

**概念笔记：** 如果新建了概念页，也加到表格中。

### 5. 追加日志
```markdown
## 2026-05-20

- **Ingest**: B站视频《标题》 → `summary-{slug}.md`，涉及：概念A、概念B
```

---

## 常用命令

```powershell
# B站剪藏
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-clipper.ps1 -Url "<URL>"
# 默认输出到 kb/raw/bilibili/{bvid}.json

# 查看 raw JSON
type D:\notebooks\Lmc\brew\kb\raw\bilibili\{bvid}.json

# 搜索 vault 已有笔记
Select-String -Path "D:\notebooks\Lmc\brew\**\*.md" -Pattern "关键词"
```

---

## 退化策略

脚本负责的抓取层：

| 层 | 内容 | 依赖 |
|---|---|---|
| 1 | AI 字幕全文 | Cookie |
| 2 | AI 摘要 | Cookie |
| 3 | 热评 | Cookie |
| 4 | 弹幕 | 无 |
| 5 | 仅元数据 | 无 |

Agent 负责的思考层：

| 内容 | 说明 |
|---|---|
| 摘要提炼 | 我读原文后用自己的话总结 |
| 评论洞察 | 挑高赞评论，归纳社区反应 |
| 知识关联 | 搜索 vault 中相关主题 |
| 笔记风格 | 结构化、可读、有洞见 |
