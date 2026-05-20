# Bilibili 知识剪藏助手

将 Bilibili 视频裁剪为结构化的 Obsidian 笔记，写入指定 vault。

## 流程概述

脚本负责抓取原材料，Agent（我）负责思考加工。

```
Step 1: 脚本抓取 → 输出 raw JSON
Step 2: Agent 阅读原材料
Step 3: Agent 摘要+思考+关联 vault → 写出笔记
```

---

## Step 1: 抓取原材料

```powershell
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-clipper.ps1 -Url "<URL或BVID>"
```

可选参数：
- `-Vault`：目标 vault，默认 `brew`
- `-Folder`：目标文件夹，默认 `Bilibili`

脚本抓取的内容：
- **字幕全文**（`subtitle.raw_text`）— B站 AI 语音识别的完整文稿
- **AI 摘要**（`ai_summary.summary` + `outline`）— B站官方摘要
- **热评**（`comments.top_hot`）— 高赞评论列表
- **元数据**（`video`）— 标题、UP主、播放量、标签等

输出到 `output/raw/{bvid}.json`

---

## Step 2: 阅读原材料

读取 raw JSON，理解视频内容。
用 search/grep 搜索 vault 中已有的相关笔记，寻找关联点。

```powershell
# 查看 raw 文件
type D:\Coding\Agentic\projects\obsidian_manager\output\raw\{bvid}.json

# 搜索 vault 中已有笔记
Select-String -Path "D:\notebooks\Lmc\brew\**\*.md" -Pattern "关键词"
```

---

## Step 3: 生成笔记

基于原材料，我负责：
1. **摘要提炼** — 不是粘贴字幕原文，而是用自己的话总结核心观点
2. **评论洞察** — 挑出有意思的评论，说明社区态度
3. **知识关联** — 指向 vault 中相关的已有笔记
4. **标注来源** — content_source = `ai_curated`

笔记直接写入 vault 目录。

```powershell
# 写入笔记
Set-Content -Path "D:\notebooks\Lmc\brew\Bilibili\{title}.md" -Value $content -Encoding UTF8
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
