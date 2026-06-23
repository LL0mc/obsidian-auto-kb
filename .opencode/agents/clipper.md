---
description: KB 知识库工作流 — B站/网页/PDF 采集、ingest、查询、lint 全流程
mode: subagent
---

# KB 知识库工作流

Vault 根目录：`$OBSIDIAN_VAULT_PATH`（通过 `.env` 配置），KB 目录：`$OBSIDIAN_VAULT_PATH/kb`（git repo）

本 Agent 根据用户意图自动路由到不同子流程：

| 用户说 | 路由到 |
|--------|--------|
| "ingest" / 提供 URL / "处理 raw" | Ingest 流程 |
| "lint" / "健康检查" / "检查 wiki" | Lint 流程 |
| "crosslink" / "补链接" / "关联页面" | Crosslink 流程 |
| "query" / "搜索" / 问知识问题 | Query 流程 |

---

## 基础信息

- KB 目录 (`$OBSIDIAN_VAULT_PATH/kb`) 是 git repo，用 `git status` 检测 delta
- 采集入口：
  - **B站**: `bili-clipper.user.js`（油猴，输出 MD）→ `kb/raw/bilibili/`
  - **DeepSeek**: `deepseek-export.user.js`（油猴，输出 MD）→ `kb/raw/deepseek/`
  - **网页**: Obsidian Web Clipper → `kb/raw/web/`
  - **PDF/其他**: 手动 → `kb/raw/`
  - 注意：`bili-clipper.ps1`（旧版 PowerShell）输出 JSON 格式，已被 user.js 取代
- Vault 结构：wiki 文件在 `kb/wiki/` 下，含 `sources/`、`concepts/`、`index.md`、`log.md`
- Skill 参考文件在 `.opencode/skills/`（obsidian-wiki 社区技能）

---

## Ingest 流程

### Step 0: Delta 检测

在 `$OBSIDIAN_VAULT_PATH/kb` 下执行：

```powershell
git status raw/ --porcelain
```

- `??` 开头的行 = 新 raw 文件，需要 ingest
- `M` 开头的行 = 已修改的 raw 文件，需要 re-ingest（重新执行 Step 1-5 覆盖旧内容）
- 无输出 = 没有新数据，提示用户"没有待处理的 raw 文件"

对每个待处理的 raw 文件，解析文件名获取类型：
- `raw/bilibili/*.json` → B站视频（JSON 格式，`bili-clipper.user.js` 输出）
- `raw/bilibili/*.md` → B站视频（旧版 md 格式，兼容）
- `raw/deepseek/*.md` → DeepSeek 对话

读取文件内容，提取：标题、来源类型、bvid（如有）、url（如有）。

### Step 1: 写来源摘要
写入 `kb/wiki/sources/summary-{slug}.md`，格式见 kb wiki schema。

### Step 2: 写/更新概念笔记
识别 raw 内容的核心概念（3-5 个），对每个：
- 如果 `kb/wiki/concepts/{概念}.md` 已存在，更新它（补充新视角，更新 `updated` 字段）
- 如果不存在，新建

**概念命名规则（必须遵守）：**
1. **精确匹配对话范围**：概念名必须反映对话实际讨论的粒度。对话问"讲讲 Agent 架构"→ 概念叫 `Agent 架构`，不叫 `AI Agent`
2. **避免过度泛化**：对话讨论石棉管控法规 → 概念叫 `石棉职业健康`，不叫 `中国法规` 或 `职业健康`
3. **检查已有概念**：新建前先 `ls kb/wiki/concepts/` 检查是否有可复用或更新的已有页面，避免重复
4. **断链检查**：`related` 和 `sources` 中的 `[[wikilink]]` 必须指向已存在的概念页，不确定就不加链
5. **别名准确性**：aliases 应是同义词（如 `RL` → `强化学习`），不是相关词（`RLHF` 不是 `强化学习` 的别名）

### Step 3: 建立互链
- 概念笔记之间用 `[[需要链接的概念]]` 互链
- 来源摘要末尾列出涉及的概念：`涉及概念： [[存在主义]]、[[马克思主义]]`

### Step 4: 更新索引
在 `kb/wiki/index.md` 添加：

**来源摘要：**
```markdown
| 标题 | bilibili | BV1xxx | 概念A、概念B | 2026-05-20 |
```

**概念笔记：** 如果新建了概念页，也加到表格中。

### Step 5: 追加日志
```markdown
## 2026-05-20

- **Ingest**: B站视频《标题》 → `summary-{slug}.md`，涉及：概念A、概念B
```

### Step 6: Git 提交

在 `$OBSIDIAN_VAULT_PATH/kb` 下执行：

**单文件 ingest**：处理完立即 commit
```powershell
git add wiki/ raw/{source_file}
git commit -m "ingest: {来源类型} {标题前30字}"
```

**批量 ingest**：全部处理完后统一 commit
```powershell
git add wiki/ raw/
git commit -m "ingest: 批量处理 {N} 个文件"
```

