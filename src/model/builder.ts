import type { ParsedMail } from "../parse";
import type { EmailBlock, EmailAttachment, EmailDocument } from "./email";

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildEmailDocument(mail: ParsedMail): EmailDocument {
  const blocks: EmailBlock[] = [];
  const attachments: EmailAttachment[] = [];

  if (mail.oversized) {
    blocks.push({
      type: "paragraph",
      text: `邮件过大（${formatByteSize(mail.rawSize)}），正文与附件未展开。`,
    });
    return {
      subject: mail.subject,
      from: mail.from,
      to: mail.envelopeTo,
      date: mail.date,
      messageId: mail.messageId,
      rawSize: mail.rawSize,
      oversized: true,
      blocks,
      attachments,
    };
  }

  // 正文：优先按 parts 解析（保留内嵌图片位置），否则退化为纯文本段落
  if (mail.parts?.length) {
    for (const part of mail.parts) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (text) blocks.push({ type: "paragraph", text });
      } else if (part.type === "image") {
        const asset = mail.assets?.[part.assetIndex];
        if (asset) {
          blocks.push({
            type: "image",
            placeholder: `[图片：${asset.filename}]`,
            assetIndex: part.assetIndex,
          });
        } else {
          blocks.push({ type: "paragraph", text: "[图片：未知资源]" });
        }
      }
    }
    if (blocks.length === 0) {
      blocks.push({ type: "paragraph", text: "（无正文）" });
    }
  } else {
    const text = mail.text.trim();
    if (text) blocks.push({ type: "paragraph", text });
    else blocks.push({ type: "paragraph", text: "（无正文）" });
  }

  // 邮件附件（summary 里的 attachments）与资源中的图片附件，先收集占位块。
  // 已经在正文中以图片形式展示的资产，不再重复放入附件区域。
  const attachmentBlocks: EmailBlock[] = [];
  const embeddedFilenames = new Set<string>();
  for (const block of blocks) {
    if (block.type === "image" && block.assetIndex !== undefined) {
      const asset = mail.assets?.[block.assetIndex];
      if (asset) embeddedFilenames.add(asset.filename);
    }
  }
  for (const attachment of mail.attachments ?? []) {
    if (embeddedFilenames.has(attachment.filename)) continue;
    attachments.push({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      placeholder: `[附件：${attachment.filename}]`,
    });
    attachmentBlocks.push({ type: "paragraph", text: `[附件：${attachment.filename}]` });
  }

  // 资源中的图片附件（非内嵌、且未在 attachments 里出现过）也作为附件占位符
  const attachedNames = new Set(mail.attachments.map((a) => a.filename));
  const embeddedAssetIndices = new Set<number>();
  for (const block of blocks) {
    if (block.type === "image" && block.assetIndex !== undefined) {
      embeddedAssetIndices.add(block.assetIndex);
    }
  }
  for (const [index, asset] of (mail.assets ?? []).entries()) {
    if (asset.kind === "image" && !attachedNames.has(asset.filename) && !embeddedAssetIndices.has(index)) {
      attachments.push({
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
        placeholder: `[附件：${asset.filename}]`,
      });
      attachmentBlocks.push({ type: "paragraph", text: `[附件：${asset.filename}]` });
    }
  }

  // 只有存在附件时才加「正文与附件之间的分隔线」，避免无附件时留一条悬空分隔线
  if (attachmentBlocks.length > 0) {
    blocks.push({ type: "separator" });
    blocks.push(...attachmentBlocks);
  }

  return {
    subject: mail.subject,
    from: mail.from,
    to: mail.envelopeTo,
    date: mail.date,
    messageId: mail.messageId,
    rawSize: mail.rawSize,
    oversized: false,
    blocks,
    attachments,
  };
}
