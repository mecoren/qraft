/**
 * MarkdownEditorPane —— 可复用的 Markdown 预览面板(纯展示层)
 *
 * 职责(自 MarkdownEditor 工具页抽出,供工具页与文本编辑器工作台共用):
 * - 两阶段防抖渲染(fast 快照 → 完整高亮),经 Worker 异步管线 + 消毒
 * - Mermaid 懒渲染(跟随主题深浅)、KaTeX 公式、代码高亮
 * - 预览区交互代理:图片 lightbox、代码块复制、锚点跳转、外部链接
 * - 脚注引用悬浮气泡
 * - 排版主题类(.md-theme-*)来自 markdownEditorStore,与工具页共享偏好
 *
 * 不包含:工具栏/状态栏/大纲/滚动同步 —— 由宿主组合。
 * 宿主可通过 onScroller / onArticle / onRendered 回调接入同步与导出能力。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { writeClipboardText } from '@/lib/clipboard';
import { openExternal } from '@/lib/open-external';
import { showAlert } from '@/lib/toast-alert';
import { renderMarkdown, type OutlineItem, type RenderResult } from './markdown-render';
import { renderMarkdownAsync } from './markdown-render-client';
import { renderMermaidIn } from './markdown-mermaid';
import { resolveAssetImages } from './markdown-image-assets';
import { useMarkdownEditorStore } from './markdownEditorStore';

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

export interface MarkdownEditorPaneProps {
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
  /** 预览区双击代理:宿主用于跳回编辑器对应源行(元素 → 源行映射由宿主实现) */
  onSourceLocate?: (target: HTMLElement) => void;
  /** 任务列表勾选写回:宿主替换对应源行的 [ ]/[x](Typora 点击即勾选) */
  onTaskToggle?: (line: number, checked: boolean) => void;
  /**
   * 预览区复制即 Markdown 源码(Typora 行为):宿主传入时,预览内的
   * copy 事件把选区 HTML 经 turndown 回转为源码写入剪贴板;返回空串/
   * undefined 表示转换失败,放行原生复制(富文本)。未传时(只读展示
   * 场景)保持原生复制。
   */
  copyAsMarkdown?: (getSelectionHtml: () => string) => string | undefined;
}

