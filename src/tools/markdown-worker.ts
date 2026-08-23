/**
 * Markdown 渲染 Worker
 *
 * 职责:
 * - 在独立线程执行 markdown-core 的完整渲染管线(marked 词法解析 +
 *   highlight.js 高亮 + KaTeX 公式),大文档不再阻塞主线程输入/滚动
 * - 返回未消毒 HTML;DOMPurify 消毒由主线程统一完成(其依赖 window)
 *
 * 协议:
 *   入站  { id: number; source: string; fastHighlight?: boolean }
 *   出站  { id: number; ok: true; raw: RenderCoreResult }
 *        | { id: number; ok: false }
 */

import { renderMarkdownCore } from './markdown-core';

export interface WorkerRequest {
  id: number;
  source: string;
  fastHighlight?: boolean;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  raw?: { html: string; outline: unknown[]; hasMermaid: boolean };
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, source, fastHighlight } = event.data ?? { id: -1, source: '' };
  try {
    const result = renderMarkdownCore(source, { fastHighlight });
    const response: WorkerResponse = { id, ok: true, raw: result };
    (self as unknown as Worker).postMessage(response);
  } catch {
    // 单次渲染失败不熔断 Worker(可能是极端输入触发),
    // 主线程收到 ok:false 后走同步兜底
    const response: WorkerResponse = { id, ok: false };
    (self as unknown as Worker).postMessage(response);
  }
};
