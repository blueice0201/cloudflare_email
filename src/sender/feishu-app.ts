import type { MailAsset, ParsedMail } from "../parse";
import type { EmailDocument } from "../model/email";
import { formatMailTime } from "../util/format";

/** 飞书富文本 content 上限 30 KB，留出余量。 */
export const MAX_APP_CONTENT_BYTES = 28 * 1024;
const MAX_IMAGES = 20;
const MAX_FILES = 10;
const SEPARATOR = "---------------";
export const API = "https://open.feishu.cn/open-apis";

type TextNode = { tag: "text"; text: string };
type ImgNode = { tag: "img"; image_key: string };
type LinkNode = { tag: "a"; href: string; text: string };
export type PostParagraph = [TextNode] | [ImgNode] | [LinkNode];

interface FeishuEnvelope {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
  data?: { image_key?: string; file_key?: string; message_id?: string };
}

let tokenCache: { appId: string; token: string; expiresAt: number } | undefined;

export async function sendFeishuApp(args: {
  appId: string;
  appSecret: string;
  chatId: string;
  mail: ParsedMail;
  doc: EmailDocument;
  publicBaseUrl?: string;
}): Promise<void> {
  const token = await tenantAccessToken(args.appId, args.appSecret);
  const assets = args.mail.assets ?? [];
  const imageKeys = new Map<number, string>();
  const files: { filename: string; fileKey: string; downloadUrl: string }[] = [];
  const notes: string[] = [];
  // 正文里引用到的图片（内嵌图片）走图片上传，正文内联展示；其余附件统一走文件上传以获得下载地址。
  const bodyImageIndices = new Set(
    (args.mail.parts ?? []).flatMap((part) => (part.type === "image" ? [part.assetIndex] : [])),
  );
  let imageCount = 0;
  let fileCount = 0;

  for (const [index, asset] of assets.entries()) {
    if (asset.skipReason) {
      notes.push(`${asset.filename}：${asset.skipReason}，未转发`);
      continue;
    }
    if (!asset.bytes?.byteLength) continue;

    if (asset.kind === "image" && bodyImageIndices.has(index)) {
      if (imageCount >= MAX_IMAGES) {
        notes.push(`${asset.filename}：超过单封 ${MAX_IMAGES} 张图片上限，未转发`);
        continue;
      }
      imageKeys.set(index, await uploadImage(token, asset));
      imageCount += 1;
      continue;
    }

    if (fileCount >= MAX_FILES) {
      notes.push(`${asset.filename}：超过单封 ${MAX_FILES} 个文件上限，未转发`);
      continue;
    }
    const fileKey = await uploadFile(token, asset);
    const proxyBase = args.publicBaseUrl ? args.publicBaseUrl.replace(/\/$/, "") : "";
    const downloadUrl = proxyBase
      ? `${proxyBase}/download/${encodeURIComponent(fileKey)}`
      : `${API}/im/v1/files/${fileKey}`;
    files.push({
      filename: asset.filename,
      fileKey,
      downloadUrl,
    });
    fileCount += 1;
  }

  // 「[附件：xxx]」占位符 -> 带下载地址的链接，在正文对应位置替换。
  const attachmentLinks = new Map<string, { name: string; url: string }>();
  for (const file of files) {
    attachmentLinks.set(`[附件：${file.filename}]`, { name: file.filename, url: file.downloadUrl });
  }

  const paragraphs = buildParagraphs(args.doc, imageKeys, notes, attachmentLinks);
  const content = fitAppContent(args.doc.subject, paragraphs);
  const base = await digestId(
    args.mail.messageId || `${args.mail.envelopeFrom}|${args.mail.date}|${args.mail.subject}|${args.mail.rawSize}`,
  );
  const messageId = await sendPost(token, args.chatId, content, base);
  for (const [index, file] of files.entries()) {
    await replyFile(token, messageId, file.fileKey, await digestId(`${base}:file:${index}`));
  }
}

