/**
 * 文本比较工具 —— JsonFormatter 同款布局的多 Tab 对比工作区
 *
 * 结构(与 JSON 格式化器逐点对齐):
 * - 外层圆角卡片(rounded-lg + border + shadow)+ 多文档 Tab 栏(h-9,
 *   VSCode 风格全高 Tab:激活态顶部 2px 主色条、关闭确认小 Popover、
 *   右键菜单、中键关闭、固定/重命名)。
 * - 主区域:共享组件 TextDiffView(components/text-diff)—— 双 CodeEditor
 *   并排 + jsdiff 装饰高亮 + 统计 + 行内切换 + 滚动同步,与文本编辑器的
 *   文件对比视图共用同一套渲染(见组件头注释)。
 *
 * 设计说明:
 * - 编辑器为受控模式(value/onChange,与 JsonFormatter 输入侧一致);
 *   本组件只负责 Tab 工作区状态(hydrate / 防抖持久化 / 关闭确认),
 *   差异渲染与编辑器细节全部内聚在 TextDiffView。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { Check, FileDiff, Pin, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { RenameDialog } from '@/components/RenameDialog';
import { TextDiffView } from '@/components/text-diff/TextDiffView';
import { cn } from '@/lib/utils';
import { useTextCompareStore, type CompareDoc } from './textCompareStore';
import type { ToolProps } from './registry';

/**
 * 持久化防抖窗口按载荷规模自适应(ms):载荷越大合并越久,降低全量重写的 IO 放大。
 */
function persistDelayFor(totalChars: number): number {
  if (totalChars > 1024 * 1024) return 5000;
  if (totalChars > 256 * 1024) return 2000;
  return 500;
}

