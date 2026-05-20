# Bilibili 知识剪藏助手

将 Bilibili 视频裁剪为结构化的 Obsidian 笔记，写入指定 vault。

## Usage

用户说"剪藏这个视频"并提供 B站链接时，执行以下流程：

### Step 1: 解析链接

从用户提供的 URL 中提取 BVID（如 `BV1xx...`）。支持的 URL 格式：
- `https://www.bilibili.com/video/BV1xx...`
- `https://b23.tv/xxxxx`（短链接，需先解析）
- 直接提供 `BV1xx...`

### Step 2: 执行剪藏

```powershell
cd D:\Coding\Agentic\projects\obsidian_manager
powershell -File scripts\bili-clipper.ps1 -Url "<用户提供的URL或BVID>"
```

可选参数：
- `-Vault`：目标 vault，默认 `brew`
- `-Folder`：目标文件夹，默认 `读书看报`

#### Step 3: 返回结果

向用户展示：
- 笔记标题
- 目标 vault 和路径
- 内容来源（subtitle+summary / subtitle_only / ai_summary / danmaku / metadata_only）
- 提示用户可以在 Obsidian 中打开编辑

## 退化策略（4层）

脚本按优先级尝试以下内容来源，直到成功：

| 层 | 来源 | 说明 | 依赖 |
|---|---|---|---|
| 1 | **Subtitle + AI Summary** | Player API (`/x/player/v2`) 获取 AI 字幕 URL → 下载字幕 JSON → 转录完整文稿，同时获取 AI 摘要 | Cookie |
| 2 | **Subtitle only** | 有字幕但 AI 摘要不可用时 | Cookie |
| 3 | **AI Summary** | `/x/web-interface/view/conclusion/get`（WBI签名） | Cookie |
| 4 | **Danmaku** | `comment.bilibili.com/{cid}.xml` 弹幕文本 | 无 |
| 5 | **Metadata only** | 仅标题、描述、统计信息 | 无 |

## 注意事项

- 需要 Bilibili Cookie 才能获取字幕和 AI 摘要。如果未配置，会降级为弹幕分析或仅保存元信息
- 字幕数据来自 Bilibili AI 自动识别，可能存在少量错别字
- 笔记的 `status` 属性默认为 `inbox`，方便后续在 Obsidian 中批量处理
- 字幕 URL 带有时间戳认证（`auth_key`），需在获取后立即使用
