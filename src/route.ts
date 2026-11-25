import type { DeliveryMode, Env } from "./env";

const FEISHU_WEBHOOK_PREFIXES = [
  "https://open.feishu.cn/open-apis/bot/v2/hook/",
  "https://open.larksuite.com/open-apis/bot/v2/hook/",
];

export interface WebhookTarget {
  recipient: string;
  url: string;
  source: "map" | "default";
}

export interface ChatTarget {
  recipient: string;
  chatId: string;
  source: "map" | "default";
}

export function normalizeAddress(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const angle = trimmed.match(/<([^<>]+)>/);
  return (angle?.[1] ?? trimmed).trim();
}

export function assertFeishuWebhook(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL is invalid");
  }
  const normalized = `${parsed.origin}${parsed.pathname}`;
  const allowed = FEISHU_WEBHOOK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!allowed || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Webhook URL must be a Feishu or Lark custom bot v2 address");
  }
}

export function assertDingTalkWebhook(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "oapi.dingtalk.com" || parsed.pathname !== "/robot/send") {
    throw new Error("Webhook URL must be a DingTalk custom bot address");
  }
  if (!parsed.searchParams.get("access_token")) {
    throw new Error("DingTalk webhook URL must include access_token");
  }
}

export function assertWeWorkWebhook(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "qyapi.weixin.qq.com" ||
    parsed.pathname !== "/cgi-bin/webhook/send"
  ) {
    throw new Error("Webhook URL must be a WeWork group bot address");
  }
  if (!parsed.searchParams.get("key")) {
    throw new Error("WeWork webhook URL must include key");
  }
}

export function parseWebhookMap(raw: unknown): Map<string, string> {
  return parseAddressMap(raw, "EMAIL_FEISHU_MAP", "webhook URL", (email, value) => {
    try {
      assertFeishuWebhook(value);
    } catch {
      throw new Error(`EMAIL_FEISHU_MAP value for ${email} is not a Feishu or Lark webhook`);
    }
    return value;
  });
}

export function parseDingTalkMap(raw: unknown): Map<string, string> {
  return parseAddressMap(raw, "EMAIL_DINGTALK_MAP", "webhook URL", (email, value) => {
    try {
      assertDingTalkWebhook(value);
    } catch {
      throw new Error(`EMAIL_DINGTALK_MAP value for ${email} is not a DingTalk webhook`);
    }
    return value;
  });
}

export function parseWeWorkMap(raw: unknown): Map<string, string> {
  return parseAddressMap(raw, "EMAIL_WEWORK_MAP", "webhook URL", (email, value) => {
    try {
      assertWeWorkWebhook(value);
    } catch {
      throw new Error(`EMAIL_WEWORK_MAP value for ${email} is not a WeWork webhook`);
    }
    return value;
  });
}

export function assertChatId(chatId: string): void {
  if (!/^oc_[A-Za-z0-9]+$/.test(chatId)) {
    throw new Error("Feishu chat_id must look like oc_...");
  }
}

export function parseChatMap(raw: unknown): Map<string, string> {
  return parseAddressMap(raw, "EMAIL_CHAT_MAP", "chat_id", (email, value) => {
    try {
      assertChatId(value);
    } catch {
      throw new Error(`EMAIL_CHAT_MAP value for ${email} is not a Feishu chat_id`);
    }
    return value;
  });
}

export function resolveDeliveryMode(value: string | undefined): DeliveryMode {
  const mode = value?.trim() || "feishu_webhook";
  if (
    mode === "feishu_webhook" ||
    mode === "feishu_app" ||
    mode === "dingding_webhook" ||
    mode === "wework_webhook"
  ) {
    return mode;
  }
  throw new Error("DELIVERY_MODE must be feishu_webhook, feishu_app, dingding_webhook or wework_webhook");
}

export function resolveChat(envelopeTo: string, env: Env): ChatTarget {
  const recipient = normalizeAddress(envelopeTo);
  const mapped = parseChatMap(env.EMAIL_CHAT_MAP).get(recipient);
  if (mapped) return { recipient, chatId: mapped, source: "map" };

  const fallback = env.FEISHU_CHAT_ID?.trim();
  if (fallback) {
    assertChatId(fallback);
    return { recipient, chatId: fallback, source: "default" };
  }
  throw new Error(`No chat for ${recipient}, and FEISHU_CHAT_ID is empty`);
}

export type DeliveryTarget =
  | ({ mode: "feishu_webhook" } & WebhookTarget)
  | ({ mode: "feishu_app" } & ChatTarget)
  | ({ mode: "dingding_webhook" } & WebhookTarget)
  | ({ mode: "wework_webhook" } & WebhookTarget);

export function resolveDelivery(envelopeTo: string, env: Env): DeliveryTarget {
  const mode = resolveDeliveryMode(env.DELIVERY_MODE);
  if (mode === "feishu_webhook") return { mode, ...resolveWebhook(envelopeTo, env, "feishu") };
  if (mode === "dingding_webhook") return { mode, ...resolveWebhook(envelopeTo, env, "dingtalk") };
  if (mode === "wework_webhook") return { mode, ...resolveWebhook(envelopeTo, env, "wework") };
  return { mode, ...resolveChat(envelopeTo, env) };
}

function parseAddressMap(
  raw: unknown,
  label: string,
  valueName: string,
  accept: (email: string, value: string) => string,
): Map<string, string> {
  if (raw == null || raw === "") return new Map();

  let data: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return new Map();
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${label} must be a JSON object of email to ${valueName}`);
  }

  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    const email = normalizeAddress(key);
    if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
      throw new Error(`${label} key "${key}" is not an email address`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${label} value for ${email} must be a ${valueName}`);
    }
    const accepted = accept(email, value.trim());
    if (map.has(email)) throw new Error(`${label} has duplicate entries for ${email}`);
    map.set(email, accepted);
  }
  return map;
}

export function resolveWebhook(
  envelopeTo: string,
  env: Env,
  platform: "feishu" | "dingtalk" | "wework" = "feishu",
): WebhookTarget {
  const recipient = normalizeAddress(envelopeTo);

  if (platform === "dingtalk") {
    const mapped = parseDingTalkMap(env.EMAIL_DINGTALK_MAP).get(recipient);
    if (mapped) return { recipient, url: mapped, source: "map" };
    const fallback = env.DINGTALK_WEBHOOK_URL?.trim();
    if (fallback) {
      assertDingTalkWebhook(fallback);
      return { recipient, url: fallback, source: "default" };
    }
    throw new Error(`No webhook for ${recipient}, and DINGTALK_WEBHOOK_URL is empty`);
  }

  if (platform === "wework") {
    const mapped = parseWeWorkMap(env.EMAIL_WEWORK_MAP).get(recipient);
    if (mapped) return { recipient, url: mapped, source: "map" };
    const fallback = env.WEWORK_WEBHOOK_URL?.trim();
    if (fallback) {
      assertWeWorkWebhook(fallback);
      return { recipient, url: fallback, source: "default" };
    }
    throw new Error(`No webhook for ${recipient}, and WEWORK_WEBHOOK_URL is empty`);
  }

  const mapped = parseWebhookMap(env.EMAIL_FEISHU_MAP).get(recipient);
  if (mapped) {
    return { recipient, url: mapped, source: "map" };
  }
  const fallback = env.FEISHU_WEBHOOK_URL?.trim();
  if (fallback) {
    assertFeishuWebhook(fallback);
    return { recipient, url: fallback, source: "default" };
  }
  throw new Error(`No webhook for ${recipient}, and FEISHU_WEBHOOK_URL is empty`);
}
