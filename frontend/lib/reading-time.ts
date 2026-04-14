/**
 * 计算阅读时间
 * 中文按字符计，英文按单词计（英文单词约等于2个中文字符宽度）
 */

const WORDS_PER_MINUTE = 400; // 阅读速度：每分钟400字（中文）或400词（英文）
const CHINESE_CHAR_WEIGHT = 1; // 中文字符权重
const ENGLISH_WORD_WEIGHT = 0.5; // 英文单词权重（折算为中文字符数）

/**
 * 计算文本的阅读时间（分钟）
 * @param content 文章内容
 * @returns 阅读时间（分钟），最少1分钟
 */
export function calculateReadingTime(content: string): number {
  // 移除 markdown 语法以获得更准确的字数
  const plainText = content
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    // 移除行内代码
    .replace(/`[^`]+`/g, '')
    // 移除图片语法
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // 移除链接语法，保留文字
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // 移除 markdown 标题符号
    .replace(/^#+\s+/gm, '')
    // 移除加粗、斜体语法
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 移除引用符号
    .replace(/^>\s+/gm, '')
    // 移除列表符号
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // 移除水平线
    .replace(/^[-*_]{3,}$/gm, '');

  // 统计中文字符数
  const chineseChars = (plainText.match(/[\u4e00-\u9fa5]/g) || []).length;

  // 统计英文单词数（简单按空格分割）
  const englishWords = (plainText.match(/[a-zA-Z]+/g) || []).length;

  // 计算总"字数"（中文 + 英文折算）
  const totalChars = chineseChars * CHINESE_CHAR_WEIGHT + englishWords * ENGLISH_WORD_WEIGHT;

  // 计算阅读时间
  const minutes = Math.ceil(totalChars / WORDS_PER_MINUTE);

  // 至少返回1分钟
  return Math.max(1, minutes);
}

/**
 * 格式化阅读时间显示
 * @param minutes 分钟数
 * @returns 格式化后的字符串，如 "5 分钟阅读"
 */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) {
    return '1 分钟阅读';
  }
  return `${minutes} 分钟阅读`;
}