export function MarkdownEditorPane({
  source,
  className,
  emptyHint,
  onRendered,
  onScroller,
  onArticle,
  onScroll,
  onSourceLocate,
  onTaskToggle,
  copyAsMarkdown,
}: MarkdownEditorPaneProps): JSX.Element {
  const { t } = useTranslation();
  const themeId = useMarkdownEditorStore((s) => s.themeId);
  const loadRemoteImages = useMarkdownEditorStore((s) => s.loadRemoteImages);
  /** 空文档提示:宿主未提供时按当前语言取默认文案(语言切换即重算) */
  const resolvedEmptyHint = emptyHint ?? t('tools.markdown_editor.empty_hint');

  // 首帧直接渲染初始内容(同步路径),避免空窗;后续更新经 Worker 异步推进。
  // 惰性 useState 只在挂载时执行一次:后续 source 变化由下方 Worker effect
  // 接管,主线程不再做任何同步渲染(曾用 useMemo 依赖 [source],导致每次
  // 键击都在主线程跑一遍完整渲染然后丢弃,恰是 Worker 管线要隔离的开销)。
  // mdasset: 引用若存在,挂载后由首拍 Worker 渲染替换为 data URL。
  const [rendered, setRendered] = useState<RenderResult>(() => renderMarkdown(source));
  /** 渲染请求代际:仅应用最新一次结果,丢弃过期异步响应 */
  const renderGenRef = useRef(0);

  const isDark = useIsDarkTheme();
  /** Night 主题固定深色:Mermaid 图表需叠加判定 */
  const effectiveDark = useMemo(() => isDark || themeId === 'night', [isDark, themeId]);

  const articleRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /**
   * 远程图片拦截:Local-First 原则下默认不出网。开关关闭时把 http(s) img
   * 的 src 摘到 data-md-blocked-src 并置空(不渲染、不请求,无裂图),
   * 点击代理区显示「远程图片已拦截」占位;开启时原样放行。
   * 本地引用(asset:/data:/blob:/相对路径)不受影响。
   */
  const renderableHtml = useMemo(() => {
    if (loadRemoteImages) return rendered.html;
    return rendered.html.replace(
      /(<img\b[^>]*?\bsrc)="(https?:\/\/[^"]+)"/gi,
      (_whole: string, attr: string, url: string) => `${attr}="" data-md-blocked-src="${url}"`,
    );
  }, [rendered.html, loadRemoteImages]);

  /** 图片 lightbox 当前展示的 src(null=关闭) */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /** 脚注悬浮预览:定位 + 内容文本 */
  const [footnotePop, setFootnotePop] = useState<{
    top: number;
    left: number;
    text: string;
  } | null>(null);

  // —— 输入 → 两阶段渲染(Worker 异步)——
  useEffect(() => {
    const gen = ++renderGenRef.current;
    const apply = (fast: boolean): void => {
      void renderMarkdownAsync(source, fast).then(async (result) => {
        if (gen !== renderGenRef.current) return;
        // mdasset: 图片引用 → data URL(纯本地读取;带缓存,无引用时零开销)
        const html = await resolveAssetImages(result.html);
        if (gen !== renderGenRef.current) return;
        setRendered({ ...result, html });
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

  /** 预览区点击代理:任务勾选 / 图片 lightbox / 代码块复制按钮 / 锚点链接 / 外部链接 / 被拦截图片提示 */
  const handleArticleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;

      // 任务列表勾选:写回源码(Typora 点击即勾选)。原生 checkbox 点击
      // 已翻转视觉态,宿主替换源文本后重渲会同步真实状态
      if (onTaskToggle && target.matches('input[data-md-task]')) {
        const line = Number(target.getAttribute('data-task-line'));
        if (Number.isFinite(line) && line >= 1)
          onTaskToggle(line, (target as HTMLInputElement).checked);
        return;
      }

      // 被拦截的远程图片:提示原因(不放大、不请求)
      if (target.closest('[data-md-blocked-src]')) {
        event.preventDefault();
        showAlert({ variant: 'info', title: t('tools.markdown_editor.remote_blocked') });
        return;
      }

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
                ? { variant: 'success', title: t('tools.markdown_editor.toast_code_copied') }
                : { variant: 'destructive', title: t('tools.markdown_editor.toast_copy_failed') },
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
    },
    [t, onTaskToggle],
  );

  /** 预览区双击代理:VSCode 行为——双击任意预览元素跳回编辑器对应源行 */
  const handleArticleDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!onSourceLocate) return;
      // 忽略双击的纯交互控件(代码复制按钮/任务勾选),仅正文元素触发
      const target = event.target as HTMLElement;
      if (target.closest('[data-md-copy], input[data-md-task]')) return;
      const block = target.closest(
        'p,li,blockquote,pre,table,h1,h2,h3,h4,h5,h6,.md-code,.md-mermaid',
      );
      if (block instanceof HTMLElement) onSourceLocate(block);
    },
    [onSourceLocate],
  );

  /**
   * 预览区复制即源码(Typora 行为):copy 事件里取选区 HTML → turndown
   * 回转 → 覆写剪贴板纯文本。挂在滚动容器(scroller 恒挂载;article 随
   * 空态/有内容切换可能后出现,copy 监听挂它会在空文档首挂载时丢失),
   * capture 阶段先行于默认复制行为;转换失败放行原生复制(富文本兜底)。
   */
  useEffect(() => {
    const article = articleRef.current;
    const scroller = scrollerRef.current;
    if (!scroller || !article || !copyAsMarkdown) return;
    const onCopy = (event: ClipboardEvent): void => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!article.contains(range.commonAncestorContainer)) return;
      const markdown = copyAsMarkdown(() => {
        const fragment = range.cloneContents();
        const box = document.createElement('div');
        box.appendChild(fragment);
        return box.innerHTML;
      });
      if (!markdown) return; // 转换失败/空选区:放行原生富文本复制
      event.preventDefault();
      event.clipboardData?.setData('text/plain', markdown);
    };
    scroller.addEventListener('copy', onCopy, true);
    return () => scroller.removeEventListener('copy', onCopy, true);
  }, [copyAsMarkdown, rendered]);

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

  /**
   * 图片 Ctrl+滚轮文内缩放(Typora 行为):悬停图片上滚轮调显示尺寸,
   * 基于原始尺寸等比缩放(每次 ±15%),clamp 到 10%~600%;非 Ctrl 滚轮
   * 不拦截(保持页面滚动)。缩放是纯展示态(不写回源码),重渲后还原。
   */
  const handleArticleWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (!event.ctrlKey) return;
    const image = (event.target as HTMLElement).closest('img');
    if (!image || !(image instanceof HTMLImageElement)) return;
    event.preventDefault();
    // 原始尺寸锚点:首次缩放时记入 dataset(避开本轮已缩放的尺寸)
    if (image.dataset.mdZoomBaseW === undefined) {
      const natural = image.naturalWidth || image.width || 300;
      image.dataset.mdZoomBaseW = String(natural);
    }
    const base = Number(image.dataset.mdZoomBaseW);
    const current = Number(image.dataset.mdZoomScale ?? 1);
    const next = Math.min(6, Math.max(0.1, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    image.dataset.mdZoomScale = String(next);
    image.style.width = `${Math.round(base * next)}px`;
    image.style.height = '';
    image.style.maxWidth = 'none';
  }, []);

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
        data-testid="md-editor-preview-scroll"
      >
        <div className="mx-auto px-6 py-5">
          {source.trim() ? (
            <article
              ref={articleCb}
              data-testid="md-editor-preview"
              className={`markdown-body md-theme-${themeId}`}
              // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml -- 已在 markdown-render.ts 经 DOMPurify 白名单消毒
              dangerouslySetInnerHTML={{ __html: renderableHtml }}
              onClick={handleArticleClick}
              onDoubleClick={handleArticleDoubleClick}
              onWheel={handleArticleWheel}
              onMouseOver={handleArticleMouseOver}
              onMouseOut={handleArticleMouseOut}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground" data-testid="md-empty">
              {resolvedEmptyHint}
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
          aria-label={t('tools.markdown_editor.lightbox_aria')}
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
            aria-label={t('tools.markdown_editor.lightbox_close_aria')}
            data-testid="md-lightbox-close"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/20"
          >
            {t('tools.markdown_editor.lightbox_close')}
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
