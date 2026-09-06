/**
 * Office 工具(docx / xlsx / pptx 简易查看与编辑)
 *
 * 能力:
 * - 多 Tab 工作区:文件关联/拖放 Office 文档自动进入本工具(路由见
 *   App.tsx,与 PDF 同口径),工具内可经「打开」对话框继续添加;
 *   同路径复用 Tab(再开即刷新)
 * - Word(docx/docm):docx-preview 分页渲染(只读预览)
 * - Excel(xlsx/xlsm):SheetJS 解析为文本矩阵,表格内直接编辑单元格,
 *   编辑结果可导出为 xlsx 新文件(另存,不覆盖原文件)
 * - PowerPoint(pptx/pptm):jszip 简易解析,逐页展示文本段落与图片
 * - 旧二进制格式(doc/xls/ppt,MS Office 与 WPS 互通的 97-2003 格式):
 *   前端渲染库无法解析,展示转换指引(建议在 WPS/Office 中另存为
 *   docx/xlsx/pptx 后再打开)
 *
 * 架构:全部渲染/解析依赖(docx-preview、@e965/xlsx、jszip)经懒加载
 * import() 引入,只在打开本工具时随独立 chunk 加载(启动零开销);
 * 文件字节经 fs_read_office 走授权路径 IPC(base64)。
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Presentation, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fileNameFromPath } from '@/tools/code-editor-workspace/languageMap';
import { formatBytes } from '@/lib/file-utils';
import { CommandError } from '@/lib/ipc';
import { base64ToBytes, bytesToBase64 } from '@/lib/file-utils';
import { useOfficeDocsStore, type OfficeDoc, type OfficeKind } from './officeDocsStore';
import { openOfficeDialog, readOfficeFile } from './officeOps';
import { renderDocx } from './docxRender';
import { exportRowsToXlsx, parseWorkbook, type SheetModel, type WorkbookModel } from './xlsxModel';
import { parsePptx, type PptxModel } from './pptxModel';
import type { ToolProps } from '../registry';

/** 各渲染类别的 Tab 图标 */
const KIND_ICONS: Record<OfficeKind, typeof FileText> = {
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  legacy: FileText,
};

/** Excel 单元格直接编辑的行列上限(超出进入只读表格,防百万行卡死) */
const XLSX_EDIT_MAX_ROWS = 2_000;
const XLSX_EDIT_MAX_COLS = 100;

// ============================================================
// Word 视图(docx-preview 渲染,只读)
// ============================================================

/** Word 文档渲染视图:容器 + 懒加载渲染;失败展示错误态 */
function WordView({ doc }: { doc: OfficeDoc }): JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  // doc.base64 变化经外层 key={activeDoc.id} 重挂载;首次挂载即渲染。
  // setState 只发生在异步回调内(渲染完成/失败),不在 effect 体内同步调用
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void renderDocx(container, base64ToBytes(doc.base64))
      .then((done) => {
        if (cancelled) {
          done();
          return;
        }
        cleanup = done;
        setRendered(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [doc.base64]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <FileText className="size-10 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('tools.office_editor.load_failed', { message: error })}
        </p>
      </div>
    );
  }
  return (
    <div
      className="h-full min-h-0"
      data-testid="office-word-view"
      data-search-anchor="office_editor:word"
    >
      {!rendered && (
        <p className="p-6 text-xs text-muted-foreground">{t('tools.office_editor.loading')}</p>
      )}
      {/* docx-preview 注入 .office-docx-wrapper(分页纸张);仅做宽度约束 */}
      <div ref={containerRef} className="office-docx-host h-full min-h-0 overflow-auto p-4" />
    </div>
  );
}

// ============================================================
// Excel 视图(SheetJS 解析 + 单元格编辑 + 导出)
// ============================================================

