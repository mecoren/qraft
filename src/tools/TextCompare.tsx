/**
 * 文本比较工具 —— 基于 Monaco DiffEditor 的旗舰页面
 *
 * 结构:
 * - 顶部工具栏:行内模式开关 + 差异统计(+新增 −删除 ~修改)+ 原始/修改后文本的
 *   粘贴 / 打开文件 / 清除 操作 + 全屏按钮
 * - 主区域:单个 Monaco DiffEditor,左右两个面板均可直接编辑填值,
 *   差异由 Monaco 实时高亮;行内模式切换 renderSideBySide
 * - 全屏弹窗:只读放大展示当前差异
 *
 * 设计说明:
 * - @monaco-editor/react 的 DiffEditor 对 original / modified props 是受控的
 *   (任一变化即 setModel 重建 model、重置光标),因此这里采用非受控策略:
 *   挂载时传入空串作为初始值,之后一律通过编辑器实例 setValue 修改内容,
 *   当前文本保存在 ref 中,避免每次按键都重建 diff model。
 * - 差异统计来自 diffEditor.getLineChanges()(onDidUpdateDiff 时刷新),
 *   语义与旧版 alignDiff / summarizeDiff 保持一致:新增行 / 删除行 / 修改行。
 * - Monaco 的行内模式(renderSideBySide=false)下 original 侧为只读(引擎限制)。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  DiffEditor,
  type DiffBeforeMount,
  type Monaco,
  type MonacoDiffEditor,
} from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ClipboardPaste, Columns2, FolderOpen, Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { defineThemeFor, getThemeName, useMonacoTheme } from '@/components/ui/monaco-theme';
import { readClipboardText } from '@/lib/clipboard';
import { readFileAsText } from '@/lib/file-utils';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import type { ToolProps } from './registry';

// Monaco loader 路径配置(import 即执行,保证任何 DiffEditor 挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

type DiffTarget = 'original' | 'modified';

interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

const ZERO_STATS: DiffStats = { added: 0, removed: 0, modified: 0 };

/** 把 Monaco 的 ILineChange 汇总为新增 / 删除 / 修改 行数 */
function summarizeLineChanges(changes: readonly editor.ILineChange[]): DiffStats {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const c of changes) {
    const origCount =
      c.originalStartLineNumber > 0 ? c.originalEndLineNumber - c.originalStartLineNumber + 1 : 0;
    const modCount =
      c.modifiedStartLineNumber > 0 ? c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1 : 0;
    const paired = Math.min(origCount, modCount);
    modified += paired;
    added += modCount - paired;
    removed += origCount - paired;
  }
  return { added, removed, modified };
}

function ToolbarButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

