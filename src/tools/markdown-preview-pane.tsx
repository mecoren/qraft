/**
 * MarkdownPreviewPane —— 可复用的 Markdown 预览面板(纯展示层)
 *
 * 职责(自 MarkdownPreview 工具页抽出,供工具页与文本编辑器工作台共用):
 * - 两阶段防抖渲染(fast 快照 → 完整高亮),经 Worker 异步管线 + 消毒
 * - Mermaid 懒渲染(跟随主题深浅)、KaTeX 公式、代码高亮
 * - 预览区交互代理:图片 lightbox、代码块复制、锚点跳转、外部链接
 * - 脚注引用悬浮气泡
 * - 排版主题类(.md-theme-*)来自 markdownPreviewStore,与工具页共享偏好
 *
 * 不包含:工具栏/状态栏/大纲/滚动同步 —— 由宿主组合。
 * 宿主可通过 onScroller / onArticle / onRendered 回调接入同步与导出能力。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { writeClipboardText } from '@/lib/clipboard';
import { openExternal } from '@/lib/open-external';
import { showAlert } from '@/lib/toast-alert';
import { renderMarkdown, type OutlineItem, type RenderResult } from './markdown-render';
import { renderMarkdownAsync } from './markdown-render-client';
import { renderMermaidIn } from './markdown-mermaid';
import { useMarkdownPreviewStore } from './markdownPreviewStore';

/** 渲染防抖间隔(ms):输入到预览刷新的延迟 */
export const PANE_RENDER_DEBOUNCE_MS = 200;
/** 两阶段渲染阈值:超过该字节数启用「快照 → 完整高亮」两阶段 */
const TWO_PHASE_THRESHOLD = 24_000;
/** 大文档:两阶段防抖加长档位 */
const LARGE_RENDER_DEBOUNCE_MS = 350;
/** 超大文档:两阶段防抖上限档位 */
const HUGE_DOC_THRESHOLD = 150_000;
const HUGE_RENDER_DEBOUNCE_MS = 500;
/** 快照之后等待输入停顿再补完整高亮的间隔(ms) */
const FULL_RENDER_DELAY_MS = 600;

/** CSS.escape 安全封装(旧 WebView / 测试环境兜底) */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/** 跟随 <html>.dark 类变化(供 Mermaid 主题/宿主导出外观使用) */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export interface MarkdownPreviewPaneProps {
  /** Markdown 源文本 */
  source: string;
  /** 追加到滚动容器的类名 */
  className?: string;
  /** 空文档提示文案 */
  emptyHint?: string;
  /** 渲染结果回调(含大纲,宿主用于大纲面板/滚动同步) */
  onRendered?: (result: RenderResult) => void;
  /** 滚动容器元素回调(宿主用于滚动同步) */
  onScroller?: (el: HTMLDivElement | null) => void;
  /** 文章元素回调(宿主用于导出/富文本复制/锚点定位) */
  onArticle?: (el: HTMLElement | null) => void;
  /** 附加滚动监听(在内部 rAF 节流之外原样触发) */
  onScroll?: () => void;
}

