import type { EmailDocument } from "../model/email";
import { formatMailTime } from "../util/format";

/** 飞书自定义机器人请求体上限 20 KB，留出余量。 */
export const MAX_PAYLOAD_BYTES = 18 * 1024;

interface SignFields {
  timestamp: string;
  sign: string;
}

export function buildFeishuWebhookPayload(doc: EmailDocument, sign?: SignFields): string {
  const lines: string[] = [];
  lines.push(`标题：${doc.subject}`);
  lines.push(`发件人：${doc.from}`);
  lines.push(`收件人：${doc.to}`);
  lines.push(`时间：${formatMailTime(doc.date)}`);
  lines.push("---------------");

  for (const block of doc.blocks) {
    switch (block.type) {
      case "paragraph":
        lines.push(block.text);
        break;
      case "separator":
        lines.push("---------------");
        break;
      case "image":
        lines.push(block.placeholder);
        break;
      case "link":
        lines.push(`[${block.text}](${block.url})`);
        break;
      case "heading":
        lines.push(`# ${block.text}`);
        break;
      case "list":
        for (const item of block.items) lines.push(block.ordered ? `1. ${item}` : `· ${item}`);
        break;
      case "quote":
        lines.push(`> ${block.text}`);
        break;
      case "table":
        for (const row of block.rows) lines.push(row.join(" | "));
        break;
    }
  }

  const body = lines.join("\n");

  const payload: Record<string, unknown> = {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: doc.subject || "(无主题)",
          content: [[{ tag: "text", text: body }]],
        },
      },
    },
  };
  if (sign) {
    payload.timestamp = sign.timestamp;
    payload.sign = sign.sign;
  }
  return JSON.stringify(payload);
}

export async function signRequest(secret: string): Promise<SignFields> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return { timestamp, sign: await feishuSign(timestamp, secret) };
}

export async function feishuSign(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new Uint8Array());
  return base64(new Uint8Array(mac));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
