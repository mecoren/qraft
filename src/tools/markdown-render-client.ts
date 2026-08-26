/**
 * Markdown 渲染异步客户端(Worker 封装 + 同步回退)
 *
 * 路径:
 * 1. Worker 可用:核心渲染在 Worker 线程完成,主线程仅做 DOMPurify 消毒
 *    (大文档的解析/高亮/公式开销不再阻塞输入与滚动)
 * 2. Worker 不可用(jsdom 测试环境 / 构造失败 / 运行出错 / 首个任务超时):
 *    永久降级为主线程同步 renderMarkdown,行为与旧版完全一致
 *
 * 结果契约:resolve 的 RenderResult 均已消毒,可直接注入 DOM。
 */

import { t } from '@/i18n';
import { renderMarkdown, sanitizeMarkdownHtml, type RenderResult } from './markdown-render';
import { loadExtendedLanguages, type MdRenderLabels } from './markdown-core';

/** 主线程按当前语言解析渲染产出内嵌文案,随任务下发 Worker(避免 Worker 打包 i18n) */
function resolveRenderLabels(): MdRenderLabels {
  return {
    copyCode: t('tools.markdown_preview.core_copy_code'),
    headingAnchor: t('tools.markdown_preview.core_heading_anchor'),
    backref: t('tools.markdown_preview.core_backref'),
  };
}

interface WorkerEnvelope {
  id: number;
  ok: boolean;
  raw?: { html: string; outline: RenderResult['outline']; hasMermaid: boolean };
}

let worker: Worker | null = null;
/** Worker 判定为不可用后永久走同步路径 */
let broken = false;
const pending = new Map<number, (envelope: WorkerEnvelope | null) => void>();
let seq = 0;

function createWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    const instance = new Worker(new URL('./markdown-worker.ts', import.meta.url), {
      type: 'module',
    });
    instance.onmessage = (event: MessageEvent<WorkerEnvelope>) => {
      const resolve = pending.get(event.data?.id ?? -1);
      if (!resolve) return;
      pending.delete(event.data.id);
      resolve(event.data);
    };
    instance.onerror = () => {
      // 脚本加载失败等致命错误:拒绝全部等待者并永久熔断
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
      broken = true;
      worker?.terminate();
      worker = null;
    };
    // Worker 内并行预载扩展语言,不影响消息循环
    void loadExtendedLanguages();
    return instance;
  } catch {
    return null;
  }
}

function ensureWorker(): Worker | null {
  if (broken) return null;
  if (!worker) worker = createWorker();
  return worker && !broken ? worker : null;
}

function rejectAllPending(): void {
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
}

/**
 * 单任务超时:首个任务若在时限内无响应视为 Worker 异常(如环境不支持),
 * 熔断并回退。后续任务复用同一判定(broken=true 后直接走同步)。
 */
const FIRST_JOB_TIMEOUT_MS = 4000;

export function renderMarkdownAsync(source: string, fastHighlight = false): Promise<RenderResult> {
  // 同步兜底渲染(消毒完整),供 Worker 不可用/失败时返回
  const fallback = (): RenderResult => {
    try {
      return renderMarkdown(source, { fastHighlight });
    } catch {
      return { html: '', outline: [], hasMermaid: false };
    }
  };

  const instance = ensureWorker();
  if (!instance) {
    void loadExtendedLanguages();
    return Promise.resolve(fallback());
  }

  const id = ++seq;
  const isFirstJob = id === 1;
  return new Promise<RenderResult>((resolve) => {
    let settled = false;
    const finish = (result: RenderResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(result);
    };
    const guard = setTimeout(
      () => {
        pending.delete(id);
        if (isFirstJob) {
          // 首任务超时:Worker 环境异常,熔断
          broken = true;
          instance.terminate();
          worker = null;
          rejectAllPending();
        }
        finish(fallback());
      },
      isFirstJob ? FIRST_JOB_TIMEOUT_MS : 15_000,
    );

    pending.set(id, (envelope) => {
      if (!envelope?.ok || !envelope.raw) {
        finish(fallback());
        return;
      }
      try {
        finish({
          html: sanitizeMarkdownHtml(envelope.raw.html),
          outline: envelope.raw.outline,
          hasMermaid: envelope.raw.hasMermaid,
        });
      } catch {
        finish(fallback());
      }
    });

    instance.postMessage({ id, source, fastHighlight, labels: resolveRenderLabels() });
  });
}
