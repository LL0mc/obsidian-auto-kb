# Obsidian Manager — Bilibili Knowledge Clipper

将 Bilibili 视频裁剪为结构化 Obsidian 笔记，实现外部知识到个人知识库的自动化录入。

## 架构

```
你: "剪藏这个视频 BV1L94y1H7CV"
     │
     ▼
┌──────────────────────────────────────────────────┐
│  Opencode Subagent (clipper)                     │
│  .opencode/agents/clipper.md                     │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  bili-clipper.ps1 — 主编排脚本                   │
│                                                   │
│  [1/4] 解析视频 ID                                │
│  [2/4] 获取视频信息 (Get-VideoInfo)               │
│  [3/4] 内容理解 (三层降级策略)                     │
│    ├─ Layer 1: B站官方 AI 摘要                    │
│    │   GET /x/web-interface/view/conclusion/get   │
│    │   (需 WBI 签名 + Cookie)                     │
│    ├─ Layer 2: 弹幕分析 (降级)                    │
│    │   GET /comment.bilibili.com/{cid}.xml        │
│    └─ Layer 3: 元信息 (仅标题/简介)               │
│  [4/4] 格式化笔记 → Obsidian CLI 写入 vault       │
└──────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Obsidian vault                                   │
│  brew / Bilibili / {视频标题}.md                  │
└──────────────────────────────────────────────────┘
```

## 文件结构

```
obsidian_manager/
├── opencode.jsonc              # Opencode 配置
├── config.json                 # Cookie & vault 配置
├── .opencode/agents/
│   └── clipper.md              # Opencode Subagent 定义
├── scripts/
│   ├── wbi-sign.ps1            # WBI 签名算法 (MixinKey + MD5)
│   ├── bili-api.ps1            # B站 API 核心模块
│   └── bili-clipper.ps1        # 剪藏主脚本
├── templates/
│   └── bilibili-clip.md        # 笔记模板参考
└── output/                     # Obsidian 离线时的降级目录
```

## 前置条件

| 依赖 | 说明 |
|---|---|
| **Obsidian CLI** | `D:\Coding\Obsidian\Obsidian\Obsidian.com` (已安装) |
| **Obsidian** | 使用中，vault 已打开 |
| **Bilibili Cookie** | 需登录后提取 SESSDATA |

## 安装

### 1. 配置 Cookie

Bilibili 的 AI 摘要接口需要登录态。提取方式：

1. 浏览器打开 `bilibili.com` → 登录
2. F12 → 控制台 (Console) → 粘贴:
   ```javascript
   document.cookie.split('; ').find(c=>c.startsWith('SESSDATA='))
   ```
3. 复制输出的完整值
4. 写入 `config.json`:
   ```json
   {
     "bilibili_cookie": "SESSDATA=你的值",
     "default_vault": "brew",
     "default_folder": "Bilibili"
   }
   ```

### 2. 确认 Vault 路径

`config.json` 中已配置两个 vault：

| Vault | 路径 |
|---|---|
| brew | `D:\notebooks\Lmc\brew` |
| escalator | `D:\notebooks\Work\escalator` |

## 使用

### 对话式 (通过 Opencode)

```
你: "剪藏这个视频 https://www.bilibili.com/video/BV1L94y1H7CV"
Agent: → 解析BVID → 获取视频信息 → AI摘要 → 写入 brew/Bilibili/{title}.md ✓
```

### 命令行

```powershell
# 基本用法 (默认写入 brew vault/Bilibili 目录)
powershell -File scripts\bili-clipper.ps1 -Url "BV1L94y1H7CV"

# 指定 vault 和目录
powershell -File scripts\bili-clipper.ps1 -Url "BV1L94y1H7CV" -Vault brew -Folder "自媒体"

# 粘贴完整 URL
powershell -File scripts\bili-clipper.ps1 -Url "https://www.bilibili.com/video/BV1L94y1H7CV"
```

### 环境变量 (替代 config.json)

```powershell
$env:BILI_COOKIE = "SESSDATA=xxx"
powershell -File scripts\bili-clipper.ps1 -Url "BVxxx"
```

## 生成的笔记格式

每条剪藏笔记包含：

```yaml
---
title: 中文怎么就退化成这样了？？？
source: bilibili
url: https://www.bilibili.com/video/BV1L94y1H7CV
bvid: BV1L94y1H7CV
uploader: 黄一刀
uploader_id: 297242063
category: 
duration: 5m58s
date: 2026-05-20
views: 3817480
likes: 145229
content_source: ai_summary    # ai_summary | danmaku | metadata_only
status: inbox
tags:
  - bilibili
  - clip
---
```

笔记正文包含：简介、AI 全文总结、分段提纲（带时间戳）、AI 字幕、自定义笔记区、相关链接。

## 技术细节

### 内容理解的三层降级策略

| Layer | 方法 | 接口 | 认证 | 成功率 |
|---|---|---|---|---|
| 1 | B站官方 AI 摘要 | `GET /x/web-interface/view/conclusion/get` | WBI 签名 + Cookie | 高 (有语音的视频) |
| 2 | 弹幕时间轴分析 | `GET /comment.bilibili.com/{cid}.xml` | 无 | 中 (热门视频) |
| 3 | 仅元信息 | `GET /x/web-interface/view` | 无 | 100% |

### WBI 签名

Bilibili 的部分 API 需要 WBI 签名鉴权。算法在 `scripts/wbi-sign.ps1` 中实现：

1. 从 nav 接口获取 `img_key` + `sub_key` (每日更新)
2. 用预定义混淆表混合得到 `mixin_key`
3. 对请求参数排序 + URL 编码后与 mixin_key 拼接
4. MD5 摘要作为 `w_rid`，连同时间戳 `wts` 一起发送

### HTTP 客户端

使用 `[System.Net.HttpWebRequest]` 而非 `Invoke-WebRequest`，因为 PowerShell 5.1 的 `Invoke-WebRequest` 会过滤 `Cookie` 头。

## 测试数据

在开发过程中生成的测试笔记：

| 视频 | BVID | 测试结果 |
|---|---|---|
| 【MV】保加利亚妖王AZIS视频合辑 | `BV17x411w7KC` | 1200 条弹幕分析 ✓ |
| 中文怎么就退化成这样了？？？ | `BV1L94y1H7CV` | AI 摘要 19 行 ✓ |

测试笔记位于 `brew/Bilibili/` 目录。

## 路线图

- [x] 项目骨架 & Agent 定义
- [x] WBI 签名算法
- [x] B站视频元信息获取
- [x] AI 摘要 (Layer 1)
- [x] 弹幕分析 (Layer 2)
- [x] Obsidian CLI 写入
- [ ] 播客剪藏 (RSS / Show Notes 解析)
- [ ] 豆瓣剪藏 (书/电影元数据抓取)
- [ ] Obsidian 社区插件化
- [ ] Vault 健康检查 Agent
- [ ] 日常写作工作流 Agent
