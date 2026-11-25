import type { Env } from "./env";
import { parseEmail } from "./parse";
import { buildEmailDocument } from "./model/builder";
import { resolveDelivery } from "./route";
import { sendFeishuApp, tenantAccessToken, API } from "./sender/feishu-app";
import { sendFeishuWebhook } from "./sender/feishu-webhook";
import { sendDingTalk } from "./sender/dingding";
import { renderDingTalkMarkdown, renderDingTalkText } from "./render/dingding";
import { sendWeWork } from "./sender/wework";
import { renderWeWorkMarkdown, renderWeWorkText } from "./render/wework";

export default {
  async email(message, env, _ctx): Promise<void> {
    const target = resolveDelivery(message.to, env);
    const isFeishuApp = target.mode === "feishu_app";
    const mail = await parseEmail(message, { keepBytes: isFeishuApp });
    const doc = buildEmailDocument(mail);

    console.log(
      JSON.stringify({
        event: "email.received",
        mode: target.mode,
        to: target.recipient,
        from: message.from,
        rawSize: message.rawSize,
        route: target.source,
      }),
    );

    try {
      switch (target.mode) {
        case "feishu_app": {
          const appId = env.FEISHU_APP_ID?.trim();
          const appSecret = env.FEISHU_APP_SECRET?.trim();
          if (!appId || !appSecret) {
            throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required when DELIVERY_MODE is feishu_app");
          }
          await sendFeishuApp({
            appId,
            appSecret,
            chatId: target.chatId,
            mail,
            doc,
            publicBaseUrl: env.PUBLIC_BASE_URL?.trim() || undefined,
          });
          break;
        }
        case "feishu_webhook": {
          await sendFeishuWebhook(target.url, env.FEISHU_SIGN_SECRET, doc);
          break;
        }
        case "dingding_webhook": {
          const signSecret = env.DINGTALK_SIGN_SECRET?.trim() || undefined;
          const payload = renderDingTalkMarkdown(doc);
          try {
            await sendDingTalk(target.url, payload, signSecret);
          } catch {
            await sendDingTalk(target.url, renderDingTalkText(doc), signSecret);
          }
          break;
        }
        case "wework_webhook": {
          const signSecret = env.WEWORK_SIGN_SECRET?.trim() || undefined;
          const payload = renderWeWorkMarkdown(doc);
          try {
            await sendWeWork(target.url, payload, signSecret);
          } catch {
            await sendWeWork(target.url, renderWeWorkText(doc), signSecret);
          }
          break;
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "email.failed",
          mode: target.mode,
          to: target.recipient,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }

    logDelivered(target.mode, target.recipient, target.source, doc.subject, doc.attachments.length, doc.oversized);
  },

  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/download/")) {
      const fileKey = decodeURIComponent(url.pathname.slice("/download/".length));
      if (!fileKey || fileKey.includes("/")) {
        return new Response("invalid file key", { status: 400 });
      }
      const appId = env.FEISHU_APP_ID?.trim();
      const appSecret = env.FEISHU_APP_SECRET?.trim();
      if (!appId || !appSecret) {
        return new Response("feishu app credentials not configured", { status: 500 });
      }
      try {
        const token = await tenantAccessToken(appId, appSecret);
        const upstream = await fetch(`${API}/im/v1/files/${encodeURIComponent(fileKey)}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!upstream.ok) {
          return new Response(`failed to fetch file: HTTP ${upstream.status}`, { status: upstream.status });
        }
        const headers = new Headers();
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers.set("content-type", contentType);
        headers.set("content-disposition", upstream.headers.get("content-disposition") ?? "attachment");
        headers.set("cache-control", "private, max-age=3600");
        return new Response(upstream.body, { status: 200, headers });
      } catch (error) {
        return new Response(error instanceof Error ? error.message : "download failed", { status: 502 });
      }
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function logDelivered(
  mode: string,
  to: string,
  route: string,
  subject: string,
  attachmentCount: number,
  oversized: boolean,
): void {
  console.log(
    JSON.stringify({
      event: "email.delivered",
      mode,
      to,
      route,
      subject: subject.slice(0, 120),
      attachmentCount,
      oversized,
    }),
  );
}
