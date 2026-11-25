import PostalMime, { decodeWords } from "postal-mime";
import type { Address, Attachment } from "postal-mime";

/** webhook 模式超过该大小不再解析 MIME，避免大附件占满 Worker 内存。 */
export const MAX_PARSE_BYTES = 5 * 1024 * 1024;
/** 应用模式按飞书文件上限放宽，仍跳过单附件超限的部分。 */
export const MAX_APP_PARSE_BYTES = 25 * 1024 * 1024;
/** 内嵌图小于该大小时视为统计像素，不上传。 */
export const TRACKING_PIXEL_BYTES = 2 * 1024;

export interface MailAttachment {
  filename: string;
  mimeType: string;
  size: number;
}

export interface MailAsset {
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  kind: "image" | "file";
  bytes?: Uint8Array;
  skipReason?: string;
}

export type BodyPart = { type: "text"; text: string } | { type: "image"; assetIndex: number };

export interface ParsedMail {
  subject: string;
  from: string;
  envelopeFrom: string;
  envelopeTo: string;
  date: string;
  messageId: string;
  text: string;
  attachments: MailAttachment[];
  assets: MailAsset[];
  parts: BodyPart[];
  oversized: boolean;
  rawSize: number;
}

export interface InboundEmail {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
}

export interface ParseOptions {
  /** 保留图片和附件字节，并按正文顺序生成 parts。用于 feishu_app。 */
  keepBytes?: boolean;
}

export async function parseEmail(message: InboundEmail, options: ParseOptions = {}): Promise<ParsedMail> {
  const envelopeFrom = message.from;
  const envelopeTo = message.to;
  const rawSize = message.rawSize;
  const messageId = message.headers.get("message-id") ?? "";
  const keepBytes = options.keepBytes === true;
  const limit = keepBytes ? MAX_APP_PARSE_BYTES : MAX_PARSE_BYTES;

  if (rawSize > limit) {
    return emptyMail(message, envelopeFrom, envelopeTo, messageId, rawSize);
  }

  const email = await PostalMime.parse(message.raw);
  const from = formatMailbox(email.from) || decodeWords(message.headers.get("from") ?? envelopeFrom);
  const subject = email.subject?.trim() || decodeWords(message.headers.get("subject") ?? "");
  const date = email.date || message.headers.get("date") || "";
  const id = email.messageId || messageId;

  let text = email.text?.trim() ?? "";
  if (!text && email.html) text = htmlToText(email.html);
  text = stripControls(text);

  // 统一构建资产（keepBytes 时保留二进制，否则仅保留元数据用于识别正文内联图片）。
  const assets = (email.attachments ?? [])
    .map((attachment) => toAsset(attachment, keepBytes))
    .filter((asset): asset is MailAsset => asset !== undefined);
  const parts = buildParts(email.html ?? "", text, assets);

  // 正文中已以内嵌图片形式展示的 contentId，不再重复计为附件。
  const bodyContentIds = new Set<string>();
  for (const part of parts) {
    if (part.type === "image") {
      const asset = assets[part.assetIndex];
      if (asset?.contentId) bodyContentIds.add(asset.contentId);
    }
  }

  return {
    subject,
    from,
    envelopeFrom,
    envelopeTo,
    date,
    messageId: id,
    text,
    attachments: (email.attachments ?? [])
      .filter(
        (attachment) =>
          isFileAttachment(attachment) && !bodyContentIds.has(normalizeContentId(attachment.contentId ?? "")),
      )
      .map(summarizeAttachment),
    assets,
    parts,
    oversized: false,
    rawSize,
  };
}

function emptyMail(
  message: InboundEmail,
  envelopeFrom: string,
  envelopeTo: string,
  messageId: string,
  rawSize: number,
): ParsedMail {
  return {
    subject: decodeWords(message.headers.get("subject") ?? ""),
    from: decodeWords(message.headers.get("from") ?? envelopeFrom),
    envelopeFrom,
    envelopeTo,
    date: message.headers.get("date") ?? "",
    messageId,
    text: "",
    attachments: [],
    assets: [],
    parts: [],
    oversized: true,
    rawSize,
  };
}

