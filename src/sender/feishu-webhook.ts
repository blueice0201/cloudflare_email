import type { EmailDocument } from "../model/email";
import { buildFeishuWebhookPayload, signRequest } from "../render/feishu-webhook";

export async function sendFeishuWebhook(url: string, secret: string | undefined, doc: EmailDocument): Promise<void> {
  const sign = secret?.trim() ? await signRequest(secret.trim()) : undefined;
  const body = buildFeishuWebhookPayload(doc, sign);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  });
  const responseText = await response.text();
  const result = parseFeishuResult(responseText);
  if (!response.ok || result.code !== 0) {
    const detail = result.msg ? ` ${result.msg}` : "";
    throw new Error(`Feishu webhook failed: HTTP ${response.status}, code ${result.code ?? "unknown"}.${detail}`);
  }
}

function parseFeishuResult(responseText: string): { code?: number; msg?: string } {
  try {
    const parsed = JSON.parse(responseText) as { code?: unknown; msg?: unknown };
    return {
      code: typeof parsed.code === "number" ? parsed.code : undefined,
      msg: typeof parsed.msg === "string" ? parsed.msg.slice(0, 200) : undefined,
    };
  } catch {
    return {};
  }
}
