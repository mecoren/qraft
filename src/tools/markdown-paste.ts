/**
 * HTML → Markdown 转换(「粘贴为 Markdown」功能)
 *
 * - turndown + gfm 插件:支持 GFM 表格 / 删除线 / 任务列表的往返转换
 * - 配置对齐本工具的书写习惯:ATX 标题、围栏代码块、- 列表、** 加粗
 * - 输入为空或转换异常时返回空串,由调用方提示
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});
turndown.use(gfm);

/** 相对链接/图片保持原样;移除脚本与样式节点,避免噪音 */
turndown.remove(['script', 'style']);

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  try {
    return turndown.turndown(html).trim();
  } catch {
    return '';
  }
}
