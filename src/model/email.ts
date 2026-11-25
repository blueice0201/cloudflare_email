/** 平台无关的邮件内容块，所有渲染器的输入。 */
export type EmailBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; markdown?: string }
  | { type: "separator" }
  | { type: "link"; text: string; url: string }
  | { type: "image"; placeholder: string; assetIndex?: number }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; rows: string[][] };

/** 附件元信息，钉钉/企业微信只展示占位符，不上传二进制。 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  placeholder: string;
}

/** 统一邮件内容模型，所有平台渲染器的输入。 */
export interface EmailDocument {
  subject: string;
  from: string;
  to: string;
  date: string;
  messageId: string;
  rawSize: number;
  oversized: boolean;
  blocks: EmailBlock[];
  attachments: EmailAttachment[];
}