function buildParagraphs(
  doc: EmailDocument,
  imageKeys: ReadonlyMap<number, string>,
  notes: string[],
  attachmentLinks: ReadonlyMap<string, { name: string; url: string }>,
): PostParagraph[] {
  const paragraphs: PostParagraph[] = [];
  const metaLines = [
    `发件人：${doc.from}`,
    `收件人：${doc.to}`,
    `时间：${formatMailTime(doc.date)}`,
  ];
  for (const line of metaLines) paragraphs.push([{ tag: "text", text: line }]);
  paragraphs.push([{ tag: "text", text: SEPARATOR }]);

  for (const block of doc.blocks) {
    switch (block.type) {
      case "paragraph": {
        const link = attachmentLinks.get(block.text);
        if (link) {
          paragraphs.push([{ tag: "a", href: link.url, text: `附件：${link.name}` }]);
        } else {
          paragraphs.push([{ tag: "text", text: block.text }]);
        }
        break;
      }
      case "separator":
        paragraphs.push([{ tag: "text", text: SEPARATOR }]);
        break;
      case "image": {
        const key = block.assetIndex !== undefined ? imageKeys.get(block.assetIndex) : undefined;
        if (key) paragraphs.push([{ tag: "img", image_key: key }]);
        else paragraphs.push([{ tag: "text", text: block.placeholder }]);
        break;
      }
      case "link":
        paragraphs.push([{ tag: "text", text: `[${block.text}](${block.url})` }]);
        break;
      case "heading":
        paragraphs.push([{ tag: "text", text: `# ${block.text}` }]);
        break;
      case "list":
        for (const item of block.items)
          paragraphs.push([{ tag: "text", text: block.ordered ? `1. ${item}` : `· ${item}` }]);
        break;
      case "quote":
        paragraphs.push([{ tag: "text", text: `> ${block.text}` }]);
        break;
      case "table":
        for (const row of block.rows) paragraphs.push([{ tag: "text", text: row.join(" | ") }]);
        break;
    }
  }

  if (notes.some((note) => note.trim())) {
    paragraphs.push([{ tag: "text", text: SEPARATOR }]);
  }
  for (const note of notes) {
    const text = note.trim();
    if (text) paragraphs.push([{ tag: "text", text }]);
  }
  return paragraphs;
}

function fitAppContent(title: string, paragraphs: PostParagraph[]): string {
  const full = renderAppContent(title, paragraphs);
  if (utf8Size(full) <= MAX_APP_CONTENT_BYTES) return full;

  const total = paragraphs.reduce((sum, paragraph) => {
    const node = paragraph[0];
    return sum + (node.tag === "img" ? 0 : [...node.text].length);
  }, 0);
  let low = 0;
  let high = total;
  let best = renderAppContent(title, clipParagraphs(paragraphs, 0));
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = renderAppContent(title, clipParagraphs(paragraphs, mid));
    if (utf8Size(candidate) <= MAX_APP_CONTENT_BYTES) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (utf8Size(best) <= MAX_APP_CONTENT_BYTES) return best;

  const kept = [...paragraphs];
  while (kept.length > 0 && utf8Size(renderAppContent(title, kept)) > MAX_APP_CONTENT_BYTES) {
    let imageAt = -1;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (kept[index]?.[0].tag === "img") {
        imageAt = index;
        break;
      }
    }
    if (imageAt < 0) break;
    kept.splice(imageAt, 1);
  }
  const trimmed = renderAppContent(title, [...kept, [{ tag: "text", text: "部分图片未放入消息" }]]);
  if (utf8Size(trimmed) <= MAX_APP_CONTENT_BYTES) return trimmed;
  return renderAppContent(clip(title, 80) || "(无主题)", [[{ tag: "text", text: "邮件内容过长，仅保留摘要。" }]]);
}

function renderAppContent(title: string, paragraphs: PostParagraph[]): string {
  return JSON.stringify({ zh_cn: { title: title || "(无主题)", content: paragraphs } });
}

