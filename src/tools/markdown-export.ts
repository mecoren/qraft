/**
 * Markdown 导出(独立 HTML 文件 / 富文本复制)
 *
 * 职责:
 * - buildStandaloneHtml:把当前预览 HTML 包装为可离线打开的单文件 HTML,
 *   内嵌当前生效的排版样式(markdown-body 主题 + katex + hljs 相关规则)
 * - inlineStyleFonts:尝试把 KaTeX 字体内联为 data URL,保证公式在
 *   无网络/无应用环境下仍以正确字体渲染(失败则保留原引用,静默降级)
 * - saveStandaloneHtml:Tauri 环境经 fs_save_bytes 弹保存对话框;
 *   浏览器环境走 Blob 下载(dev 模式)
 *
 * 设计说明:
 * - 样式提取在运行时遍历 document.styleSheets,按选择器白名单过滤,
 *   与主题实现解耦 —— 新增排版样式无需同步维护导出模板
 * - 深色模式通过给 <body> 加 .dark 类复用现有 CSS 变体规则
 */

const STYLE_SELECTOR_WHITELIST =
  /markdown-body|md-theme|md-toc|md-code|md-mermaid|md-fn|md-math|md-footnote|\bkatex\b|\.hljs|data-md-/;

interface CssRuleLike {
  cssText: string;
  selectorText?: string;
}

/** 判断单条规则是否与 Markdown 排版相关 */
function isRelevantRule(rule: CssRuleLike): boolean {
  if (rule.selectorText) return STYLE_SELECTOR_WHITELIST.test(rule.selectorText);
  // @font-face 等无选择器规则:KaTeX 字体名带 KaTeX_ 前缀才内嵌
  return rule.cssText.includes('KaTeX_');
}

/** 递归收集样式表中的相关规则文本(@media/@supports 整块透传) */
function collectRules(rules: CSSRuleList): string {
  const parts: string[] = [];
  for (const rule of Array.from(rules)) {
    const css = rule as CSSRule & { cssText: string };
    if (!css?.cssText) continue;
    const media = css as CSSRule & { media?: MediaList; conditionText?: string };
    if (media.media && 'insertRule' in Object.getPrototypeOf(css)) {
      const inner = collectRules((css as CSSMediaRule).cssRules);
      if (inner.trim()) {
        parts.push(`@media ${media.media.mediaText}{${inner}}`);
      }
      continue;
    }
    if (isRelevantRule(css as CssRuleLike)) parts.push(css.cssText);
  }
  return parts.join('\n');
}

/** 遍历所有样式表,提取当前生效的 Markdown 排版 CSS */
export function collectMarkdownStyles(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (rules && rules.length > 0) parts.push(collectRules(rules));
    } catch {
      // 跨域样式表不可读(CSP 下不应存在),跳过
    }
  }
  return parts.join('\n');
}

let fontCache: Map<string, string> | null = null;

/** 把 CSS 中引用的 KaTeX 字体替换为 data URL(失败保留原样) */
async function inlineKatexFonts(css: string): Promise<string> {
  fontCache ??= new Map<string, string>();
  let totalBytes = 0;
  const urlPattern = /url\((['"]?)([^'")]+\.(?:woff2?|ttf|otf))\1\)/g;
  const replacements: Array<{ from: string; to: string }> = [];

  for (const match of css.matchAll(urlPattern)) {
    const rawUrl = match[2];
    if (!rawUrl.includes('KaTeX_')) continue;
    const cached = fontCache.get(rawUrl);
    if (cached) {
      replacements.push({ from: match[0], to: `url('${cached}')` });
      continue;
    }
    if (totalBytes > 4 * 1024 * 1024) continue; // 超过 4MB 停止继续内联
    try {
      const response = await fetch(rawUrl);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const dataUrl = `data:font/woff2;base64,${btoa(binary)}`;
      totalBytes += bytes.length;
      fontCache.set(rawUrl, dataUrl);
      replacements.push({ from: match[0], to: `url('${dataUrl}')` });
    } catch {
      // 字体获取失败时保留原 URL,导出文件在有网环境仍可用
    }
  }

  let result = css;
  for (const { from, to } of replacements) result = result.split(from).join(to);
  return result;
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 构建独立 HTML 文档。
 * @param articleHtml 已消毒的正文片段(article.markdown-body 的 innerHTML)
 * @param title 文档标题(取首条标题,回退「未命名文档」)
 * @param dark 是否嵌入深色外观
 */
export async function buildStandaloneHtml(
  articleHtml: string,
  title: string,
  dark: boolean,
): Promise<string> {
  const styles = await inlineKatexFonts(collectMarkdownStyles());
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtmlText(title)}</title>`,
    `<style>${styles}</style>`,
    '</head>',
    `<body${dark ? ' class="dark"' : ''}>`,
    `<article class="markdown-body">${articleHtml}</article>`,
    '</body>',
    '</html>',
  ].join('');
}

/** 保存独立 HTML:Tauri 走保存对话框;浏览器走 Blob 下载。返回是否成功 */
export async function saveStandaloneHtml(html: string, fileName: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(html);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const base64 = btoa(binary);

  try {
    const { safeInvoke } = await import('@/lib/ipc');
    const result = await safeInvoke<string | null>('fs_save_bytes', {
      fileName,
      base64,
      mime: 'text/html',
    });
    if (result.ok && result.value) return true;
    if (result.ok) return false; // 用户取消对话框
    throw new Error(result.error.message);
  } catch {
    // 非 Tauri 环境:Blob 下载兜底(dev)
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch {
      return false;
    }
  }
}
