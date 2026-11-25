<div align="center">

# cf-email2webhook

**把 Cloudflare Email Routing 邮件一键转发到飞书、钉钉、企业微信的全能路由器**

![version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![built with](https://img.shields.io/badge/built%20with-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![license](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)

![飞书](https://img.shields.io/badge/%E9%A3%9E%E4%B9%A6-%E5%B7%B2%E6%94%AF%E6%8C%81-3370FF?style=for-the-badge)
![钉钉](https://img.shields.io/badge/%E9%92%89%E9%92%89-%E5%B7%B2%E6%94%AF%E6%8C%81-0089FF?style=for-the-badge)
![企业微信](https://img.shields.io/badge/%E4%BC%81%E4%B8%9A%E5%BE%AE%E4%BF%A1-%E5%B7%B2%E6%94%AF%E6%8C%81-07C160?style=for-the-badge)

[English](../README.md) · **简体中文**

[快速开始](#快速开始) · [功能概览](#功能概览) · [部署方式](#部署方式) · [许可证](#许可证)

</div>

---

配合 Cloudflare 代管的域名，可以实现自定义邮箱的转发功能。例如，自定义域名 abc.net，邮件发送到 test@abc.net，通过 Cloudflare Email Routing 功能，转发到 webhook 地址中。
无需服务器、无需粘合代码、无需手写配置文件。
---

## 功能概览

- 支持 4 种投递模式：
  - `feishu_app`：飞书自建应用，上传图片/文件，正文与图片合成一条消息，文件作为消息回复。
  - `feishu_webhook`：飞书自定义机器人 Webhook，只转发文本。
  - `dingding_webhook`：钉钉自定义机器人 Webhook，Markdown 正文，图片/附件显示为占位符，发送失败降级为 text。
  - `wework_webhook`：企业微信群机器人 Webhook，Markdown 正文，图片/附件显示为占位符，发送失败降级为 text。
- 支持按收件地址映射到不同的 Webhook / 群。
- 统一的邮件内容模型，渲染与发送分离，便于扩展新平台。

---

## 架构目录

```text
src/
├── index.ts              # Worker 入口：解析邮件 → 构建统一模型 → 按 DELIVERY_MODE 分发
├── parse.ts              # 邮件 MIME 解析器，输出 ParsedMail
├── route.ts              # 路由：收件地址 → 目标（Webhook / 群），含 URL 校验
├── env.ts                # 环境变量与投递模式类型定义
│
├── model/                # 统一邮件内容模型层
│   ├── email.ts          # EmailDocument / EmailBlock / EmailAttachment 类型
│   └── builder.ts        # ParsedMail → EmailDocument 的构建器
│
├── render/               # 渲染层：统一模型 → 平台消息体
│   ├── feishu-webhook.ts # 飞书 Webhook（post）渲染 + 签名
│   ├── dingding.ts       # 钉钉 markdown / text 渲染
│   └── wework.ts         # 企业微信 markdown / text 渲染
│
├── sender/               # 发送层：调用各平台接口
│   ├── feishu-app.ts     # 飞书应用发送（token、上传图片/文件、post、文件回复）
│   ├── feishu-webhook.ts # 飞书 Webhook 发送（签名 + post）
│   ├── dingding.ts       # 钉钉 Webhook 发送
│   └── wework.ts         # 企业微信 Webhook 发送
│
└── util/                 # 公共工具
    └── format.ts         # 邮件时间等共享格式化工具

wrangler.jsonc            # Cloudflare Worker 配置与变量
package.json
tsconfig.json
```

### 数据流

```text
Email Routing 邮件
      │
      ▼
 parse.ts  ──►  ParsedMail
      │
      ▼
 model/builder.ts  ──►  EmailDocument（平台无关）
      │
      ▼
 render/*  ──►  平台消息体
      │
      ▼
 sender/*  ──►  飞书 / 钉钉 / 企业微信
```

---

## 投递模式与消息类型

| 模式 | 平台 | 消息类型 | 图片 / 附件 | 降级 |
|---|---|---|---|---|
| `feishu_app` | 飞书自建应用 | `post` 富文本 | 上传图片与文件，文件单独回复 | 无 |
| `feishu_webhook` | 飞书自定义机器人 | `post` | 仅占位符，不上传 | 无 |
| `dingding_webhook` | 钉钉自定义机器人 | `markdown` | 占位符 `[图片：…]` / `[附件：…]`，不上传 | `text` |
| `wework_webhook` | 企业微信群机器人 | `markdown` | 占位符 `[图片：…]` / `[附件：…]`，不上传 | `text` |

> 默认模式为 `feishu_webhook`。

---

## 环境变量

在 `wrangler.jsonc` 的 `vars` 中配置（非敏感项），或在 `.dev.vars` / `wrangler secret` 中配置（敏感项）。

| 变量 | 说明 | 适用模式 |
|---|---|---|
| `DELIVERY_MODE` | `feishu_app` / `feishu_webhook` / `dingding_webhook` / `wework_webhook`，缺省为 `feishu_webhook` | 全部 |
| `FEISHU_APP_ID` | 飞书自建应用 App ID | `feishu_app` |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret（敏感） | `feishu_app` |
| `FEISHU_CHAT_ID` | 默认群 `chat_id`（`oc_` 开头） | `feishu_app` |
| `EMAIL_CHAT_MAP` | 收件邮箱 → 群 `chat_id` 的 JSON 映射 | `feishu_app` |
| `PUBLIC_BASE_URL` | Worker 对外地址（如 `https://xxx.workers.dev`）。设置后附件下载链接走本站 `/download/:fileKey` 代理，浏览器可直接下载 | `feishu_app` |
| `FEISHU_WEBHOOK_URL` | 飞书自定义机器人默认 Webhook | `feishu_webhook` |
| `FEISHU_SIGN_SECRET` | 飞书机器人签名密钥（留空则不做加签） | `feishu_webhook` |
| `EMAIL_FEISHU_MAP` | 收件邮箱 → 飞书 Webhook 的 JSON 映射 | `feishu_webhook` |
| `DINGTALK_WEBHOOK_URL` | 钉钉自定义机器人默认 Webhook | `dingding_webhook` |
| `DINGTALK_SIGN_SECRET` | 钉钉机器人签名密钥（留空则不做加签） | `dingding_webhook` |
| `EMAIL_DINGTALK_MAP` | 收件邮箱 → 钉钉 Webhook 的 JSON 映射 | `dingding_webhook` |
| `WEWORK_WEBHOOK_URL` | 企业微信群机器人默认 Webhook | `wework_webhook` |
| `WEWORK_SIGN_SECRET` | 企业微信机器人签名密钥（留空则不做加签） | `wework_webhook` |
| `EMAIL_WEWORK_MAP` | 收件邮箱 → 企业微信 Webhook 的 JSON 映射 | `wework_webhook` |

映射类变量既可以是对象（写在 `wrangler.jsonc` 的 `vars`），也可以是同一份 JSON 字符串（写在 `.dev.vars` 或 secret）。

示例：

```jsonc
"EMAIL_DINGTALK_MAP": {
  "ops@example.com": "https://oapi.dingtalk.com/robot/send?access_token=xxxx"
}
```

### 附件下载代理（`PUBLIC_BASE_URL`）

在 `feishu_app` 模式下，附件会上传到飞书。当设置了 `PUBLIC_BASE_URL` 时，群消息中的下载链接会指向 Worker 自己的代理接口：

```text
GET {PUBLIC_BASE_URL}/download/:fileKey
```

Worker 用飞书应用凭证换取 tenant access token 后将文件流式返回，收件人用普通浏览器即可打开链接，无需应用鉴权。

若 `PUBLIC_BASE_URL` 留空，链接为飞书 OpenAPI 文件地址，访问时需飞书应用鉴权。

### 可观测性（Observability）

`wrangler.jsonc` 默认开启 Cloudflare 可观测性与实时 Issues：

```jsonc
"observability": {
  "enabled": true,
  // 实时 Issues（问题）：自动检测并分组重复出现的错误与异常。
  "issues": { "enabled": true }
}
```

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置变量

复制一份本地变量文件（仅本地开发使用，不要提交到仓库）：

```bash
# 创建 .dev.vars，填入你的真实配置
DELIVERY_MODE=feishu_app
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_CHAT_ID=oc_xxx
# 可选：Worker 对外地址，启用附件下载代理
PUBLIC_BASE_URL=https://cf-email2webhook.xxx.workers.dev
# 可选：机器人签名密钥，未开启签名校验时留空
# FEISHU_SIGN_SECRET=
# DINGTALK_SIGN_SECRET=
# WEWORK_SIGN_SECRET=
```

生产环境建议把敏感项用 secret 保存：

```bash
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put FEISHU_APP_ID
```

### 3. 本地开发

```bash
npm run dev      # wrangler dev
```

> 说明：Email Worker 的入口是 `email` 事件，本地 `wrangler dev` 不方便直接模拟真实邮件投递，部署后向路由地址发送真实邮件即可进行端到端验证。

### 4. 生成类型（可选）

```bash
npm run typegen  # wrangler types —— 生成 Worker 绑定类型
```

---

## 部署方式

### 方式一：本地 wrangler 部署（deploy）

适合本地开发后直接上传。

```bash
# 1) 首次使用需登录 Cloudflare
npx wrangler login

# 2) 确认 wrangler.jsonc 中的 name / main / vars 配置正确
#    - main 指向 src/index.ts
#    - 非敏感变量写在 vars
#    - 敏感变量用 secret（见下）

# 3) 设置敏感变量（只需一次，会加密保存）
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put FEISHU_APP_ID

# 4) 部署上传
npm run deploy   # 等价于 wrangler deploy
```

部署成功后，到 Cloudflare Dashboard 把 Email Routing 的路由指向该 Worker（见下文「Email Routing 配置」）。

> 注意：`wrangler.jsonc` 里若直接写了 `FEISHU_APP_SECRET` 等敏感值，会随代码进入版本库，建议改用 `wrangler secret put`。

### 方式二：Cloudflare 网页部署

Git 集成（Workers Builds，推荐网页方式）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages**。
3. 选择 **Create application → Connect to Git**（或进入已有 Worker 的 **Settings → Build → Connect Git repository**）。
4. 授权并选择本仓库。
5. 配置构建：
   - **Build command**：`npm install`
   - **Deploy command**：`cp wrangler.jsonc.example wrangler.jsonc && npx wrangler deploy`
   - **Root directory**：仓库根目录
6. 在 **Settings → Variables and Secrets** 中添加环境变量：
   - 普通变量（如 `DELIVERY_MODE`、`FEISHU_WEBHOOK_URL`）用 Variables；
   - 敏感变量（如 `FEISHU_APP_SECRET`）用 Secrets。
7. 保存后触发构建，每次 push 到对应分支会自动部署。

---

## Email Routing 配置

Worker 部署后，需要在 Cloudflare 后台把收件地址路由到该 Worker：

1. 进入 **Email → Email Routing**，确保域名已启用 Email Routing（按提示添加 MX / TXT 记录）。
2. 进入 **Routes**（或 **Email Workers**）：
   - 添加自定义地址：如 `ops@yourdomain.com` → Action 选择 **Send to a Worker** → 选择本 Worker。
   - 或设置 **Catch-all address** → Action 选择 **Send to a Worker** → 选择本 Worker，接收所有未匹配地址的邮件。
3. 保存后，发往该地址的邮件会触发 Worker 的 `email` 事件，按 `DELIVERY_MODE` 转发到对应平台。

---

## 许可证

本项目基于 [Apache License 2.0](../LICENSE) 开源协议。