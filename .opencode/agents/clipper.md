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

### Step 3: 返回结果

向用户展示：
- 笔记标题
- 目标 vault 和路径
- 内容来源（AI摘要 / 弹幕分析 / 仅元信息）
- 提示用户可以在 Obsidian 中打开编辑

## 注意事项

- 需要 Bilibili Cookie 才能获取 AI 摘要。如果未配置，会降级为弹幕分析或仅保存元信息
- 如果 Obsidian 未运行，脚本会自动将笔记保存到 `output/` 目录作为 fallback
- 笔记的 `status` 属性默认为 `inbox`，方便后续在 Obsidian 中批量处理
