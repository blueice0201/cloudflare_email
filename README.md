<div align="center">

# cf-email2webhook

**The All-in-One Email Router from Cloudflare Email Routing to Feishu, DingTalk & WeCom**

![version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![built with](https://img.shields.io/badge/built%20with-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![license](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)

![Feishu](https://img.shields.io/badge/Feishu-Supported-3370FF?style=for-the-badge)
![DingTalk](https://img.shields.io/badge/DingTalk-Supported-0089FF?style=for-the-badge)
![WeCom](https://img.shields.io/badge/WeCom-Supported-07C160?style=for-the-badge)

**English** · [简体中文](docs/README_zh.md)

[Quick Start](#quick-start) · [Features](#feature-overview) · [Deployment](#deployment) · [License](#license)

</div>

---

With a Cloudflare-managed domain, you can set up custom email forwarding. For example, with domain abc.net, an email sent to test@abc.net is routed through Cloudflare Email Routing to a webhook endpoint. no server, no glue code, no hand-editing config files.

---

## Feature Overview

- Supports 4 delivery modes:
  - `feishu_app`: Feishu custom app, uploads images/files, merges text and images into one message, files sent as message replies.
  - `feishu_webhook`: Feishu custom bot webhook, forwards text only.
  - `dingding_webhook`: DingTalk custom bot webhook, Markdown body, images/attachments shown as placeholders, falls back to text on failure.
  - `wework_webhook`: WeCom group bot webhook, Markdown body, images/attachments shown as placeholders, falls back to text on failure.
- Supports mapping recipient addresses to different webhooks / groups.
- Unified email content model, rendering and sending separated for easy extension to new platforms.

---

## Directory Structure

```text
src/
├── index.ts              # Worker entry: parse email → build unified model → dispatch by DELIVERY_MODE
├── parse.ts              # Email MIME parser, outputs ParsedMail
├── route.ts              # Router: recipient address → target (webhook / group), with URL validation
├── env.ts                # Environment variables and delivery mode type definitions
│
├── model/                # Unified email content model layer
│   ├── email.ts          # EmailDocument / EmailBlock / EmailAttachment types
│   └── builder.ts        # ParsedMail → EmailDocument builder
│
├── render/               # Render layer: unified model → platform message body
│   ├── feishu-webhook.ts # Feishu webhook (post) rendering + signature
│   ├── dingding.ts       # DingTalk markdown / text rendering
│   └── wework.ts         # WeCom markdown / text rendering
│
├── sender/               # Send layer: call platform APIs
│   ├── feishu-app.ts     # Feishu app send (token, upload images/files, post, file reply)
│   ├── feishu-webhook.ts # Feishu webhook send (signature + post)
│   ├── dingding.ts       # DingTalk webhook send
│   └── wework.ts         # WeCom webhook send
│
└── util/                 # Shared utilities
    └── format.ts         # Mail time and other shared formatting helpers

wrangler.jsonc            # Cloudflare Worker configuration and variables
package.json
tsconfig.json
```

### Data Flow

```text
Email Routing email
      │
      ▼
 parse.ts  ──►  ParsedMail
      │
      ▼
 model/builder.ts  ──►  EmailDocument (platform-agnostic)
      │
      ▼
 render/*  ──►  Platform message body
      │
      ▼
 sender/*  ──►  Feishu / DingTalk / WeCom
```

---

## Delivery Modes and Message Types

| Mode | Platform | Message Type | Images / Attachments | Fallback |
|---|---|---|---|---|
| `feishu_app` | Feishu custom app | `post` rich text | Upload images and files, files sent as separate replies | None |
| `feishu_webhook` | Feishu custom bot | `post` | Placeholders only, no upload | None |
| `dingding_webhook` | DingTalk custom bot | `markdown` | Placeholders `[Image: …]` / `[Attachment: …]`, no upload | `text` |
| `wework_webhook` | WeCom group bot | `markdown` | Placeholders `[Image: …]` / `[Attachment: …]`, no upload | `text` |

> Default mode is `feishu_webhook`.

---

## Environment Variables

Configure in `wrangler.jsonc` `vars` (non-sensitive) or in `.dev.vars` / `wrangler secret` (sensitive).

| Variable | Description | Applies to |
|---|---|---|
| `DELIVERY_MODE` | `feishu_app` / `feishu_webhook` / `dingding_webhook` / `wework_webhook`, default `feishu_webhook` | All |
| `FEISHU_APP_ID` | Feishu custom app App ID | `feishu_app` |
| `FEISHU_APP_SECRET` | Feishu custom app App Secret (sensitive) | `feishu_app` |
| `FEISHU_CHAT_ID` | Default group `chat_id` (starts with `oc_`) | `feishu_app` |
| `EMAIL_CHAT_MAP` | Recipient email → group `chat_id` JSON mapping | `feishu_app` |
| `PUBLIC_BASE_URL` | Worker public URL (e.g. `https://xxx.workers.dev`). When set, attachment download links use the Worker's `/download/:fileKey` proxy, downloadable directly in a browser | `feishu_app` |
| `FEISHU_WEBHOOK_URL` | Default Feishu custom bot webhook | `feishu_webhook` |
| `FEISHU_SIGN_SECRET` | Feishu bot signature secret (leave empty to disable signing) | `feishu_webhook` |
| `EMAIL_FEISHU_MAP` | Recipient email → Feishu webhook JSON mapping | `feishu_webhook` |
| `DINGTALK_WEBHOOK_URL` | Default DingTalk custom bot webhook | `dingding_webhook` |
| `DINGTALK_SIGN_SECRET` | DingTalk bot signature secret (leave empty to disable signing) | `dingding_webhook` |
| `EMAIL_DINGTALK_MAP` | Recipient email → DingTalk webhook JSON mapping | `dingding_webhook` |
| `WEWORK_WEBHOOK_URL` | Default WeCom group bot webhook | `wework_webhook` |
| `WEWORK_SIGN_SECRET` | WeCom bot signature secret (leave empty to disable signing) | `wework_webhook` |
| `EMAIL_WEWORK_MAP` | Recipient email → WeCom webhook JSON mapping | `wework_webhook` |

Mapping-type variables can be either an object (written in `wrangler.jsonc` `vars`) or the same JSON string (written in `.dev.vars` or secret).

Example:

```jsonc
"EMAIL_DINGTALK_MAP": {
  "ops@example.com": "https://oapi.dingtalk.com/robot/send?access_token=xxxx"
}
```

### Attachment Download Proxy (`PUBLIC_BASE_URL`)

In `feishu_app` mode, attachments are uploaded to Feishu. When `PUBLIC_BASE_URL` is set, the download links written into the group message point to the Worker's own proxy endpoint:

```text
GET {PUBLIC_BASE_URL}/download/:fileKey
```

The Worker exchanges the Feishu app credentials for a tenant access token and streams the file back, so recipients can open the link in a normal browser without app authorization.

If `PUBLIC_BASE_URL` is left empty, the links use the Feishu OpenAPI file address directly, which requires Feishu app authentication to access.

### Observability

`wrangler.jsonc` enables Cloudflare observability and real-time Issues by default:

```jsonc
"observability": {
  "enabled": true,
  // Real-time Issues: automatically detects and groups recurring errors and exceptions.
  "issues": { "enabled": true }
}
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Variables

Copy a local variable file (for local development only, do not commit to the repository):

```bash
# Create .dev.vars, fill in your real configuration
DELIVERY_MODE=feishu_app
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_CHAT_ID=oc_xxx
# Optional: Worker public URL, enables the attachment download proxy
PUBLIC_BASE_URL=https://cf-email2webhook.xxx.workers.dev
# Optional: bot sign secrets, leave empty when signing is disabled
# FEISHU_SIGN_SECRET=
# DINGTALK_SIGN_SECRET=
# WEWORK_SIGN_SECRET=
```

For production, it is recommended to store sensitive items as secrets:

```bash
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put FEISHU_APP_ID
```

### 3. Local Development

```bash
npm run dev      # wrangler dev
```

> Note: The Email Worker entry is the `email` event; local `wrangler dev` is not convenient for simulating real email delivery directly. After deployment, send a real email to the routed address to verify end-to-end.

### 4. Generate Types (optional)

```bash
npm run typegen  # wrangler types — generate Worker binding types
```

---

## Deployment

### Method 1: Local wrangler deploy

Suitable for direct upload after local development.

```bash
# 1) Log in to Cloudflare on first use
npx wrangler login

# 2) Confirm name / main / vars configuration in wrangler.jsonc is correct
#    - main points to src/index.ts
#    - Non-sensitive variables in vars
#    - Sensitive variables as secrets (see below)

# 3) Set sensitive variables (only needed once, encrypted storage)
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put FEISHU_APP_ID

# 4) Deploy
npm run deploy   # equivalent to wrangler deploy
```

After successful deployment, go to Cloudflare Dashboard to point Email Routing routes to this Worker (see "Email Routing Configuration" below).

> Note: If you write sensitive values like `FEISHU_APP_SECRET` directly in `wrangler.jsonc`, they will enter the version repository with the code; it is recommended to use `wrangler secret put` instead.

### Method 2: Cloudflare Web Deployment

Git integration (Workers Builds, recommended web method)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages**.
3. Select **Create application → Connect to Git** (or go to an existing Worker's **Settings → Build → Connect Git repository**).
4. Authorize and select this repository.
5. Configure build:
   - **Build command**: `npm install`
   - **Deploy command**: `cp wrangler.jsonc.example wrangler.jsonc && npx wrangler deploy`
   - **Root directory**: repository root
6. Add environment variables in **Settings → Variables and Secrets**:
   - Regular variables (e.g. `DELIVERY_MODE`, `FEISHU_WEBHOOK_URL`) use Variables;
   - Sensitive variables (e.g. `FEISHU_APP_SECRET`) use Secrets.
7. After saving, the build is triggered; every push to the corresponding branch will be automatically deployed.

---

## Email Routing Configuration

After Worker deployment, you need to route recipient addresses to this Worker in the Cloudflare backend:

1. Go to **Email → Email Routing**, ensure Email Routing is enabled for your domain (add MX / TXT records as prompted).
2. Go to **Routes** (or **Email Workers**):
   - Add a custom address: e.g. `ops@yourdomain.com` → Action select **Send to a Worker** → select this Worker.
   - Or set a **Catch-all address** → Action select **Send to a Worker** → select this Worker, to receive all unmatched emails.
3. After saving, emails sent to this address will trigger the Worker's `email` event and forward to the corresponding platform by `DELIVERY_MODE`.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
