/**
 * 移除不适合界面展示和 TTS 播报的常见格式符号。
 *
 * 这里只做逐字符转换，不改写句子语义，保证流式 delta 被任意切分时结果一致。
 */
export function sanitizeAssistantText(text: string): string {
  return text
    .replace(/[*_`#~>|]/g, "")
    .replace(/[-–—]/g, " 到 ");
}