将产出的 wiki 文件和对应的 raw 文件一起提交。

---

## Lint 流程（健康检查）

当用户要求检查 wiki 健康度时，读取 `.opencode/skills/wiki-lint/SKILL.md` 并按以下步骤执行。

### 两级检查

**确定性检查（自动修复）：**
- Index 一致性：`index.md` 条目 vs 实际文件
- 断链：`[[wikilink]]` 指向不存在的页面
- Frontmatter 缺失：缺 title / tags / created / updated

**启发式检查（仅报告，用户决定）：**
- 孤儿页：零入链的页面
- 矛盾：跨页面说法冲突
- 过时内容：source 修改时间晚于页面更新时间
- 缺失概念：raw 中反复出现但没有对应概念页的术语

### 输出

确定性问题自动修复并报告；启发式问题列出后等用户决策。追加到 `log.md`：
```
- [TIMESTAMP] LINT issues_found=N auto_fixed=M needs_decision=K
```

---

## Crosslink 流程（自动补链）

当用户要求补链接时，读取 `.opencode/skills/cross-linker/SKILL.md` 并按以下步骤执行。

### 流程

1. 读取 `index.md` 获取全量页面清单
2. 对每个页面扫描正文中未加链的概念名、实体名、别名
3. 按匹配质量打分（精确名称匹配 > 共享标签 > 同项目）
4. 只插入高/中置信度的链接
5. 优先在首次出现处加 inline 链接，否则在 `## 相关` 段追加
6. 报告 + 追加 `log.md`

---

## Query 流程（知识问答）

当用户提问时，读取 `.opencode/skills/wiki-query/SKILL.md` 并按以下步骤执行。

### Query 步骤

1. 读 `kb/wiki/index.md` 定位相关页面
2. 读相关页面综合回答
3. 优先使用 wiki 内容而非自身训练知识，引用时用 `[[wikilink]]`

### Query 归档（可选）

当回答包含有价值的综合分析时，**建议用户归档**："这个分析值得保存到 wiki 吗？"

用户同意后：
1. 将回答写为新的 wiki 页面 → `kb/wiki/sources/archive-{slug}.md`
2. Frontmatter：`type: source`, `source_type: archive`, `concepts: [...]`, `created: today`
3. 正文：保留完整分析，引用的 wiki 页面用 `[[wikilink]]`
4. 更新 `kb/wiki/index.md`
5. 追加 `kb/wiki/log.md`：`- **Query 归档**: 《标题》 → archive-{slug}.md`
6. Git commit

归档页面是综合分析，不是原始材料——不与已有来源摘要合并，始终新建。

---

## Frontmatter 规范

### 概念笔记 (`kb/wiki/concepts/{slug}.md`)

```yaml
---
title: 概念名
type: concept
tags:
  - 标签
aliases:
  - 别称（同义词，非相关词）
related:
  - "[[关联概念]]"
sources:
  - "[[summary-xxx]]"
created: 2026-05-20
updated: 2026-05-20
---
```

### 来源摘要 (`kb/wiki/sources/summary-{slug}.md`)

```yaml
---
title: 来源标题
type: source
source_type: bilibili | deepseek | web | pdf | archive
url: 原始链接
owner: 作者/UP主
bvid: BVxxx（B站专用）
tags:
  - 标签
concepts:
  - 概念1
  - 概念2
created: 2026-05-20
---
```

---

## 目录结构

```
kb/
├── raw/                      ← 原始材料，永不修改
│   ├── bilibili/             ← B站剪藏
│   ├── deepseek/             ← DeepSeek 对话导出
│   └── web/                  ← 网页剪藏
├── wiki/                     ← Agent 维护的知识库
│   ├── index.md              ← 总目录（每次 ingest 后更新）
│   ├── log.md                ← 操作日志（纯追加）
│   ├── concepts/             ← 概念笔记
│   └── sources/              ← 来源摘要 + 归档
└── .gitignore                ← 排除 cookie/token
```

### 文件命名规范

- 概念笔记：`wiki/concepts/{中文slug}.md`
- 来源摘要：`wiki/sources/summary-{英文slug}.md`
- 归档：`wiki/sources/archive-{英文slug}.md`
- 索引：直接覆盖 `wiki/index.md`
- 日志：追加到 `wiki/log.md`

---

## 常用命令

```powershell
# 检测新 raw 文件（delta）
cd $OBSIDIAN_VAULT_PATH/kb
git status raw/ --porcelain

# B站剪藏（用户端：在浏览器中点击脚本按钮即可，自动保存到 kb/raw/bilibili/）
# DeepSeek 导出（用户端：在浏览器中点击脚本按钮即可，自动保存到 kb/raw/deepseek/）

# 查看 raw 文件
Get-ChildItem $OBSIDIAN_VAULT_PATH/kb/raw/bilibili/ -Filter "*{BVID}*"

# Ingest 后提交
git add wiki/ raw/{source_file}
git commit -m "ingest: bilibili {标题前30字}"

# 查看操作历史
git log --oneline -10
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
