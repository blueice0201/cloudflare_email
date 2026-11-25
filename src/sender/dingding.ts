import type { DingTalkMarkdownPayload } from "../render/dingding";

export interface DingTalkTextPayload {
  msgtype: "text";
  text: { content: string };
}

export type DingTalkPayload = DingTalkMarkdownPayload | DingTalkTextPayload;

export async function sendDingTalk(url: string, payload: DingTalkPayload, signSecret?: string): Promise<void> {
  const finalUrl = signSecret?.trim() ? await appendSign(url, signSecret.trim()) : url;
  const response = await fetch(finalUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DingTalk webhook failed: HTTP ${response.status}. ${text}`);
  }
  let parsed: { errcode?: number; errmsg?: string } = {};
  try {
    parsed = JSON.parse(text) as { errcode?: number; errmsg?: string };
  } catch {
    // ignore
  }
  if (parsed.errcode !== undefined && parsed.errcode !== 0) {
    throw new Error(`DingTalk webhook failed: code ${parsed.errcode}, ${parsed.errmsg ?? ""}`);
  }
}

async function appendSign(url: string, secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}\n${secret}`));
  const sign = base64(new Uint8Array(signature));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}sign=${encodeURIComponent(sign)}&timestamp=${timestamp}`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