function formatMailbox(address: Address | undefined): string {
  if (!address) return "";
  if (address.group) return address.group.map((item) => formatMailbox(item)).filter(Boolean).join(", ");
  const mailbox = address.address?.trim() ?? "";
  const name = address.name?.trim() ?? "";
  if (name && mailbox) return `${name} <${mailbox}>`;
  return mailbox || name;
}

const UPLOADABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/ico",
]);

function isUploadableImage(mimeType: string, filename: string): boolean {
  if (UPLOADABLE_IMAGE_TYPES.has(mimeType.toLowerCase())) return true;
  return /\.(jpe?g|png|webp|gif|bmp|ico|tiff?|heic|heif)$/i.test(filename);
}

function toAsset(attachment: Attachment, keepBytes: boolean): MailAsset | undefined {
  const filename = attachment.filename?.trim() || "未命名";
  const mimeType = attachment.mimeType || "application/octet-stream";
  const size = contentSize(attachment.content);
  const inline = attachment.disposition === "inline" || attachment.related === true;
  const image = isUploadableImage(mimeType, filename);
  if (!image && inline) return undefined;
  if (!image && attachment.disposition !== "attachment" && !attachment.filename?.trim()) return undefined;
  if (size === 0) return undefined;
  if (image && inline && size < TRACKING_PIXEL_BYTES) return undefined;

  const asset: MailAsset = {
    filename,
    mimeType,
    size,
    kind: image ? "image" : "file",
    ...(keepBytes ? { bytes: toBytes(attachment.content) } : {}),
  };
  const contentId = normalizeContentId(attachment.contentId ?? "");
  if (contentId) asset.contentId = contentId;
  if (image && size > 10 * 1024 * 1024) asset.skipReason = "超过 10 MB";
  if (!image && size > 30 * 1024 * 1024) asset.skipReason = "超过 30 MB";
  if (asset.skipReason) asset.bytes = undefined;
  return asset;
}

function buildParts(html: string, text: string, assets: MailAsset[]): BodyPart[] {
  // 正文只保留文本和内嵌（cid）图片；普通图片附件交给 feishu-app 放进「附件：」区。
  if (/<img\b[^>]*\bsrc\s*=\s*['"]?\s*cid:/i.test(html)) return htmlToParts(html, assets);
  const plain = text.trim();
  return plain ? [{ type: "text", text: plain }] : [];
}

function htmlToParts(html: string, assets: MailAsset[]): BodyPart[] {
  const parts: BodyPart[] = [];
  const pattern = /<img\b[^>]*>/gi;
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    const text = htmlToText(html.slice(last, match.index ?? 0));
    if (text) parts.push({ type: "text", text });
    const contentId = contentIdFromImg(match[0]);
    const assetIndex = contentId === undefined ? -1 : assets.findIndex((asset) => asset.contentId === contentId);
    if (assetIndex >= 0) parts.push({ type: "image", assetIndex });
    last = (match.index ?? 0) + match[0].length;
  }
  const tail = htmlToText(html.slice(last));
  if (tail) parts.push({ type: "text", text: tail });
  return parts;
}

function contentIdFromImg(tag: string): string | undefined {
  const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value = (src?.[1] ?? src?.[2] ?? src?.[3] ?? "").trim();
  const cid = value.match(/^cid:(.*)$/i)?.[1];
  if (!cid) return undefined;
  return normalizeContentId(cid);
}

function normalizeContentId(value: string): string {
  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // 保留原文
  }
  return decoded.replace(/^<|>$/g, "").trim().toLowerCase();
}

function toBytes(content: Attachment["content"]): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function isFileAttachment(attachment: Attachment): boolean {
  if (attachment.related) return false;
  if (attachment.disposition === "inline") return false;
  return attachment.disposition === "attachment" || Boolean(attachment.filename?.trim());
}

function summarizeAttachment(attachment: Attachment): MailAttachment {
  return {
    filename: attachment.filename?.trim() || "未命名",
    mimeType: attachment.mimeType || "application/octet-stream",
    size: contentSize(attachment.content),
  };
}

function contentSize(content: Attachment["content"]): number {
  if (typeof content === "string") return new TextEncoder().encode(content).length;
  return content.byteLength;
}

export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return stripControls(decodeEntities(stripped).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => codePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)));
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
