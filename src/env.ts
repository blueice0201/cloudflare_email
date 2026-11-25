export type DeliveryMode =
  | "feishu_webhook"
  | "feishu_app"
  | "dingding_webhook"
  | "wework_webhook";

export interface Env {
  /**
   * feishu_webhook：自定义机器人 webhook，只转发文本。
   * feishu_app：自建应用上传图片和文件，文本与图片合成一条消息，文件作为回复。
   * dingding_webhook：钉钉自定义机器人 webhook，Markdown 正文，图片/附件为占位符。
   * wework_webhook：企业微信群机器人 webhook，Markdown 正文，图片/附件为占位符。
   * 未设置时按 feishu_webhook。
   */
  DELIVERY_MODE?: string;
  /** 未命中映射时使用的飞书自定义机器人 webhook。feishu_webhook 模式需要。 */
  FEISHU_WEBHOOK_URL?: string;
  /** 机器人开启签名校验时的密钥。映射和默认地址共用。为空时不做加签。 */
  FEISHU_SIGN_SECRET?: string;
  /** 钉钉机器人开启加签时的密钥。映射和默认地址共用。为空时不做加签。 */
  DINGTALK_SIGN_SECRET?: string;
  /** 企业微信机器人开启加签时的密钥。映射和默认地址共用。为空时不做加签。 */
  WEWORK_SIGN_SECRET?: string;
  /** 收件邮箱到飞书 webhook 的映射（feishu_webhook 模式）。 */
  EMAIL_FEISHU_MAP?: string | { [email: string]: string };
  /** 自建应用凭证。feishu_app 模式需要。 */
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  /** 未命中 EMAIL_CHAT_MAP 时，文件和正文发到这个群。 */
  FEISHU_CHAT_ID?: string;
  /**
   * Worker 的对外访问地址（如 https://cf-email2webhook.xxx.workers.dev）。
   * 设置后，附件下载链接会指向本站的 /download/:fileKey 代理，浏览器可直接下载；
   * 不设置时链接为飞书 OpenAPI 地址，需应用鉴权才能访问。
   */
  PUBLIC_BASE_URL?: string;
  /** 收件邮箱到群 chat_id（oc_ 开头）的映射。 */
  EMAIL_CHAT_MAP?: string | { [email: string]: string };
  /** 未命中映射时使用的钉钉自定义机器人 webhook。dingding_webhook 模式需要。 */
  DINGTALK_WEBHOOK_URL?: string;
  /** 收件邮箱到钉钉 webhook 的映射。 */
  EMAIL_DINGTALK_MAP?: string | { [email: string]: string };
  /** 未命中映射时使用的企业微信群机器人 webhook。wework_webhook 模式需要。 */
  WEWORK_WEBHOOK_URL?: string;
  /** 收件邮箱到企业微信 webhook 的映射。 */
  EMAIL_WEWORK_MAP?: string | { [email: string]: string };
}
