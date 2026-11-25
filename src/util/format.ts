/** 将邮件日期字符串格式化为 Asia/Shanghai 的 yyyy-mm-dd HH:mm:ss；无法解析时原样返回，空值返回 "未知"。 */
export function formatMailTime(date: string): string {
  if (!date?.trim()) return "未知";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  // Asia/Shanghai = UTC+8
  const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())} ${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}:${pad(shanghai.getUTCSeconds())}`;
}
