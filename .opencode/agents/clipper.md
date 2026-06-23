---
description: KB 知识库工作流 — B站/网页/PDF 采集、ingest、查询、lint 全流程
mode: subagent
---

# KB 知识库工作流

Vault 根目录：`$OBSIDIAN_VAULT_PATH`（通过 `.env` 配置），KB 目录：`$OBSIDIAN_VAULT_PATH/kb`（git repo）

## 前置规则

**所有页面模板、frontmatter 规范、目录结构以 `$HOME/.agents/skills/llm-wiki/SKILL.md` 为准。** 本文件只记录本项目的差异和扩展。

---

## 路由

| 用户说 | 路由到 |
|--------|--------|
| "ingest" / 提供 URL / "处理 raw" | Ingest 流程 |
| "lint" / "健康检查" / "检查 wiki" | 读取 `.opencode/skills/wiki-lint/SKILL.md` 执行 |
| "crosslink" / "补链接" / "关联页面" | 读取 `.opencode/skills/cross-linker/SKILL.md` 执行 |
| "query" / "搜索" / 问知识问题 | 读取 `.opencode/skills/wiki-query/SKILL.md` 执行 |

---

## 采集入口

| 来源 | 工具 | 输出位置 |
|------|------|---------|
| B站 | `bili-clipper.user.js`（油猴，输出 MD） | `kb/raw/bilibili/` |
| DeepSeek | `deepseek-export.user.js`（油猴，输出 MD） | `kb/raw/deepseek/` |
| 网页 | Obsidian Web Clipper | `kb/raw/web/` |
| PDF/其他 | 手动 | `kb/raw/` |

> `bili-clipper.ps1`（旧版 PowerShell）输出 JSON，已被 user.js 取代。

---

## Ingest 流程

### Step 0: Delta 检测

在 `$OBSIDIAN_VAULT_PATH/kb` 下执行 `git status raw/ --porcelain`：

- `??` = 新 raw 文件 → ingest
- `M` = 已修改 → re-ingest（重新执行 Step 1-5 覆盖）
- 无输出 = 没有新数据

### Step 1: 写来源摘要

写入 `kb/wiki/sources/summary-{slug}.md`。**页面模板见 llm-wiki skill 的 Page Template。**

### Step 2: 写/更新概念笔记

识别核心概念（3-5 个），创建或更新 `kb/wiki/concepts/{概念}.md`。

**概念命名规则（本项目扩展）：**
1. **精确匹配粒度** — 概念名必须反映对话实际讨论的范围
2. **避免过度泛化** — 用具体限定词（`石棉职业健康` ≠ `职业健康`）
3. **检查已有概念** — 新建前先检查是否可复用
4. **断链检查** — `[[wikilink]]` 必须指向已存在的页面
5. **别名准确性** — aliases 是同义词，不是相关词

### Step 3: 建立互链

- 概念笔记之间用 `[[wikilink]]` 互链
- 来源摘要末尾：`涉及概念：[[概念A]]、[[概念B]]`

### Step 4: 更新索引

更新 `kb/wiki/index.md`（格式见 llm-wiki skill 的 Special Files）。

### Step 5: 追加日志

追加到 `kb/wiki/log.md`（格式见 llm-wiki skill 的 Special Files）。

### Step 6: Git 提交

- **单文件**：处理完立即 `git add wiki/ raw/{source_file} && git commit`
- **批量**：全部处理完后 `git add wiki/ raw/ && git commit`

---

## Query 归档（本项目扩展）

当回答包含有价值的综合分析时，建议用户归档。用户同意后：
1. 写为 `kb/wiki/sources/archive-{slug}.md`
2. Frontmatter: `type: source, source_type: archive`
3. 正文保留完整分析，引用用 `[[wikilink]]`
4. 更新 index + log，git commit

归档页面始终新建，不与已有来源摘要合并。

---

## Lint 分级（本项目扩展）

读取 `.opencode/skills/wiki-lint/SKILL.md` 执行，区分两级：
- **确定性**（自动修）：index 一致性、断链、frontmatter 缺失
- **启发式**（仅报告）：矛盾、孤儿、过时

---

## 本项目 vs Skill 的差异汇总

| 维度 | Skill (llm-wiki) | 本项目覆盖 |
|------|-----------------|-----------|
| `summary:` 字段 | 必填（≤200 chars） | ✅ 已写入 skill，需在 ingest 时执行 |
| `category:` 字段 | 必填 | 用 `type:` 替代（clipper 扩展） |
| `provenance:` 块 | 定义但未强制 | 暂不执行，等 wiki 规模增大 |
| `^[inferred]` 标记 | Core Principle #4 | 暂不执行 |
| `## Open Questions` | Page Template 要求 | 暂不执行 |
| index.md 格式 | 列表 | 表格（信息更丰富） |
| log.md 格式 | key=value | 叙事体（更易读） |
| 时间戳精度 | ISO 8601 | 仅日期 |
