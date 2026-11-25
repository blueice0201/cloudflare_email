import type { EmailDocument } from "../model/email";
import { formatMailTime } from "../util/format";

export interface DingTalkMarkdownPayload {
  msgtype: "markdown";
  markdown: {
    title: string;
    text: string;
  };
}

export function renderDingTalkMarkdown(doc: EmailDocument): DingTalkMarkdownPayload {
  const lines: string[] = [];
  lines.push(`### ${doc.subject}`);
  lines.push("");
  lines.push(`**发件人**：${doc.from}`);
  lines.push("");
  lines.push(`**收件人**：${doc.to}`);
  lines.push("");
  lines.push(`**时间**：${formatMailTime(doc.date)}`);
  lines.push("");
  lines.push("---------------");
  lines.push("");

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
        lines.push(`### ${block.text}`);
        break;
      case "list":
        for (const item of block.items) lines.push(block.ordered ? `1. ${item}` : `- ${item}`);
        break;
      case "quote":
        lines.push(`> ${block.text}`);
        break;
      case "table":
        lines.push(block.rows.map((row) => row.join(" | ")).join("\n"));
        break;
    }
    lines.push("");
  }

  return {
    msgtype: "markdown",
    markdown: {
      title: doc.subject || "(无主题)",
      text: lines.join("\n"),
    },
  };
}

export function renderDingTalkText(doc: EmailDocument): { msgtype: "text"; text: { content: string } } {
  const lines: string[] = [];
  lines.push(`邮件标题：${doc.subject}`);
  lines.push(`发件人：${doc.from}`);
  lines.push(`收件人：${doc.to}`);
  lines.push(`时间：${formatMailTime(doc.date)}`);
  lines.push("---------------");

  for (const block of doc.blocks) {
    if (block.type === "paragraph") lines.push(block.text);
    else if (block.type === "image") lines.push(block.placeholder);
    else if (block.type === "link") lines.push(`${block.text} ${block.url}`);
    else if (block.type === "heading") lines.push(block.text);
    else if (block.type === "list") {
      for (const item of block.items) lines.push(`- ${item}`);
    }
  }

  return {
    msgtype: "text",
    text: { content: lines.join("\n") },
  };
}