export function TextCompare(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();

  // —— 多 Tab 工作区状态(模式对齐 JsonFormatter)——
  const docs = useTextCompareStore((s) => s.docs);
  const activeDocId = useTextCompareStore((s) => s.activeDocId);
  const ready = useTextCompareStore((s) => s.ready);
  const userTouched = useTextCompareStore((s) => s.userTouched);
  const newDoc = useTextCompareStore((s) => s.newDoc);
  const closeDoc = useTextCompareStore((s) => s.closeDoc);
  const switchDoc = useTextCompareStore((s) => s.switchDoc);
  const renameDoc = useTextCompareStore((s) => s.renameDoc);
  const togglePinDoc = useTextCompareStore((s) => s.togglePinDoc);
  const setDocContent = useTextCompareStore((s) => s.setDocContent);

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeDocId) ?? null,
    [docs, activeDocId],
  );
  /** Tab 栏展示顺序:固定 Tab 恒排最前(稳定排序,不改变同组内相对顺序) */
  const sortedDocs = useMemo(
    () =>
      docs.some((d) => d.pinned)
        ? [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned))
        : docs,
    [docs],
  );
  const original = activeDoc?.original ?? '';
  const modified = activeDoc?.modified ?? '';
  const setOriginal = useCallback(
    (text: string) => {
      if (activeDocId) setDocContent(activeDocId, 'original', text);
    },
    [activeDocId, setDocContent],
  );
  const setModified = useCallback(
    (text: string) => {
      if (activeDocId) setDocContent(activeDocId, 'modified', text);
    },
    [activeDocId, setDocContent],
  );

  // 启动时从 Rust config 还原文档(hydrate 内部幂等)
  useEffect(() => {
    void useTextCompareStore.getState().hydrate();
  }, []);

  // hydrate 完成后确保至少有一个文档且激活态有效(首次使用 / 数据损坏兜底)
  useEffect(() => {
    if (!ready) return;
    const s = useTextCompareStore.getState();
    if (s.docs.length === 0) {
      s.newDoc();
    } else if (!s.docs.some((d) => d.id === s.activeDocId)) {
      switchDoc(s.docs[0].id);
    }
  }, [ready, switchDoc]);

  // 文档变更防抖持久化(hydrate 前不写,避免用默认空态覆盖已存数据);
  // 防抖窗口按双内容总载荷自适应,大文档合并为一次磁盘写
  useEffect(() => {
    if (!ready || !userTouched) return;
    let total = 0;
    for (const d of docs) total += d.original.length + d.modified.length;
    const timer = setTimeout(
      () => void useTextCompareStore.getState().persistDocs(),
      persistDelayFor(total),
    );
    return () => clearTimeout(timer);
  }, [docs, ready, userTouched]);

  // 关闭确认(锚定 Tab 的小 Popover)与重命名对话框
  const [closeTarget, setCloseTarget] = useState<CompareDoc | null>(null);
  const [renameTarget, setRenameTarget] = useState<CompareDoc | null>(null);

  function requestCloseDoc(id: string) {
    const target = docs.find((d) => d.id === id);
    if (!target) return;
    setCloseTarget(target);
  }

  function confirmCloseDoc() {
    if (!closeTarget) return;
    closeDoc(closeTarget.id);
    setCloseTarget(null);
  }

  /** Tab 键盘激活(Enter / Space),配合 role=tab 的可访问性 */
  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchDoc(id);
    }
  }

  return (
    // 外层圆角卡片(与 JSON 格式化器同款):rounded-lg + border + shadow,
    // overflow-hidden 让 Tab 栏顶角与卡片圆角对齐
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="text-compare"
    >
      {/* —— 多文档 Tab 栏(样式/交互对齐 JsonFormatter:VSCode 风格全高 Tab) —— */}
      <div
        className="flex h-9 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-background-layer"
        data-testid="doc-tabs"
      >
        <div
          role="tablist"
          aria-label={t('tools.text_compare.tabs_aria')}
          // overflow-y-hidden:overflow-x:auto 会把 overflow-y 强制计算为 auto,
          // Tab(h-9)比容器内容盒(36px - 1px border-b = 35px)高 1px 即触发
          // 纵向滚动条(WebView2 经典滚动条下在窗口右缘显形为一条竖条),
          // 显式 hidden 裁掉这 1px 溢出
          className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
        >
          {sortedDocs.map((doc) => {
            const active = doc.id === activeDocId;
            return (
              <ContextMenu key={doc.id}>
                {/* 关闭确认:锚定在 Tab 旁的小 Popover(与 JsonFormatter 同款),
                    居中 modal 过重;受控 open 挂 closeTarget,三条关闭路径
                    (X 按钮/中键/右键菜单)统一落到该 Tab 的确认框上 */}
                <Popover
                  open={closeTarget?.id === doc.id}
                  onOpenChange={(o) => {
                    if (!o) setCloseTarget(null);
                  }}
                >
                  <PopoverTrigger asChild>
                    <ContextMenuTrigger asChild>
                      <div
                        role="tab"
                        aria-selected={active}
                        tabIndex={0}
                        data-testid="doc-tab"
                        data-doc-id={doc.id}
                        data-pinned={doc.pinned ? 'true' : undefined}
                        onClick={() => switchDoc(doc.id)}
                        onKeyDown={(e) => handleTabKeyDown(e, doc.id)}
                        onMouseDown={(e) => {
                          // 中键关闭(仿 VSCode):preventDefault 抑制浏览器自动滚动
                          if (e.button === 1) {
                            e.preventDefault();
                            requestCloseDoc(doc.id);
                          }
                        }}
                        className={cn(
                          // 与 EditorTabsBar 一致:全高 36px 热区、右分隔线、
                          // 激活态顶部 2px 主色条 + bg-card(仿 VSCode 当前 Tab)
                          'group relative flex h-9 shrink-0 min-w-[120px] max-w-52 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs outline-none',
                          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                          active
                            ? 'border-t-2 border-t-primary bg-card text-foreground'
                            : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                      >
                        {/* 固定 Tab 用 Pin 图标替代对比图标(与编辑器 Tab 语义一致) */}
                        {doc.pinned ? (
                          <Pin
                            aria-label={t('tools.text_compare.pinned_aria')}
                            data-testid="doc-tab-pin"
                            className={cn(
                              'size-3.5 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/70',
                            )}
                          />
                        ) : (
                          <FileDiff
                            aria-hidden
                            className={cn(
                              'size-3.5 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/70',
                            )}
                          />
                        )}
                        <span className="min-w-0 truncate" title={doc.title}>
                          {doc.title}
                        </span>
                        {/* 关闭按钮槽位:悬停 Tab 时在右侧槽位淡入 */}
                        <span className="relative ml-auto flex size-4 shrink-0 items-center justify-center">
                          <button
                            type="button"
                            aria-label={t('tools.text_compare.close_tab_aria', { title: doc.title })}
                            title={t('tools.text_compare.close')}
                            data-testid="doc-tab-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCloseDoc(doc.id);
                            }}
                            className="absolute inset-0 z-10 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                          >
                            <X aria-hidden className="size-3" />
                          </button>
                        </span>
                      </div>
                    </ContextMenuTrigger>
                  </PopoverTrigger>
                  {/* 关闭确认内容:与 JsonFormatter 同款小框,锚定 Tab 下方 */}
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-56 p-3"
                    data-testid="doc-close-dialog"
                  >
                    <p className="text-xs font-semibold">
                      {t('tools.text_compare.close_confirm_title', { title: doc.title })}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {doc.original.trim() || doc.modified.trim()
                        ? t('tools.text_compare.close_confirm_desc')
                        : t('tools.text_compare.close_confirm_empty_desc')}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setCloseTarget(null)}
                        data-testid="doc-close-dialog-cancel"
                      >
                        {t('tools.text_compare.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={confirmCloseDoc}
                        data-testid="doc-close-dialog-confirm"
                      >
                        {t('tools.text_compare.close')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Tab 右键菜单:重命名 / 固定 / 关闭 */}
                <ContextMenuContent className="w-48" data-testid="doc-tab-context-menu">
                  <ContextMenuItem
                    onSelect={() => setRenameTarget(doc)}
                    data-testid="ctx-doc-rename"
                  >
                    {t('tools.text_compare.rename')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => togglePinDoc(doc.id)}
                    data-testid="ctx-doc-toggle-pin"
                  >
                    {t('tools.text_compare.pin')}
                    {doc.pinned && (
                      <Check
                        aria-label={t('tools.text_compare.pinned_aria')}
                        data-testid="ctx-doc-pin-check"
                        className="ml-auto size-3.5 text-primary"
                      />
                    )}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => requestCloseDoc(doc.id)}
                    data-testid="ctx-doc-close"
                  >
                    {t('tools.text_compare.close')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          <button
            type="button"
            data-testid="doc-add"
            title={t('tools.text_compare.new_doc')}
            aria-label={t('tools.text_compare.new_doc')}
            onClick={() => newDoc()}
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {/* —— 主区域:共享差异视图(并排双编辑器 / 行内单体 DiffEditor) —— */}
      <TextDiffView
        original={original}
        modified={modified}
        onOriginalChange={setOriginal}
        onModifiedChange={setModified}
        originalTitle={t('tools.text_compare.original_title')}
        modifiedTitle={t('tools.text_compare.modified_title')}
        originalLanguage="plaintext"
        modifiedLanguage="plaintext"
        leftChrome={{
          showPaste: true,
          showOpenFile: true,
          showClear: true,
          placeholder: t('tools.text_compare.placeholder_original'),
        }}
        rightChrome={{
          showPaste: true,
          showOpenFile: true,
          showClear: true,
          placeholder: t('tools.text_compare.placeholder_modified'),
        }}
        searchAnchor="text_compare:diff"
        leftSearchAnchor="text_compare:original"
        rightSearchAnchor="text_compare:modified"
        testIdPrefix="diff"
      />

      {/* —— 重命名对话框(条件渲染:关闭即卸载,每次打开取最新标题) —— */}
      {renameTarget && (
        <RenameDialog
          open
          title={t('tools.text_compare.rename_dialog_title')}
          initialValue={renameTarget.title}
          onConfirm={(name) => {
            renameDoc(renameTarget.id, name);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
          data-testid="doc-rename-dialog"
        />
      )}
    </div>
  );
}
