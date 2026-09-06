/**
 * PDF 工具(打开 / 渲染 / 表单填写 / 叠加编辑)
 *
 * 能力:
 * - 多 Tab 工作区:文件关联/拖放 .pdf 自动进入本工具(路由见 App.tsx),
 *   工具内可经「打开」对话框继续添加;同路径复用 Tab(再开即刷新)
 * - 渲染视图:pdfjs 渲染 + 按需加载(仅渲染可见区 ±1 屏的页),
 *   页面跳转 / 缩放(dpr 适配,长文档内存可控)
 * - 表单填写:AcroForm 域枚举为侧栏面板(文本/复选/单选/下拉),值写回
 *   PDF(外观流重建,任意阅读器可见);只读域禁用展示
 * - 叠加编辑:页面上方放置文本/便签/高亮/删除线对象(所见即所得拖放),
 *   随表单值一并写回;对象可选中删除
 * - 保存:有路径 Tab 直接覆盖写回(表单 + 叠加合并应用);无路径或
 *   「另存为」经保存对话框写入
 *
 * 架构:渲染(pdfjs)与修改(pdf-lib)各司其职;修改产物(新 base64)写回
 * store 后重新渲染,保证预览与文件内容一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  FileText,
  Highlighter,
  MessageSquare,
  Minus,
  Plus,
  Save,
  Sigma,
  StickyNote,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { fileNameFromPath } from '@/tools/code-editor-workspace/languageMap';
import { formatBytes } from '@/lib/file-utils';
import { CommandError } from '@/lib/ipc';
import { usePdfDocsStore, type PdfDoc } from './pdfDocsStore';
import { fetchPdfFile, openPdfDialog, savePdfBytes, savePdfWithDialog } from './pdfOps';
import {
  applyFormValues,
  extractFormFields,
  hasChangedValues,
  initialValues,
  type FormValues,
  type PdfField,
} from './pdfForm';
import {
  applyOverlays,
  DEFAULT_OVERLAY_COLORS,
  type OverlayItem,
  type OverlayKind,
} from './pdfOverlay';
import { collectPageAspect, loadPdfDocument, PdfPageRenderer } from './pdfRender';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ToolProps } from '../registry';

/** 缩放范围与步长(按钮 ± 与 Ctrl+滚轮共用同一比例契约) */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

/** 步进缩放:±一个步长并夹在 [ZOOM_MIN, ZOOM_MAX],两位小数取整防浮点漂移 */
function zoomByStep(zoom: number, direction: 1 | -1): number {
  return Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round((zoom + direction * ZOOM_STEP) * 100) / 100),
  );
}

/**
 * 保存动作签名:执行表单 + 叠加合并写回;返回是否成功落盘(含另存为路径)。
 * 取消另存为 / 保存异常均返回 saved: false,由调用方保持文档打开。
 */
export type PdfSaveHandler = () => Promise<{ saved: boolean }>;

