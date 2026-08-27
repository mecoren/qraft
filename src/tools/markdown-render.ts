/**
 * Markdown 渲染管线 —— 主线程入口(消毒层)
 *
 * 职责:
 * - 包装 markdown-core.ts 的纯逻辑渲染,在主线程补 DOMPurify 消毒
 *   (消毒依赖 window,无法进 Worker;核心解析/高亮/公式均可 Worker 化)
 * - 保持既有公开 API:renderMarkdown / computeDocStats / slugifyText /
 *   buildTocHtml / OutlineItem / RenderOptions 等,供组件与测试使用
 *
 * 异步路径见 markdown-render-client.ts:Worker 执行核心渲染后,
 * 回到主线程调用本模块的 sanitizeMarkdownHtml 完成同一套消毒。
 */

import DOMPurify from 'dompurify';
import { t } from '@/i18n';
import {
  renderMarkdownCore,
  computeDocStats,
  slugifyText,
  buildTocHtml,
  type RenderCoreResult,
  type RenderOptions,
  type OutlineItem,
  type DocStats,
} from './markdown-core';

// ============================================================
// DOMPurify 消毒配置
// ============================================================

const SANITIZE_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['input', 'section', 'nav'],
  ADD_ATTR: [
    'id',
    'class',
    'type',
    'checked',
    'disabled',
    'hidden',
    'start',
    'colspan',
    'rowspan',
    'target',
    'rel',
    'aria-label',
    'data-md-copy',
    'data-md-toc',
    'data-mermaid',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed', 'textarea', 'link', 'meta'],
};

/** 对核心渲染产出的 HTML 做 DOMPurify 白名单消毒 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}

// ============================================================
// 公开 API(与既有调用方保持兼容)
// ============================================================

export interface RenderResult {
  /** 消毒后的 HTML(可直接注入 article.markdown-body) */
  html: string;
  /** 大纲(标题树扁平列表) */
  outline: OutlineItem[];
  /** 是否包含 Mermaid 图表占位(组件据此懒加载 mermaid) */
  hasMermaid: boolean;
}

/** 同步渲染 + 消毒(Worker 不可用时的回退路径 / 组件首帧) */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  const core: RenderCoreResult = renderMarkdownCore(source, {
    ...options,
    labels: options.labels ?? {
      copyCode: t('tools.markdown_preview.core_copy_code'),
      headingAnchor: t('tools.markdown_preview.core_heading_anchor'),
      backref: t('tools.markdown_preview.core_backref'),
    },
  });
  return {
    html: core.html ? sanitizeMarkdownHtml(core.html) : '',
    outline: core.outline,
    hasMermaid: core.hasMermaid,
  };
}

export type { RenderOptions, OutlineItem, DocStats };
export { computeDocStats, slugifyText, buildTocHtml };