/** Excel 工作区:工作表切换 + 表格视图(可编辑/只读)+ 导出 */
function ExcelView({ doc }: { doc: OfficeDoc }): JSX.Element {
  const { t } = useTranslation();
  /** 解析在 useState 初始化器中同步完成;doc.base64 变化经外层 key 重挂载 */
  const [model] = useState<WorkbookModel | null>(() => {
    try {
      return parseWorkbook(base64ToBytes(doc.base64));
    } catch {
      return null;
    }
  });
  const [activeSheet, setActiveSheet] = useState(0);
  /** 编辑态:行文本矩阵(与 model.rows 同构);null = 尚未编辑(只读展示) */
  const [editRows, setEditRows] = useState<string[][] | null>(null);
  const [exporting, setExporting] = useState(false);

  const sheet: SheetModel | null = model?.sheets[activeSheet] ?? null;
  const rows = editRows ?? sheet?.rows.map((r) => r.map((c) => c.text)) ?? null;
  const tooLarge =
    (sheet?.rows.length ?? 0) > XLSX_EDIT_MAX_ROWS ||
    (sheet?.rows[0]?.length ?? 0) > XLSX_EDIT_MAX_COLS;

  /** 编辑落格:仅小表开放;首格落格时把只读矩阵克隆为可编辑态(允许全表改) */
  const setCell = (r: number, c: number, value: string): void => {
    if (tooLarge || !rows) return;
    setEditRows((prev) => {
      // 未编辑过:从展示矩阵深克隆;已编辑:克隆前一行再改,保证引用不变式
      const base = prev ?? rows.map((row) => [...row]);
      const next = base.map((row) => [...row]);
      while (next.length <= r) next.push([]);
      const row = next[r] ? [...next[r]] : [];
      while (row.length < c) row.push('');
      row[c] = value;
      next[r] = row;
      return next;
    });
  };

  /** 导出编辑结果为 xlsx 新文件(另存,不覆盖原文件) */
  const onExport = useCallback(async () => {
    if (!rows || !sheet) return;
    setExporting(true);
    try {
      const bytes = exportRowsToXlsx(rows, sheet.name);
      const saved = await invokeSaveBytes(`${fileNameFromPath(doc.path)}.xlsx`, bytes);
      if (saved) toast.success(t('tools.office_editor.export_saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [rows, sheet, doc.path, t]);

  if (!model) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <FileSpreadsheet className="size-10 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('tools.office_editor.load_failed', { message: 'invalid xlsx' })}
        </p>
      </div>
    );
  }
  if (!rows) {
    return <p className="p-6 text-xs text-muted-foreground">{t('tools.office_editor.loading')}</p>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="office-excel-view"
      data-search-anchor="office_editor:excel"
    >
      {/* 工具栏:工作表切换 + 导出 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {model.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-xs transition-colors',
                i === activeSheet
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={exporting || tooLarge}
          onClick={() => void onExport()}
          data-testid="office-xlsx-export"
        >
          {t('tools.office_editor.export_xlsx')}
        </Button>
      </div>

      {/* 表格区:首行首列吸附;可编辑时单元格为 input。
          key 用「行-列」坐标:电子表格单元格的身份即坐标,增删行列时
          React 能正确复用 DOM,不受数组下标变动影响 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max border-collapse text-xs" data-testid="office-xlsx-table">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-10 border border-border bg-background-layer px-1 py-1 text-right font-normal text-muted-foreground" />
              {rows[0]?.map((_, c) => (
                <th
                  key={`col-${c}`}
                  className="sticky top-0 z-10 min-w-24 border border-border bg-background-layer px-2 py-1 text-left font-normal text-muted-foreground"
                >
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={`row-${r}`}>
                <th className="sticky left-0 z-10 w-10 border border-border bg-background-layer px-1 py-1 text-right font-normal text-muted-foreground">
                  {r + 1}
                </th>
                {rows[0]?.map((_, c) => {
                  const value = row[c] ?? '';
                  const cellKey = `cell-${r}-${c}`;
                  if (tooLarge) {
                    return (
                      <td
                        key={cellKey}
                        className="max-w-64 truncate border border-border px-2 py-1"
                      >
                        {value}
                      </td>
                    );
                  }
                  return (
                    <td key={cellKey} className="border border-border p-0">
                      <input
                        type="text"
                        value={value}
                        aria-label={`${columnLabel(c)}${r + 1}`}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        className="w-full min-w-24 max-w-64 bg-transparent px-2 py-1 outline-none focus:bg-accent/40 focus:ring-1 focus:ring-inset focus:ring-ring"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 底部状态:行列数 / 编辑提示 */}
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-muted-foreground">
        <span>
          {t('tools.office_editor.sheet_stats', { rows: rows.length, cols: rows[0]?.length ?? 0 })}
        </span>
        {tooLarge && <span>{t('tools.office_editor.readonly_large')}</span>}
        {editRows && !tooLarge && <span>{t('tools.office_editor.edited_hint')}</span>}
      </div>
    </div>
  );
}

/** 列序号 → Excel 列标(0 → A,25 → Z,26 → AA) */
function columnLabel(c: number): string {
  let label = '';
  let n = c;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

// ============================================================
// PowerPoint 视图(jzip 简易解析:文本段落 + 图片)
// ============================================================

/** PowerPoint 简易视图:逐页展示段落与图片(只读) */
function PowerPointView({ doc }: { doc: OfficeDoc }): JSX.Element {
  const { t } = useTranslation();
  const [model, setModel] = useState<PptxModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  // doc.base64 变化经外层 key={activeDoc.id} 重挂载;setState 只发生在
  // 异步回调内(解析完成/失败),不在 effect 体内同步调用
  useEffect(() => {
    let cancelled = false;
    void parsePptx(base64ToBytes(doc.base64))
      .then((m) => {
        if (!cancelled) setModel(m);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [doc.base64]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Presentation className="size-10 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('tools.office_editor.load_failed', { message: error })}
        </p>
      </div>
    );
  }
  if (!model) {
    return <p className="p-6 text-xs text-muted-foreground">{t('tools.office_editor.loading')}</p>;
  }

  const slide = model.slides[Math.min(current, model.slides.length - 1)];
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center gap-3 p-4"
      data-testid="office-ppt-view"
      data-search-anchor="office_editor:powerpoint"
    >
      {/* 画布:幻灯片比例缩放至容器宽度 */}
      <div
        className="flex w-full max-w-4xl flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-4"
        style={{ aspectRatio: `${model.width} / ${model.height}` }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-auto">
          {slide.paragraphs.map((p, i) => (
            // 段落 key 用「内容哈希 + 序」:段落顺序即展示语义,内容相同的
            // 空段落(空行占位)以序号区分
            <p
              key={`p-${i}-${p.text.length}`}
              className="w-full break-words text-center text-xs leading-relaxed"
            >
              {p.text}
            </p>
          ))}
          {slide.images[0] && (
            <img
              src={slide.images[0]}
              alt={t('tools.office_editor.slide_image_alt')}
              className="max-h-60 max-w-full object-contain"
            />
          )}
          {slide.paragraphs.length === 0 && !slide.images[0] && (
            <p className="text-xs text-muted-foreground">{t('tools.office_editor.slide_empty')}</p>
          )}
        </div>
      </div>

      {/* 翻页器 */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={current === 0}
          onClick={() => setCurrent((v) => Math.max(0, v - 1))}
        >
          {t('tools.office_editor.prev_slide')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('tools.office_editor.slide_indicator', {
            current: current + 1,
            total: model.slides.length,
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={current >= model.slides.length - 1}
          onClick={() => setCurrent((v) => Math.min(model.slides.length - 1, v + 1))}
        >
          {t('tools.office_editor.next_slide')}
        </Button>
      </div>
      <p className="shrink-0 text-[10px] text-muted-foreground">
        {t('tools.office_editor.pptx_simple_hint')}
      </p>
    </div>
  );
}

// ============================================================
// 旧格式指引(doc / xls / ppt:WPS 与 MS Office 互通的 97-2003 二进制)
// ============================================================

/** 旧二进制格式视图:说明 + 转换指引 */
function LegacyView({ doc }: { doc: OfficeDoc }): JSX.Element {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[doc.kind];
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="office-legacy-view"
    >
      <Icon className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('tools.office_editor.legacy_title')}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {t('tools.office_editor.legacy_desc')}
        </p>
      </div>
      <ol className="max-w-md list-decimal space-y-1 pl-6 text-left text-xs text-muted-foreground">
        <li>{t('tools.office_editor.legacy_step1')}</li>
        <li>{t('tools.office_editor.legacy_step2')}</li>
        <li>{t('tools.office_editor.legacy_step3')}</li>
      </ol>
    </div>
  );
}

/** 弹「另存为」写 xlsx 字节;返回是否成功(取消/失败 false) */
async function invokeSaveBytes(fileName: string, bytes: Uint8Array): Promise<boolean> {
  const { invokeCommand } = await import('@/lib/ipc');
  const saved = await invokeCommand<string | null>('fs_save_bytes', {
    fileName,
    base64: bytesToBase64(bytes),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return saved !== null;
}

// ============================================================
// 根组件:多 Tab 工作区
// ============================================================

/** 空态引导 */
function EmptyState({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <FileText className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('tools.office_editor.empty_title')}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {t('tools.office_editor.empty_desc')}
        </p>
      </div>
      <Button size="sm" onClick={onOpen} data-testid="office-open-first">
        {t('tools.office_editor.open')}
      </Button>
    </div>
  );
}

export function OfficeEditorTool({ metadata }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const docs = useOfficeDocsStore((s) => s.docs);
  const activeDocId = useOfficeDocsStore((s) => s.activeDocId);
  const switchDoc = useOfficeDocsStore((s) => s.switchDoc);
  const closeDoc = useOfficeDocsStore((s) => s.closeDoc);
  const openOfficeFromSystem = useOfficeDocsStore((s) => s.openOfficeFromSystem);
  const [opening, setOpening] = useState(false);

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;

  const onOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const meta = await openOfficeDialog();
      if (meta) {
        const file = await readOfficeFile(meta.path);
        openOfficeFromSystem({ path: file.path, base64: file.base64, size: file.size });
      }
    } catch (e) {
      // 超出大小上限(fs_read_office 的 FileTooLarge,details 形如 {size, max}):
      // 本地化提示具体大小与上限;其余失败展示原始消息
      if (e instanceof CommandError && e.code === 'ERR_FILE_TOO_LARGE') {
        const detail = e.details as { size?: number; max?: number } | undefined;
        if (typeof detail?.size === 'number' && typeof detail?.max === 'number') {
          toast.error(
            t('tools.office_editor.err_file_too_large', {
              size: formatBytes(detail.size),
              max: formatBytes(detail.max),
            }),
          );
          return;
        }
      }
      toast.error(
        t('tools.office_editor.open_failed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setOpening(false);
    }
  }, [opening, openOfficeFromSystem, t]);

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="office-editor-root"
      data-tool={metadata.id}
    >
      {/* —— 多文档 Tab 栏(样式对齐 PdfEditor / EditorTabsBar) —— */}
      <div
        className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="office-doc-tabs"
        data-search-anchor="office_editor:tabs"
      >
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            role="tablist"
            aria-label={t('tools.office_editor.tabs_aria')}
            className="flex h-full min-w-max items-stretch"
          >
            {docs.map((d) => {
              const active = d.id === activeDocId;
              const Icon = KIND_ICONS[d.kind];
              return (
                <div
                  key={d.id}
                  role="tab"
                  aria-selected={active}
                  tabIndex={0}
                  data-testid="office-doc-tab"
                  data-doc-id={d.id}
                  onClick={() => switchDoc(d.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, d.id)}
                  className={cn(
                    'group relative flex h-7 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs outline-none',
                    'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                    active
                      ? 'border-b-[3px] border-b-primary bg-card text-foreground'
                      : 'border-b-[3px] border-b-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      'size-3.5 shrink-0',
                      active ? 'text-primary' : 'text-muted-foreground/70',
                    )}
                  />
                  <span className="min-w-0 truncate" title={`${d.title} · ${formatBytes(d.size)}`}>
                    {d.title}
                  </span>
                  <button
                    type="button"
                    aria-label={t('tools.office_editor.close_tab_aria', { title: d.title })}
                    title={t('tools.office_editor.close')}
                    data-testid="office-doc-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeDoc(d.id);
                    }}
                    className="absolute right-1 flex size-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {/* 「+」打开按钮固定在滚动区外右端 */}
        <button
          type="button"
          data-testid="office-open-more"
          title={t('tools.office_editor.open')}
          aria-label={t('tools.office_editor.open')}
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
        <OfficeWorkspace key={activeDoc.id} doc={activeDoc} />
      )}
    </div>
  );
}

/** 单文档工作区:按渲染类别分发 */
function OfficeWorkspace({ doc }: { doc: OfficeDoc }): JSX.Element {
  switch (doc.kind) {
    case 'word':
      return <WordView doc={doc} />;
    case 'excel':
      return <ExcelView doc={doc} />;
    case 'powerpoint':
      return <PowerPointView doc={doc} />;
    case 'legacy':
      return <LegacyView doc={doc} />;
  }
}

export default OfficeEditorTool;