export function TextCompare(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [inlineMode, setInlineMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [stats, setStats] = useState<DiffStats>(ZERO_STATS);
  // 全屏打开瞬间的文本快照(全屏为只读展示,无需实时同步)
  const [fullscreenSnapshot, setFullscreenSnapshot] = useState<{
    original: string;
    modified: string;
  } | null>(null);
  const themeName = useMonacoTheme();

  const diffRef = useRef<MonacoDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const originalTextRef = useRef('');
  const modifiedTextRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<DiffTarget>('modified');

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  }, []);

  /** 从 DiffEditor 实例读取 diff 统计 */
  const refreshStats = useCallback(() => {
    const diff = diffRef.current;
    if (!diff) return;
    const changes = diff.getLineChanges();
    setStats(changes ? summarizeLineChanges(changes) : ZERO_STATS);
  }, []);

  const handleMount = useCallback(
    (diff: MonacoDiffEditor, monaco: Monaco) => {
      monacoRef.current = monaco;
      diffRef.current = diff;
      originalTextRef.current = diff.getOriginalEditor().getValue();
      modifiedTextRef.current = diff.getModifiedEditor().getValue();

      // diff 重算完成时刷新统计(输入会触发重算)
      diff.onDidUpdateDiff(() => refreshStats());
      // 内容变化时同步 ref
      diff.getOriginalEditor().onDidChangeModelContent(() => {
        originalTextRef.current = diff.getOriginalEditor().getValue();
      });
      diff.getModifiedEditor().onDidChangeModelContent(() => {
        modifiedTextRef.current = diff.getModifiedEditor().getValue();
      });
      refreshStats();
    },
    [refreshStats],
  );

  const setText = (target: DiffTarget, text: string): void => {
    const diff = diffRef.current;
    if (!diff) return;
    const side = target === 'original' ? diff.getOriginalEditor() : diff.getModifiedEditor();
    side.setValue(text);
  };

  const handlePaste = async (target: DiffTarget): Promise<void> => {
    const text = await readClipboardText();
    if (!text) {
      toast.info(t('tools.text_compare.toast_clipboard_empty'));
      return;
    }
    setText(target, text);
  };

  const handleFileChange = async (files: FileList | null): Promise<void> => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      setText(fileTargetRef.current, text);
    } catch {
      toast.error(t('tools.text_compare.toast_read_file_failed'));
    }
    // 允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pickFile = (target: DiffTarget): void => {
    fileTargetRef.current = target;
    fileInputRef.current?.click();
  };

  const clearText = (target: DiffTarget): void => {
    setText(target, '');
  };

  const openFullscreen = useCallback(() => {
    setFullscreenSnapshot({
      original: originalTextRef.current,
      modified: modifiedTextRef.current,
    });
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback((open: boolean) => {
    setFullscreen(open);
    if (!open) setFullscreenSnapshot(null);
  }, []);

  const hasDiff = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  /** 与 CodeEditor 保持一致的展示优化 options(字号随设置档位缩放) */
  const editorFontSize = useEditorFontSize();
  const diffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      originalEditable: true,
      readOnly: false,
      renderSideBySide: !inlineMode,
      // Monaco 默认 useShadowDOM: true,编辑器与分隔条(sash)渲染在 Shadow DOM 内,
      // 应用样式无法穿透覆盖;关闭后由 globals.css 统一分隔条悬浮高亮样式
      useShadowDOM: false,
      fontFamily:
        "var(--app-mono-font-family, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontLigatures: true,
      fontSize: editorFontSize.fontSize,
      lineHeight: editorFontSize.lineHeight,
      lineNumbers: 'on',
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      diffWordWrap: 'on',
      tabSize: 2,
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10, bottom: 10 },
      scrollbar: {
        // 与全局滚动条美化一致:轨道 10px、滑块可见 6px
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        verticalSliderSize: 6,
        horizontalSliderSize: 6,
        useShadows: false,
      },
      guides: {
        indentation: true,
        highlightActiveIndentation: true,
      },
      bracketPairColorization: { enabled: true },
      roundedSelection: true,
      overviewRulerLanes: 0,
      scrollBeyondLastColumn: 0,
      contextmenu: true,
      fixedOverflowWidgets: true,
      // 不折叠未变更区域,保持与旧版一致的"全量并排"观感
      hideUnchangedRegions: { enabled: false },
    }),
    [inlineMode, editorFontSize],
  );

  const renderActionGroup = (label: string, target: DiffTarget) => (
    <div className="flex items-center gap-0.5" data-search-anchor={`text_compare:${target}`}>
      <span className="mr-0.5 text-xs text-muted-foreground">{label}</span>
      <ToolbarButton
        label={t('tools.text_compare.action_paste_aria', { label })}
        testId={`paste-${target}`}
        onClick={() => void handlePaste(target)}
      >
        <ClipboardPaste aria-hidden className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('tools.text_compare.action_open_file_aria', { label })}
        testId={`open-${target}`}
        onClick={() => pickFile(target)}
      >
        <FolderOpen aria-hidden className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label={t('tools.text_compare.action_clear_aria', { label })}
        testId={`clear-${target}`}
        onClick={() => clearText(target)}
      >
        <X aria-hidden className="size-3.5" />
      </ToolbarButton>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-3" data-testid="text-compare">
      {/* 顶部工具栏:行内模式 + 差异统计 + 操作 */}
      <section aria-label={t('tools.text_compare.config_aria')} data-search-anchor="text_compare:config">
        <div className="rounded-lg border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <Columns2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-body-sm">{t('tools.text_compare.inline_mode')}</span>
              <span className="text-xs text-muted-foreground">
                {inlineMode
                  ? t('tools.text_compare.inline_mode_on')
                  : t('tools.text_compare.inline_mode_off')}
              </span>
              <Switch
                data-testid="inline-mode-switch"
                aria-label={t('tools.text_compare.inline_mode')}
                checked={inlineMode}
                onCheckedChange={setInlineMode}
              />
            </div>

            <div className="h-4 w-px bg-border" aria-hidden />

            {/* 差异统计 */}
            <div className="flex items-baseline gap-3">
              <span className="text-body-sm font-semibold">
                {t('tools.text_compare.diff_stats')}
              </span>
              {hasDiff ? (
                <span className="text-xs text-muted-foreground">
                  <span className="text-success">+{stats.added}</span>
                  {'  '}
                  <span className="text-destructive">−{stats.removed}</span>
                  {'  '}
                  <span>~{stats.modified}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('tools.text_compare.diff_none')}
                </span>
              )}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              {renderActionGroup(t('tools.text_compare.side_original'), 'original')}
              {renderActionGroup(t('tools.text_compare.side_modified'), 'modified')}
              <div className="h-4 w-px bg-border" aria-hidden />
              <ToolbarButton
                label={t('tools.text_compare.fullscreen_aria')}
                testId="diff-fullscreen"
                onClick={openFullscreen}
              >
                <Maximize2 aria-hidden className="size-3.5" />
              </ToolbarButton>
            </div>
          </div>
        </div>
      </section>

      {/* DiffEditor 主区域 */}
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        data-search-anchor="text_compare:diff"
      >
        <DiffEditor
          language="plaintext"
          theme={themeName}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={diffOptions}
          className="h-full"
          loading={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t('tools.text_compare.loading_editor')}
            </div>
          }
        />
      </div>

      {/* 全屏差异弹窗(只读快照) */}
      <Dialog open={fullscreen} onOpenChange={closeFullscreen}>
        <DialogContent className="flex h-[85vh] max-w-[90vw] flex-col">
          <DialogTitle className="text-sm font-semibold">
            {t('tools.text_compare.dialog_diff_title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('tools.text_compare.dialog_diff_desc')}
          </DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <DiffEditor
              language="plaintext"
              theme={themeName}
              beforeMount={handleBeforeMount}
              original={fullscreenSnapshot?.original}
              modified={fullscreenSnapshot?.modified}
              options={{ ...diffOptions, readOnly: true, originalEditable: false }}
              className="h-full"
              loading={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t('tools.text_compare.loading_editor')}
                </div>
              }
            />
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        aria-hidden
        className="hidden"
        onChange={(e) => void handleFileChange(e.target.files)}
      />
    </div>
  );
}