function clipParagraphs(paragraphs: PostParagraph[], keep: number): PostParagraph[] {
  let left = keep;
  let marked = false;
  const result: PostParagraph[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph[0].tag !== "text") {
      result.push(paragraph);
      continue;
    }
    const chars = [...paragraph[0].text];
    if (left >= chars.length) {
      if (chars.length > 0) result.push(paragraph);
      left -= chars.length;
      continue;
    }
    if (!marked) {
      const slice = chars.slice(0, left).join("");
      result.push([{ tag: "text", text: slice ? `${slice}\n…（正文已截断）` : "…（正文已截断）" }]);
      marked = true;
    }
    left = 0;
  }
  return result;
}

export async function tenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.appId === appId && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const result = await postJson(`${API}/auth/v3/tenant_access_token/internal`, undefined, {
    app_id: appId,
    app_secret: appSecret,
  });
  const token = result.tenant_access_token;
  if (!token) throw new Error("Feishu app did not return a tenant access token");
  tokenCache = { appId, token, expiresAt: now + (result.expire ?? 7200) * 1000 };
  return token;
}

async function uploadImage(token: string, asset: MailAsset): Promise<string> {
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([bytesOf(asset)], { type: asset.mimeType || "application/octet-stream" }), safeFilename(asset.filename));
  const result = await postForm(`${API}/im/v1/images`, token, form);
  const imageKey = result.data?.image_key;
  if (!imageKey) throw new Error(`Feishu image upload did not return image_key for ${asset.filename}`);
  return imageKey;
}

async function uploadFile(token: string, asset: MailAsset): Promise<string> {
  const filename = safeFilename(asset.filename);
  const form = new FormData();
  form.append("file_type", feishuFileType(filename));
  form.append("file_name", filename);
  form.append("file", new Blob([bytesOf(asset)], { type: asset.mimeType || "application/octet-stream" }), filename);
  const result = await postForm(`${API}/im/v1/files`, token, form);
  const fileKey = result.data?.file_key;
  if (!fileKey) throw new Error(`Feishu file upload did not return file_key for ${asset.filename}`);
  return fileKey;
}

async function sendPost(token: string, chatId: string, content: string, uuid: string): Promise<string> {
  const result = await postJson(`${API}/im/v1/messages?receive_id_type=chat_id`, token, {
    receive_id: chatId,
    msg_type: "post",
    content,
    uuid,
  });
  const messageId = result.data?.message_id;
  if (!messageId) throw new Error("Feishu app did not return a message_id");
  return messageId;
}

async function replyFile(token: string, messageId: string, fileKey: string, uuid: string): Promise<void> {
  await postJson(`${API}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, token, {
    msg_type: "file",
    content: JSON.stringify({ file_key: fileKey }),
    reply_in_thread: false,
    uuid,
  });
}

async function postJson(url: string, token: string | undefined, body: unknown): Promise<FeishuEnvelope> {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return readEnvelope(response);
}

async function postForm(url: string, token: string, body: FormData): Promise<FeishuEnvelope> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });
  return readEnvelope(response);
}

async function readEnvelope(response: Response): Promise<FeishuEnvelope> {
  const text = await response.text();
  let parsed: FeishuEnvelope = {};
  try {
    parsed = JSON.parse(text) as FeishuEnvelope;
  } catch {
    parsed = {};
  }
  if (!response.ok || parsed.code !== 0) {
    const detail = typeof parsed.msg === "string" ? ` ${parsed.msg.slice(0, 200)}` : "";
    throw new Error(`Feishu API failed: HTTP ${response.status}, code ${parsed.code ?? "unknown"}.${detail}`);
  }
  return parsed;
}

function bytesOf(asset: MailAsset): Uint8Array {
  if (!asset.bytes) throw new Error(`Missing bytes for ${asset.filename}`);
  return asset.bytes;
}

function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[\r\n"/\\]/g, "_").slice(0, 120).trim();
  return cleaned || "attachment.bin";
}

function feishuFileType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf" || extension === "doc" || extension === "xls" || extension === "ppt" || extension === "mp4" || extension === "opus") {
    return extension;
  }
  return "stream";
}

async function digestId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clip(value: string, codePoints: number): string {
  return [...value].slice(0, codePoints).join("");
}