/** 单文档工作区:渲染视图 + 侧栏(表单 / 叠加对象) */
function PdfWorkspace({
  doc,
  onRegisterSave,
}: {
  doc: PdfDoc;
  /** 挂载时注册保存回调(根组件关闭确认的「保存并关闭」复用同一逻辑) */
  onRegisterSave: (handler: PdfSaveHandler | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const markDirty = usePdfDocsStore((s) => s.markDirty);
  const commitSaved = usePdfDocsStore((s) => s.commitSaved);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** 表单域描述与值(pdf-lib 枚举) */
  const [fields, setFields] = useState<PdfField[]>([]);
  const [values, setValues] = useState<FormValues>({});
  /** 叠加对象与当前工具模式 */
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [mode, setMode] = useState<'select' | OverlayKind>('select');
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  /** 编辑中的文本(工具模式为 text/note 时,输入后点击页面放置) */
  const [pendingText, setPendingText] = useState('');
  /** 缩放(渲染宽度 = 容器宽 × zoom) */
  const [zoom, setZoom] = useState(1);
  /** 正在保存标记(按钮禁用/进度提示) */
  const [saving, setSaving] = useState(false);
  /** 页尺寸索引采集中(大文档千页getPage可达百毫秒级,期间遮一层加载态) */
  const [collecting, setCollecting] = useState(false);

  const viewerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PdfPageRenderer | null>(null);
  /** 渲染器 effect 的异步挂接完成后的清理函数(异步路径内无法直接返回 cleanup) */
  const rendererCleanupRef = useRef<(() => void) | null>(null);
  /** 当前渲染宽度(px;renderVisible 重算用) */
  const renderWidthRef = useRef(0);

  const docId = doc.id;
  const docBase64 = doc.base64;
  const dirty =
    doc.dirty || (fields.length > 0 && hasChangedValues(fields, values)) || overlays.length > 0;

  // —— 加载 / 重载文档(字节变化 = 刷新或保存回写) ——
  // 重置与结果都经异步路径 setState(异步回调中 setState 不属于 effect 体内
  // 同步调用,规避级联渲染 lint),竞态由 cancelled 标志拦截。
  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PDFDocumentProxy | null = null;
    void (async () => {
      // 先重置上一份文档的渲染态(await 一个微任务,跳出 effect 同步段)
      await Promise.resolve();
      if (cancelled) return;
      setLoadError(null);
      setPdf(null);
      setPageCount(0);
      try {
        loadedPdf = await loadPdfDocument(docBase64);
        if (cancelled) {
          void loadedPdf.destroy();
          return;
        }
        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
        // 表单域枚举:pdf-lib 只需在字节变化时执行一次
        void import('pdf-lib').then(async ({ PDFDocument }) => {
          try {
            const pdoc = await PDFDocument.load(docBase64);
            if (cancelled) return;
            const fs = extractFormFields(pdoc);
            setFields(fs);
            setValues(initialValues(fs));
          } catch {
            // 加密/畸形文档:表单面板空置,渲染视图仍可用
            if (!cancelled) setFields([]);
          }
        });
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setFields([]);
        }
      }
    })();
    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [docBase64]);

  // —— 渲染器生命周期:文档就绪后挂接 React 渲染的 slot + 渲染器 ——
  // 页 slot 由 JSX 渲染(见下方 viewer),effect 只负责把 slot DOM 列表交给
  // PdfPageRenderer 并订阅滚动;overlay 定位天然在 slot 内,无需 rect 追踪。
  const slotIds = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount]);

  useEffect(() => {
    if (!pdf || !viewerRef.current || slotIds.length === 0) return;
    let cancelled = false;
    const container = viewerRef.current;
    void (async () => {
      // 页尺寸索引:渲染前抓取每页宽高比,slot 占位高度一次到位
      // (千页文档滚动条不从「全 400px」跳变;二分定位依赖它)
      setCollecting(true);
      let aspects: Array<{ width: number; height: number }> | undefined;
      try {
        aspects = await collectPageAspect(pdf, slotIds.length);
      } finally {
        if (!cancelled) setCollecting(false);
      }
      if (cancelled) return;
      const slots = slotIds
        .map((n) => container.querySelector<HTMLElement>(`[data-testid="pdf-page-slot-${n}"]`))
        .filter((s): s is HTMLElement => s !== null);
      if (slots.length === 0) return;
      const renderer = new PdfPageRenderer(pdf, container, slots, slots[0].clientWidth, aspects);
      renderWidthRef.current = slots[0].clientWidth;
      rendererRef.current = renderer;
      void renderer.renderVisible();

      const onScroll = () => {
        renderer.scheduleRender();
        // 状态栏页码:容器中线对应的页(由滚动位置反推,避免逐页布局查询)
        const mid = container.scrollTop + container.clientHeight / 2;
        let page = 1;
        for (let i = 0; i < slots.length; i++) {
          const top = slots[i].offsetTop;
          if (top <= mid) page = i + 1;
          else break;
        }
        setCurrentPage(page);
      };
      container.addEventListener('scroll', onScroll, { passive: true });

      const observer = new ResizeObserver(() => renderer.scheduleRerenderAll());
      observer.observe(container);

      rendererCleanupRef.current = () => {
        container.removeEventListener('scroll', onScroll);
        observer.disconnect();
        renderer.destroy();
        rendererRef.current = null;
      };
    })();
    return () => {
      cancelled = true;
      rendererCleanupRef.current?.();
      rendererCleanupRef.current = null;
    };
  }, [pdf, slotIds, zoom]);

  // —— 表单值变更 ——
  const onValueChange = useCallback(
    (name: string, value: string) => {
      setValues((v) => ({ ...v, [name]: value }));
      markDirty(docId);
    },
    [docId, markDirty],
  );

  // —— 叠加对象:点击页面放置 ——
  const onViewerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode === 'select') return;
      const target = e.target as HTMLElement;
      const slot = target.closest<HTMLElement>('[data-testid^="pdf-page-slot-"]');
      if (!slot) return;
      const pageNumber = Number(slot.getAttribute('data-testid')?.split('-').pop() ?? 0);
      if (!pageNumber) return;
      const rect = slot.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (mode === 'text' || mode === 'note') {
        if (!pendingText.trim()) {
          toast.warning(t('tools.pdf_editor.text_prompt'));
          return;
        }
      }
      const id = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: OverlayItem = {
        id,
        kind: mode,
        page: pageNumber,
        x,
        y,
        text: mode === 'text' || mode === 'note' ? pendingText : '',
        ...(mode === 'text' || mode === 'note' ? { fontSize: 14 } : {}),
        ...(mode === 'highlight' || mode === 'strike' ? { width: 120, height: 20 } : {}),
      };
      setOverlays((list) => [...list, item]);
      setSelectedOverlayId(id);
      markDirty(docId);
      if (mode === 'text' || mode === 'note') setPendingText('');
    },
    [docId, markDirty, mode, pendingText, t],
  );

  const removeOverlay = useCallback(
    (id: string) => {
      setOverlays((list) => list.filter((o) => o.id !== id));
      setSelectedOverlayId(null);
      markDirty(docId);
    },
    [docId, markDirty],
  );

  // —— Ctrl+滚轮缩放(mac 上浏览器以 Cmd+滚轮为页缩放,metaKey 同样受理) ——
  // 仅拦截带修饰键的滚轮:preventDefault 抑制 WebView 的浏览器级页面缩放;
  // 普通滚轮不拦截,保持文档纵向滚动。
  const onViewerWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom((z) => zoomByStep(z, e.deltaY < 0 ? 1 : -1));
  }, []);

  // —— 保存:表单值 + 叠加对象合并写回 ——
  // 返回 saved 供关闭流程复用:成功落盘才允许随后的关闭 Tab。
  const performSave = useCallback(
    async (targetPath: string | null): Promise<{ saved: boolean }> => {
      if (saving) return { saved: false };
      setSaving(true);
      try {
        let base64 = doc.base64;
        // 表单值优先(写回 AcroForm),叠加绘制在其结果上
        if (fields.length > 0 && hasChangedValues(fields, values)) {
          const r = await applyFormValues(base64, values);
          base64 = r.base64;
          if (r.errors.length > 0) {
            toast.warning(t('tools.pdf_editor.partial_form_save', { errors: r.errors.length }));
          }
        }
        if (overlays.length > 0 && rendererRef.current) {
          // CSS→pt 换算需要页宽比例:从 pdf 第一页视口算
          const page = await pdf?.getPage(1);
          if (page) {
            const viewport = page.getViewport({ scale: 1 });
            const scale = viewport.width / renderWidthRef.current;
            const r = await applyOverlays(base64, overlays, scale);
            base64 = r.base64;
            if (r.errors.length > 0) {
              toast.warning(
                t('tools.pdf_editor.partial_overlay_save', { errors: r.errors.length }),
              );
            }
          }
        }
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        if (targetPath) {
          await savePdfBytes(targetPath, bytes);
        } else {
          const saved = await savePdfWithDialog(
            doc.path ? fileNameFromPath(doc.path) : 'document.pdf',
            bytes,
          );
          if (saved === null) return { saved: false }; // 用户取消
          commitSaved(docId, base64, bytes.length, saved);
          toast.success(t('tools.pdf_editor.saved'));
          return { saved: true };
        }
        commitSaved(docId, base64, bytes.length);
        toast.success(t('tools.pdf_editor.saved'));
        return { saved: true };
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return { saved: false };
      } finally {
        setSaving(false);
      }
    },
    [commitSaved, doc.base64, doc.path, docId, fields, overlays, pdf, saving, t, values],
  );

  // 挂载即注册保存回调(卸载注销):根组件的关闭确认「保存并关闭」经此
  // 复用工作区内全部保存逻辑(表单 + 叠加 + 另存为分支)。依赖 performSave:
  // 保存闭包随表单值/叠加对象变化重建,注册开销可忽略。
  useEffect(() => {
    onRegisterSave(() => performSave(doc.path));
    return () => onRegisterSave(null);
  }, [doc.path, onRegisterSave, performSave]);

  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedOverlayId) ?? null,
    [overlays, selectedOverlayId],
  );

  const modeTools: Array<{ id: typeof mode; icon: typeof Type; label: string }> = [
    { id: 'select', icon: FileText, label: t('tools.pdf_editor.mode_select') },
    { id: 'text', icon: Type, label: t('tools.pdf_editor.mode_text') },
    { id: 'note', icon: StickyNote, label: t('tools.pdf_editor.mode_note') },
    { id: 'highlight', icon: Highlighter, label: t('tools.pdf_editor.mode_highlight') },
    { id: 'strike', icon: Minus, label: t('tools.pdf_editor.mode_strike') },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <p>{t('tools.pdf_editor.load_failed')}</p>
          <p className="max-w-lg break-all text-xs">{loadError}</p>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          {/* 渲染视图 */}
          <ResizablePanel defaultSize={68} minSize={40}>
            <div className="flex h-full flex-col">
              {/* 工具条(对齐 MarkdownPreview md-toolbar):左侧分段模式切换 + 文本输入,
                  右侧保存 / 页码 / 缩放;文件信息收进页码区,不再单列标题条 */}
              <div
                className="flex flex-wrap items-center gap-2 border-b border-border px-1.5 py-1"
                data-testid="pdf-toolbar"
              >
                <div
                  role="group"
                  aria-label={t('tools.pdf_editor.mode_group_aria')}
                  className="flex overflow-hidden rounded border border-border"
                >
                  {modeTools.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`pdf-mode-${m.id}`}
                      aria-pressed={mode === m.id}
                      title={m.label}
                      onClick={() => setMode(m.id)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-0.5 text-xs transition-colors',
                        mode === m.id
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                      )}
                    >
                      <m.icon aria-hidden className="size-3.5" />
                      {m.label}
                    </button>
                  ))}
                </div>

                {(mode === 'text' || mode === 'note') && (
                  <Input
                    className="h-6 w-56 text-xs"
                    placeholder={t('tools.pdf_editor.text_placeholder')}
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                    data-testid="pdf-pending-text"
                  />
                )}

                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    data-testid="pdf-save"
                    data-search-anchor="pdf_editor:save"
                    disabled={!dirty || saving}
                    onClick={() => void performSave(doc.path)}
                    title={doc.path ? t('tools.pdf_editor.save') : t('tools.pdf_editor.save_as')}
                  >
                    <Save aria-hidden className="size-3.5" />
                    {doc.path ? t('tools.pdf_editor.save') : t('tools.pdf_editor.save_as')}
                  </Button>
                  <span
                    className="text-xs text-muted-foreground"
                    title={t('tools.pdf_editor.file_meta_aria', { size: formatBytes(doc.size) })}
                    data-testid="pdf-page-indicator"
                  >
                    {formatBytes(doc.size)} · {pageCount > 0 ? `${currentPage}/${pageCount}` : '…'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      data-testid="pdf-zoom-out"
                      aria-label={t('tools.pdf_editor.zoom_out_aria')}
                      title={t('tools.pdf_editor.zoom_out_aria')}
                      onClick={() => setZoom((z) => zoomByStep(z, -1))}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Minus aria-hidden className="size-3.5" />
                    </button>
                    <span className="w-11 text-center text-xs text-muted-foreground">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      data-testid="pdf-zoom-in"
                      aria-label={t('tools.pdf_editor.zoom_in_aria')}
                      title={t('tools.pdf_editor.zoom_in_aria')}
                      onClick={() => setZoom((z) => zoomByStep(z, 1))}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Plus aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 页面滚动区:每页一个 slot(高度由渲染器按页尺寸预置),叠加对象钉在所属 slot 内 */}
              <div
                ref={viewerRef}
                className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-900"
                onClick={onViewerClick}
                onWheel={onViewerWheel}
                data-testid="pdf-viewer"
                data-search-anchor="pdf_editor:viewer"
              >
                {collecting && (
                  <div
                    role="status"
                    className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 text-xs text-muted-foreground backdrop-blur-[1px]"
                    data-testid="pdf-collecting"
                  >
                    {t('tools.pdf_editor.collecting_pages')}
                  </div>
                )}
                <div
                  className="pdf-pages flex flex-col items-center gap-4 p-4"
                  data-testid="pdf-pages"
                >
                  {slotIds.map((n) => (
                    <div
                      key={n}
                      className="relative bg-white shadow-md"
                      style={{
                        width: `calc((100% - 4rem) * ${zoom})`,
                        maxWidth: '100%',
                        // 占位高度由渲染器按页尺寸索引预置(首渲染前即准确);
                        // 渲染未挂接前(min-height)显示为白页占位
                        minHeight: 100,
                      }}
                      data-testid={`pdf-page-slot-${n}`}
                    >
                      {overlays
                        .filter((o) => o.page === n)
                        .map((o) => (
                          <OverlayChip
                            key={o.id}
                            item={o}
                            selected={o.id === selectedOverlayId}
                            onSelect={() => setSelectedOverlayId(o.id)}
                            onRemove={() => removeOverlay(o.id)}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* 侧栏:表单 + 叠加对象 */}
          <ResizablePanel defaultSize={32} minSize={20}>
            <ScrollArea className="h-full">
              <div className="space-y-4 p-3">
                {/* 表单面板 */}
                <section data-search-anchor="pdf_editor:form">
                  <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <Sigma className="size-3.5" />
                    {t('tools.pdf_editor.form_section')}
                    {fields.length > 0 && <span className="font-normal">({fields.length})</span>}
                  </h3>
                  {fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('tools.pdf_editor.no_form')}</p>
                  ) : (
                    <div className="space-y-3">
                      {fields.map((f) => (
                        <FormFieldRow
                          key={f.name}
                          field={f}
                          value={values[f.name] ?? ''}
                          onChange={onValueChange}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* 叠加对象面板 */}
                <section data-search-anchor="pdf_editor:annotations">
                  <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <MessageSquare className="size-3.5" />
                    {t('tools.pdf_editor.overlay_section')}
                    {overlays.length > 0 && (
                      <span className="font-normal">({overlays.length})</span>
                    )}
                  </h3>
                  {overlays.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('tools.pdf_editor.no_overlays')}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {overlays.map((o) => (
                        <div
                          key={o.id}
                          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                            o.id === selectedOverlayId ? 'border-ring bg-accent' : 'border-border'
                          }`}
                        >
                          <span className="truncate">
                            #{o.page} {t(`tools.pdf_editor.mode_${o.kind}`)} {o.text}
                          </span>
                          <button
                            type="button"
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            onClick={() => removeOverlay(o.id)}
                            title={t('tools.pdf_editor.remove_overlay')}
                            data-testid={`pdf-overlay-remove-${o.id}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedOverlay &&
                    (selectedOverlay.kind === 'text' || selectedOverlay.kind === 'note') && (
                      <Textarea
                        className="mt-2 min-h-16 text-xs"
                        value={selectedOverlay.text}
                        onChange={(e) => {
                          const text = e.target.value;
                          setOverlays((list) =>
                            list.map((o) => (o.id === selectedOverlay.id ? { ...o, text } : o)),
                          );
                          markDirty(docId);
                        }}
                        data-testid="pdf-overlay-text-edit"
                      />
                    )}
                </section>
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

/** 表单域渲染行(按类型分发控件;只读域禁用) */
function FormFieldRow({
  field,
  value,
  onChange,
}: {
  field: PdfField;
  value: string;
  onChange: (name: string, value: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const disabled = field.readOnly || field.type === 'button';
  const labelId = `pdf-field-${field.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          id={labelId}
          checked={value === 'true'}
          disabled={disabled}
          onCheckedChange={(v) => onChange(field.name, v ? 'true' : 'false')}
        />
        <Label htmlFor={labelId} className="text-xs">
          {field.label}
        </Label>
      </div>
    );
  }
  if (field.type === 'radio' || field.type === 'dropdown' || field.type === 'optionlist') {
    return (
      <div className="space-y-1">
        <Label htmlFor={labelId} className="text-xs">
          {field.label}
        </Label>
        <Select
          value={value || undefined}
          disabled={disabled}
          onValueChange={(v) => onChange(field.name, v)}
        >
          <SelectTrigger
            id={labelId}
            className="h-7 text-xs"
            data-testid={`pdf-field-${field.type}`}
          >
            <SelectValue placeholder={t('tools.pdf_editor.field_empty')} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={labelId} className="text-xs">
        {field.label}
      </Label>
      <Input
        id={labelId}
        className="h-7 text-xs"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(field.name, e.target.value)}
        data-testid={`pdf-field-${field.type}`}
      />
    </div>
  );
}

/** 叠加对象的可视化标记:绝对定位于所属页 slot 内(坐标即点击时的页内 CSS 像素) */
function OverlayChip({
  item,
  selected,
  onSelect,
  onRemove,
}: {
  item: OverlayItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const isBox = item.kind === 'highlight' || item.kind === 'strike';
  const width = isBox
    ? (item.width ?? 120)
    : item.text
      ? `${Math.max(24, item.text.length * 8)}px`
      : '24px';
  const height = isBox
    ? `${item.height ?? 20}px`
    : item.text
      ? `${(item.fontSize ?? 14) + 4}px`
      : '24px';
  const color = item.color ?? DEFAULT_OVERLAY_COLORS[item.kind];
  return (
    <button
      type="button"
      className={`group absolute rounded-sm border text-left ${
        selected ? 'border-ring z-20' : 'border-transparent z-10'
      }`}
      style={{
        left: item.x,
        top: item.y,
        width,
        height,
        background:
          item.kind === 'highlight'
            ? `${color}59`
            : item.kind === 'strike'
              ? 'transparent'
              : `${color}1a`,
        textDecoration: item.kind === 'strike' ? 'line-through' : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={item.text || t(`tools.pdf_editor.mode_${item.kind}`)}
      data-testid={`pdf-overlay-chip-${item.id}`}
    >
      <span
        role="button"
        tabIndex={-1}
        aria-label={t('tools.pdf_editor.remove_overlay')}
        className="absolute -right-2 -top-2 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-3" />
      </span>
      {item.kind === 'text' || item.kind === 'note' ? (
        <span
          className="pointer-events-none block truncate px-1 text-xs"
          style={{ color, fontSize: `${item.fontSize ?? 14}px`, lineHeight: height }}
        >
          {item.text}
        </span>
      ) : null}
    </button>
  );
}

/** 空态引导 */
function EmptyState({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <FileText className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('tools.pdf_editor.empty_title')}</p>
        <p className="max-w-md text-xs text-muted-foreground">{t('tools.pdf_editor.empty_desc')}</p>
      </div>
      <Button size="sm" onClick={onOpen} data-testid="pdf-open-first">
        {t('tools.pdf_editor.open')}
      </Button>
    </div>
  );
}

export function PdfEditorTool({ metadata }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const docs = usePdfDocsStore((s) => s.docs);
  const activeDocId = usePdfDocsStore((s) => s.activeDocId);
  const switchDoc = usePdfDocsStore((s) => s.switchDoc);
  const closeDoc = usePdfDocsStore((s) => s.closeDoc);
  const openPdfFromUser = usePdfDocsStore((s) => s.openPdfFromUser);
  const [opening, setOpening] = useState(false);
  /** 待确认关闭的文档(null = 无);有未保存修改(表单值/叠加对象驻留组件
   *  state,关闭即丢)前弹锚定 Tab 的三按钮确认(保存 / 不保存 / 取消),
   *  对齐文本编辑器 UnsavedPopover close-tab 模式 */
  const [closeTarget, setCloseTarget] = useState<PdfDoc | null>(null);
  /** 当前激活文档的保存回调(PdfWorkspace 挂载时注册;保存逻辑需读取
   *  工作区内的表单值/叠加对象 state,故须经 ref 上移供关闭流程复用) */
  const saveHandlerRef = useRef<PdfSaveHandler | null>(null);
  /** 「保存并关闭」执行中(禁用确认框按钮,防重复触发) */
  const [savingOnClose, setSavingOnClose] = useState(false);

  /** 注册 / 注销保存回调(PdfWorkspace 挂载与卸载时调用) */
  const registerSave = useCallback((handler: PdfSaveHandler | null) => {
    saveHandlerRef.current = handler;
  }, []);

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;

  /** Tab 栏展示顺序(PDF 无固定语义,占位以对齐标准 Tab 栏的排序钩子) */
  const sortedDocs = useMemo(() => docs, [docs]);

  /** Tab 栏滚动容器:指向 ScrollArea 内部 Viewport(div) */
  const docTabsScrollRef = useRef<HTMLDivElement>(null);

  /** 激活 Tab 变化时自动滚入视野(对齐 EditorTabsBar / VSCode 行为):
   *  Tab 横向溢出时,切到被挤出视野的 Tab 若不滚动,用户看不到切换反馈 */
  useEffect(() => {
    if (!activeDocId) return;
    const container = docTabsScrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-doc-id="${CSS.escape(activeDocId)}"]`,
    );
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const tRect = active.getBoundingClientRect();
    if (tRect.left < cRect.left) {
      container.scrollTo({ left: active.offsetLeft - 8, behavior: 'smooth' });
    } else if (tRect.right > cRect.right) {
      container.scrollTo({
        left: active.offsetLeft + active.offsetWidth - container.clientWidth + 8,
        behavior: 'smooth',
      });
    }
  }, [activeDocId, sortedDocs]);

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  /**
   * 请求关闭 Tab:有未保存修改(doc.dirty,表单值/叠加编辑都会置位)先弹
   * 锚定 Tab 的确认框;干净文档直接关(对齐 JsonFormatter / MarkdownPreview)
   */
  function requestCloseDoc(d: PdfDoc) {
    if (d.dirty) setCloseTarget(d);
    else closeDoc(d.id);
  }

  const onOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      // 对话框阶段只取元信息;内容按大小自动选择整读或 2MB 分块拉取
      // (大文件避免整读 base64 的 IPC 序列化峰值与 UI 卡顿)
      const meta = await openPdfDialog();
      if (meta) {
        const file = await fetchPdfFile(meta);
        openPdfFromUser({
          path: file.path,
          base64: file.base64,
          size: file.size,
        });
      }
    } catch (e) {
      // 超出 PDF 大小上限(fs_open_pdf_dialog → fs_read_pdf_info 的 FileTooLarge,
      // details 形如 {size, max}):展示带具体大小与上限的本地化提示,
      // 而非后端原始错误消息;details 缺失时回退原始消息
      if (e instanceof CommandError && e.code === 'ERR_FILE_TOO_LARGE') {
        const detail = e.details as { size?: number; max?: number } | undefined;
        if (typeof detail?.size === 'number' && typeof detail?.max === 'number') {
          toast.error(
            t('tools.pdf_editor.err_file_too_large', {
              size: formatBytes(detail.size),
              max: formatBytes(detail.max),
            }),
          );
          return;
        }
      }
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }, [opening, openPdfFromUser, t]);

  return (
    // 外层圆角卡片(与 JsonFormatter / MarkdownPreview 同款):rounded-lg +
    // border + shadow,overflow-hidden 让 Tab 栏顶角与卡片圆角对齐
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="pdf-editor-root"
      data-tool={metadata.id}
    >
      {/* —— 多文档 Tab 栏(样式对齐 EditorTabsBar:VSCode 风格全高 Tab) —— */}
      <div
        className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="pdf-doc-tabs"
      >
        {/* 悬浮横向滚动条(对齐 EditorTabsBar):细滑块(h-1.5)平时完全隐藏,
            悬浮 Tab 栏时才半透明浮现;绝对定位悬浮于内容之上,不占布局、
            不遮挡 Tab 文字,滚动条取代原生 overflow-x-auto 粗条 */}
        <ScrollArea
          viewportRef={docTabsScrollRef}
          orientation="horizontal"
          type="hover"
          scrollbarClassName="h-1.5 p-0"
          className="h-full min-w-0 flex-1"
        >
          <div
            role="tablist"
            aria-label={t('tools.pdf_editor.tabs_aria')}
            // min-w-max:让 Tab 行超出视口宽度,触发 Viewport 横向滚动
            className="flex h-full min-w-max items-stretch"
          >
            {sortedDocs.map((d) => {
              const active = d.id === activeDocId;
              return (
                <Popover
                  key={d.id}
                  open={closeTarget?.id === d.id}
                  onOpenChange={(o) => {
                    if (!o) setCloseTarget(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <div
                      role="tab"
                      aria-selected={active}
                      tabIndex={0}
                      data-testid="pdf-doc-tab"
                      data-doc-id={d.id}
                      onClick={() => switchDoc(d.id)}
                      onKeyDown={(e) => handleTabKeyDown(e, d.id)}
                      // 中键关闭(仿 VSCode):preventDefault 抑制浏览器自动滚动
                      onMouseDown={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          requestCloseDoc(d);
                        }
                      }}
                      className={cn(
                        // 与 EditorTabsBar 一致:全高 28px 热区、右分隔线、
                        // 激活态底部 3px 主色条 + bg-card(仿 VSCode 当前 Tab)
                        'group relative flex h-7 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs outline-none',
                        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                        active
                          ? 'border-b-[3px] border-b-primary bg-card text-foreground'
                          : 'border-b-[3px] border-b-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      <FileText
                        aria-hidden
                        className={cn(
                          'size-3.5 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                      <span className="min-w-0 truncate" title={d.title}>
                        {d.title}
                      </span>
                      {/* 未保存圆点 / 关闭按钮 共用槽位(ml-auto 锚定右侧):
                          平时显示圆点,悬停 Tab 时圆点淡出、× 在同位淡入(仿 VSCode) */}
                      <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                        {d.dirty && (
                          <span
                            aria-label={t('tools.pdf_editor.dirty')}
                            data-testid="pdf-doc-tab-dirty"
                            className="size-2 rounded-full bg-primary transition-opacity group-hover:opacity-0"
                          />
                        )}
                        <button
                          type="button"
                          aria-label={t('tools.pdf_editor.close_tab_aria', { title: d.title })}
                          title={t('tools.pdf_editor.close')}
                          data-testid="pdf-doc-tab-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestCloseDoc(d);
                          }}
                          className="absolute inset-0 z-10 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                        >
                          <X aria-hidden className="size-3" />
                        </button>
                      </span>
                    </div>
                  </PopoverTrigger>
                  {/* 关闭确认内容:锚定 Tab 下方的小 Popover;未保存时三按钮
                      (保存并关闭 / 不保存关闭 / 取消),对齐文本编辑器
                      UnsavedPopover close-tab 模式;保存失败或取消另存为时保持打开 */}
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-60 p-3"
                    data-testid="pdf-doc-close-dialog"
                  >
                    <p className="text-xs font-semibold">
                      {t('tools.pdf_editor.close_confirm_title', { title: d.title })}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t('tools.pdf_editor.close_confirm_desc')}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setCloseTarget(null)}
                        data-testid="pdf-doc-close-dialog-cancel"
                      >
                        {t('tools.pdf_editor.cancel')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          closeDoc(d.id);
                          setCloseTarget(null);
                        }}
                        data-testid="pdf-doc-close-dialog-discard"
                      >
                        {t('tools.pdf_editor.unsaved_discard')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={savingOnClose}
                        onClick={() => {
                          // 保存并关闭:成功落盘才关闭;取消另存为/保存失败保持打开
                          const save = saveHandlerRef.current;
                          if (!save) return;
                          setSavingOnClose(true);
                          void save()
                            .then(({ saved }) => {
                              if (saved) {
                                closeDoc(d.id);
                                setCloseTarget(null);
                              }
                            })
                            .finally(() => setSavingOnClose(false));
                        }}
                        data-testid="pdf-doc-close-dialog-save"
                      >
                        {t('tools.pdf_editor.unsaved_save_close')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </ScrollArea>
        {/* 「+」打开按钮固定在滚动区外右端(对齐 VSCode):Tab 溢出滚动时始终可见可点 */}
        <button
          type="button"
          data-testid="pdf-open-more"
          title={t('tools.pdf_editor.open')}
          aria-label={t('tools.pdf_editor.open')}
          onClick={() => void onOpen()}
          disabled={opening}
          className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </div>

      {docs.length === 0 || !activeDoc ? (
        <EmptyState onOpen={() => void onOpen()} />
      ) : (
        <PdfWorkspace key={activeDoc.id} doc={activeDoc} onRegisterSave={registerSave} />
      )}
    </div>
  );
}

export default PdfEditorTool;