export function MarkdownPreviewPane({
  source,
  className,
  emptyHint = '在左侧输入 Markdown 内容开始预览',
  onRendered,
  onScroller,
  onArticle,
  onScroll,
}: MarkdownPreviewPaneProps): JSX.Element {
  const themeId = useMarkdownPreviewStore((s) => s.themeId);

  // 首帧直接渲染初始内容(同步路径),避免空窗;后续更新经 Worker 异步推进
  const initialRendered = useMemo(() => renderMarkdown(source), [source]);
  const [rendered, setRendered] = useState<RenderResult>(initialRendered);
  /** 渲染请求代际:仅应用最新一次结果,丢弃过期异步响应 */
  const renderGenRef = useRef(0);

  const isDark = useIsDarkTheme();
  /** Night 主题固定深色:Mermaid 图表需叠加判定 */
  const effectiveDark = useMemo(
    () => isDark || themeId === 'night',
    [isDark, themeId],
  );

  const articleRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /** 图片 lightbox 当前展示的 src(null=关闭) */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /** 脚注悬浮预览:定位 + 内容文本 */
  const [footnotePop, setFootnotePop] = useState<{ top: number; left: number; text: string } | null>(
    null,
  );

  // —— 输入 → 两阶段渲染(Worker 异步)——
  useEffect(() => {
    const gen = ++renderGenRef.current;
    const apply = (fast: boolean): void => {
      void renderMarkdownAsync(source, fast).then((result) => {
        if (gen !== renderGenRef.current) return;
        setRendered(result);
        onRendered?.(result);
      });
    };

    let timers: Array<ReturnType<typeof setTimeout>>;
    if (source.length <= TWO_PHASE_THRESHOLD) {
      timers = [setTimeout(() => apply(false), PANE_RENDER_DEBOUNCE_MS)];
    } else {
      const baseDelay =
        source.length > HUGE_DOC_THRESHOLD ? HUGE_RENDER_DEBOUNCE_MS : LARGE_RENDER_DEBOUNCE_MS;
      timers = [
        setTimeout(() => apply(true), baseDelay),
        setTimeout(() => apply(false), baseDelay + FULL_RENDER_DELAY_MS),
      ];
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
    // eslint-disable-next-line react-x/exhaustive-deps -- onRendered 由宿主以稳定 useCallback 提供
  }, [source]);

  // —— Mermaid 懒渲染:出现图表占位或深浅切换时重绘(内部带 SVG 缓存)——
  useEffect(() => {
    const container = articleRef.current;
    if (!container || !rendered.hasMermaid) return;
    void renderMermaidIn(container, effectiveDark);
  }, [rendered, effectiveDark]);

  // —— 图片 lightbox:ESC 关闭 ——
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLightboxSrc(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxSrc]);

  /** 预览区点击代理:图片 lightbox / 代码块复制按钮 / 锚点链接 / 外部链接 */
  const handleArticleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    // 图片 → lightbox 放大
    const image = target.closest('img');
    if (image) {
      const src = image.getAttribute('src');
      if (src) {
        event.preventDefault();
        setLightboxSrc(src);
      }
      return;
    }

    const copyButton = target.closest('[data-md-copy]');
    if (copyButton) {
      const code = copyButton.closest('.md-code')?.querySelector('pre code');
      if (code?.textContent) {
        void writeClipboardText(code.textContent).then((ok) => {
          showAlert(
            ok
              ? { variant: 'success', title: '代码已复制' }
              : { variant: 'destructive', title: '复制失败' },
          );
        });
      }
      event.preventDefault();
      return;
    }

    const anchor = target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      const destination = articleRef.current?.querySelector(`#${escapeSelector(href.slice(1))}`);
      destination?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (/^https?:\/\//i.test(href)) {
      void openExternal(href);
    }
  }, []);

  /** 脚注引用悬停:在滚动容器内定位内容气泡(随内容滚动联动) */
  const handleArticleMouseOver = useCallback((event: MouseEvent<HTMLElement>) => {
    const sup = (event.target as HTMLElement).closest('.md-fn-ref');
    if (!sup || !(sup instanceof HTMLElement)) return;
    const href = sup.querySelector('a')?.getAttribute('href') ?? '';
    const label = href.startsWith('#') ? decodeURIComponent(href.slice(1)) : '';
    const fnEl = label ? articleRef.current?.querySelector(`#${escapeSelector(label)}`) : null;
    const text = fnEl?.textContent?.trim() ?? '';
    const scroller = scrollerRef.current;
    if (!text || !scroller) return;

    const supRect = sup.getBoundingClientRect();
    const containerRect = scroller.getBoundingClientRect();
    const top = supRect.bottom - containerRect.top + scroller.scrollTop + 6;
    const maxLeft = Math.max(scroller.clientWidth - 336, 8);
    const left = Math.min(
      Math.max(supRect.left - containerRect.left + scroller.scrollLeft, 8),
      maxLeft,
    );
    setFootnotePop({ top, left, text });
  }, []);

  const handleArticleMouseOut = useCallback((event: MouseEvent<HTMLElement>) => {
    const sup = (event.target as HTMLElement).closest('.md-fn-ref');
    const next = (event.relatedTarget as HTMLElement | null)?.closest('.md-fn-ref');
    if (sup && sup !== next) setFootnotePop(null);
  }, []);

  const handleInternalScroll = useCallback((): void => {
    // 滚动时收起脚注气泡(定位基于旧滚动偏移,保留会错位);函数式更新避免闭包依赖
    setFootnotePop((current) => (current === null ? current : null));
    onScroll?.();
  }, [onScroll]);

  const scrollerCb = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      onScroller?.(el);
    },
    [onScroller],
  );

  const articleCb = useCallback(
    (el: HTMLElement | null) => {
      articleRef.current = el;
      onArticle?.(el);
    },
    [onArticle],
  );

  return (
    <>
      <div
        ref={scrollerCb}
        onScroll={handleInternalScroll}
        data-md-surface={themeId === 'night' ? 'night' : undefined}
        className={cn('relative min-h-0 flex-1 overflow-y-auto bg-card', className)}
        data-testid="md-preview-scroll"
      >
        <div className="mx-auto px-6 py-5">
          {source.trim() ? (
            <article
              ref={articleCb}
              data-testid="md-preview"
              className={`markdown-body md-theme-${themeId}`}
              // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml -- 已在 markdown-render.ts 经 DOMPurify 白名单消毒
              dangerouslySetInnerHTML={{ __html: rendered.html }}
              onClick={handleArticleClick}
              onMouseOver={handleArticleMouseOver}
              onMouseOut={handleArticleMouseOut}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground" data-testid="md-empty">
              {emptyHint}
            </p>
          )}
        </div>
        {footnotePop && (
          <div
            className="md-fn-popover"
            style={{ top: footnotePop.top, left: footnotePop.left }}
            data-testid="md-footnote-popover"
          >
            {footnotePop.text}
          </div>
        )}
      </div>

      {/* —— 图片 lightbox —— */}
      {lightboxSrc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          data-testid="md-lightbox"
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-h-full max-w-full rounded-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="关闭图片预览"
            data-testid="md-lightbox-close"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/20"
          >
            关闭 (Esc)
          </button>
        </div>
      )}
    </>
  );
}

/**
 * 判断工作区文档是否为 Markdown(用于启用视图模式切换):
 * 路径扩展名 .md/.markdown/.mdx,或语言模式已是 markdown(untitled 文档
 * 通过语言选择器切换后同样生效)。
 */
export function isMarkdownDocument(path: string, language?: string): boolean {
  if (language === 'markdown') return true;
  return /\.(md|markdown|mdx)$/i.test(path.trim());
}

/** 供宿主复用的类型再导出 */
export type { OutlineItem };
