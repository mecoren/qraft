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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { fileNameFromPath } from '@/tools/code-editor-workspace/languageMap';
import { formatBytes } from '@/lib/file-utils';
import { CommandError } from '@/lib/ipc';
import { usePdfDocsStore, type PdfDoc } from './pdfDocsStore';
import { openPdfDialog, savePdfBytes, savePdfWithDialog } from './pdfOps';
import {
  applyFormValues,
  extractFormFields,
  hasChangedValues,
  initialValues,
  type FormValues,
  type PdfField,
} from './pdfForm';
import { applyOverlays, DEFAULT_OVERLAY_COLORS, type OverlayItem, type OverlayKind } from './pdfOverlay';
import { loadPdfDocument, PdfPageRenderer } from './pdfRender';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ToolProps } from '../registry';

/** 单文档工作区:渲染视图 + 侧栏(表单 / 叠加对象) */
function PdfWorkspace({ doc }: { doc: PdfDoc }): JSX.Element {
  const { t } = useTranslation();
  const markDirty = usePdfDocsStore((s) => s.markDirty);
  const commitSaved = usePdfDocsStore((s) => s.commitSaved);
  const closeDoc = usePdfDocsStore((s) => s.closeDoc);

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

  const viewerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PdfPageRenderer | null>(null);
  /** 当前渲染宽度(px;renderVisible 重算用) */
  const renderWidthRef = useRef(0);

  const docId = doc.id;
  const docBase64 = doc.base64;
  const dirty =
    doc.dirty ||
    (fields.length > 0 && hasChangedValues(fields, values)) ||
    overlays.length > 0;

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
  const slotIds = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1),
    [pageCount],
  );

  useEffect(() => {
    if (!pdf || !viewerRef.current || slotIds.length === 0) return;
    const container = viewerRef.current;
    const slots = slotIds
      .map((n) => container.querySelector<HTMLElement>(`[data-testid="pdf-page-slot-${n}"]`))
      .filter((s): s is HTMLElement => s !== null);
    if (slots.length === 0) return;
    const renderer = new PdfPageRenderer(pdf, container, slots, slots[0].clientWidth);
    renderWidthRef.current = slots[0].clientWidth;
    rendererRef.current = renderer;
    void renderer.renderVisible();

    const onScroll = () => {
      renderer.scheduleRender();
      // 状态栏页码:第一个 slot 顶边越过容器中线的页
      const mid = container.getBoundingClientRect().top + container.clientHeight / 2;
      let page = 1;
      for (let i = 0; i < slots.length; i++) {
        const r = slots[i].getBoundingClientRect();
        if (r.top <= mid) page = i + 1;
        else break;
      }
      setCurrentPage(page);
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => renderer.scheduleRerenderAll());
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
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

  // —— 保存:表单值 + 叠加对象合并写回 ——
  const performSave = useCallback(
    async (targetPath: string | null) => {
      if (saving) return;
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
              toast.warning(t('tools.pdf_editor.partial_overlay_save', { errors: r.errors.length }));
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
          if (saved === null) return; // 用户取消
          commitSaved(docId, base64, bytes.length, saved);
          toast.success(t('tools.pdf_editor.saved'));
          return;
        }
        commitSaved(docId, base64, bytes.length);
        toast.success(t('tools.pdf_editor.saved'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [commitSaved, doc.base64, doc.path, docId, fields, overlays, pdf, saving, t, values],
  );

  // —— 未保存关闭确认 ——
  const onCloseTab = useCallback(() => {
    if (!dirty) {
      closeDoc(docId);
      return;
    }
    const ok = window.confirm(t('tools.pdf_editor.close_dirty_confirm'));
    if (ok) closeDoc(docId);
  }, [closeDoc, dirty, docId, t]);

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
      {/* Tab 栏:标题 + 未保存标记 + 关闭 */}
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate text-sm font-medium">{doc.title}</span>
        {dirty && <span className="size-2 shrink-0 rounded-full bg-amber-500" title={t('tools.pdf_editor.dirty')} />}
        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
          {formatBytes(doc.size)} · {pageCount > 0 ? `${currentPage}/${pageCount}` : '…'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            data-testid="pdf-save"
            data-search-anchor="pdf_editor:save"
            disabled={!dirty || saving}
            onClick={() => void performSave(doc.path)}
            title={doc.path ? t('tools.pdf_editor.save') : t('tools.pdf_editor.save_as')}
          >
            <Save className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" data-testid="pdf-close-tab" onClick={onCloseTab}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

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
              {/* 工具条:模式 / 文本输入 / 缩放 */}
              <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
                {modeTools.map((m) => (
                  <Button
                    key={m.id}
                    variant={mode === m.id ? 'secondary' : 'ghost'}
                    size="sm"
                    data-testid={`pdf-mode-${m.id}`}
                    title={m.label}
                    onClick={() => setMode(m.id)}
                  >
                    <m.icon className="size-4" />
                  </Button>
                ))}
                {(mode === 'text' || mode === 'note') && (
                  <Input
                    className="ml-2 h-7 w-56 text-xs"
                    placeholder={t('tools.pdf_editor.text_placeholder')}
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                    data-testid="pdf-pending-text"
                  />
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
                    data-testid="pdf-zoom-out"
                  >
                    <Minus className="size-4" />
                  </Button>
                  <span className="w-12 text-center text-xs text-muted-foreground">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
                    data-testid="pdf-zoom-in"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {/* 页面滚动区:每页一个 slot(高度渲染后回填),叠加对象钉在所属 slot 内 */}
              <div
                ref={viewerRef}
                className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-900"
                onClick={onViewerClick}
                data-testid="pdf-viewer"
                data-search-anchor="pdf_editor:viewer"
              >
                <div className="pdf-pages flex flex-col items-center gap-4 p-4" data-testid="pdf-pages">
                  {slotIds.map((n) => (
                    <div
                      key={n}
                      className="relative bg-white shadow-md"
                      style={{ width: `calc((100% - 4rem) * ${zoom})`, maxWidth: '100%', height: 400 }}
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
                    {fields.length > 0 && (
                      <span className="font-normal">({fields.length})</span>
                    )}
                  </h3>
                  {fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('tools.pdf_editor.no_form')}</p>
                  ) : (
                    <div className="space-y-3">
                      {fields.map((f) => (
                        <FormFieldRow key={f.name} field={f} value={values[f.name] ?? ''} onChange={onValueChange} />
                      ))}
                    </div>
                  )}
                </section>

                {/* 叠加对象面板 */}
                <section data-search-anchor="pdf_editor:annotations">
                  <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <MessageSquare className="size-3.5" />
                    {t('tools.pdf_editor.overlay_section')}
                    {overlays.length > 0 && <span className="font-normal">({overlays.length})</span>}
                  </h3>
                  {overlays.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('tools.pdf_editor.no_overlays')}</p>
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
                  {selectedOverlay && (selectedOverlay.kind === 'text' || selectedOverlay.kind === 'note') && (
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
          <SelectTrigger id={labelId} className="h-7 text-xs" data-testid={`pdf-field-${field.type}`}>
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
  const width = isBox ? (item.width ?? 120) : item.text ? `${Math.max(24, item.text.length * 8)}px` : '24px';
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
          item.kind === 'highlight' ? `${color}59` : item.kind === 'strike' ? 'transparent' : `${color}1a`,
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
  const openPdfFromUser = usePdfDocsStore((s) => s.openPdfFromUser);
  const [opening, setOpening] = useState(false);

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;

  const onOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const file = await openPdfDialog();
      if (file) {
        openPdfFromUser({
          path: file.path,
          base64: bytesToBase64Local(file.bytes),
          size: file.size,
        });
      }
    } catch (e) {
      // 超出 PDF 大小上限(fs_open_pdf_dialog → fs_read_pdf 的 FileTooLarge,
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
    <div className="flex h-full min-h-0 flex-col gap-2 p-3" data-testid="pdf-editor-root" data-tool={metadata.id}>
      {/* 文件级 Tab 栏(多文档切换 + 打开) */}
      <div className="flex items-center gap-1 overflow-x-auto border-b pb-1.5">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`flex shrink-0 items-center gap-1 rounded-t px-3 py-1 text-xs transition-colors ${
              d.id === activeDocId ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
            onClick={() => switchDoc(d.id)}
            data-testid={`pdf-tab-${d.title}`}
          >
            {d.title}
            {d.dirty && <span className="size-1.5 rounded-full bg-amber-500" />}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void onOpen()}
          disabled={opening}
          title={t('tools.pdf_editor.open')}
          data-testid="pdf-open-more"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {docs.length === 0 || !activeDoc ? (
        <EmptyState onOpen={() => void onOpen()} />
      ) : (
        <PdfWorkspace key={activeDoc.id} doc={activeDoc} />
      )}
    </div>
  );
}

/** Uint8Array → base64(分块,与 lib/file-utils 同策略;模块内避免循环依赖) */
function bytesToBase64Local(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export default PdfEditorTool;
