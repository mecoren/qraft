/**
 * 文件夹/文件分析器(只读)。
 * scan:目录统计;search:内容搜索;file:单文件解析。
 */
import { useCallback, useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ToolProps } from './registry';
import { ScanResultsPanel } from './folder-analyzer/ScanResultsPanel';
import { SearchResultsPanel } from './folder-analyzer/SearchResultsPanel';
import { FileInspectPanel } from './folder-analyzer/FileInspectPanel';
import { pickFolder, pickFilePath, routeDropped } from './folder-analyzer/analyzerApi';
import { useAnalyzerTask } from './folder-analyzer/useAnalyzerTask';
import type {
  AnalyzerMode,
  FileInspectReport,
  ScanReport,
  SearchReport,
} from './folder-analyzer/types';

export function FolderAnalyzer(_props: ToolProps) {
  const [mode, setMode] = useState<AnalyzerMode>('scan');
  // 已完成结果所属的模式:切换 Tab 时旧结果不渲染(三种报告结构互不兼容,强转会崩溃)
  const [resultMode, setResultMode] = useState<AnalyzerMode | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [pattern, setPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const { state, run, cancel } = useAnalyzerTask();

  /** 记录本次运行的模式;面板仅在该模式下渲染 */
  const runWithMode = useCallback(
    (args: Parameters<typeof run>[0]) => {
      setResultMode(args.mode);
      return run(args);
    },
    [run],
  );

  // Tauri 拦截了 HTML5 drop,必须用 webview 级拖放事件拿真实路径
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let alive = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
          void routeDropped(event.payload.paths).then((entry) => {
            if (!alive || !entry) return;
            setTarget(entry.path);
            if (entry.kind === 'dir') {
              setMode('scan');
              void runWithMode({
                filePath: entry.path,
                mode: 'scan',
                options: { include_hidden: includeHidden },
              });
            } else {
              setMode('file');
              void runWithMode({ filePath: entry.path, mode: 'file' });
            }
          });
        }
      })
      .then((unlisten) => {
        if (alive) dispose = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-x/exhaustive-deps -- 仅初始化订阅
  }, []);

  const handlePickFolder = useCallback(async () => {
    const p = await pickFolder();
    if (!p) return;
    setTarget(p);
    if (mode === 'file') {
      setMode('scan');
      return;
    }
    // 选中即分析(与 file 模式选中即解析一致);后续可调选项后再点"开始分析"
    if (mode === 'search') {
      await runWithMode({
        filePath: p,
        mode: 'search',
        options: {
          pattern,
          is_regex: isRegex,
          case_insensitive: caseInsensitive,
          include_hidden: includeHidden,
        },
      });
    } else {
      await runWithMode({ filePath: p, mode: 'scan', options: { include_hidden: includeHidden } });
    }
  }, [mode, pattern, isRegex, caseInsensitive, includeHidden, runWithMode]);

  const handleRun = useCallback(async () => {
    if (!target) return;
    if (mode === 'search') {
      await runWithMode({
        filePath: target,
        mode: 'search',
        options: {
          pattern,
          is_regex: isRegex,
          case_insensitive: caseInsensitive,
          include_hidden: includeHidden,
        },
      });
    } else if (mode === 'scan') {
      await runWithMode({ filePath: target, mode: 'scan', options: { include_hidden: includeHidden } });
    }
    // file 模式在选中文件后立即运行,无需 Run 按钮
  }, [target, mode, pattern, isRegex, caseInsensitive, includeHidden, runWithMode]);

  const handlePickFile = useCallback(async () => {
    const p = await pickFilePath();
    if (!p) return;
    setTarget(p);
    setMode('file');
    await runWithMode({ filePath: p, mode: 'file' });
  }, [runWithMode]);

  const canRun =
    !!target && state.status !== 'running' && (mode !== 'search' || pattern.trim().length > 0);

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="folder-analyzer">
      <Tabs value={mode} onValueChange={(v) => setMode(v as AnalyzerMode)}>
        <TabsList>
          <TabsTrigger value="scan" data-testid="analyzer-mode-scan">
            文件夹统计
          </TabsTrigger>
          <TabsTrigger value="search" data-testid="analyzer-mode-search">
            内容搜索
          </TabsTrigger>
          <TabsTrigger value="file" data-testid="analyzer-mode-file">
            单文件解析
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-4" data-search-anchor="folder_analyzer:config">
        {(mode === 'scan' || mode === 'search') && (
          <div className="flex flex-col gap-1">
            <Button variant="outline" onClick={handlePickFolder} data-testid="analyzer-pick-folder">
              选择文件夹…
            </Button>
          </div>
        )}
        {mode === 'file' && (
          <Button variant="outline" onClick={handlePickFile} data-testid="analyzer-pick-file">
            选择文件…(或直接拖入)
          </Button>
        )}
        {mode === 'search' && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="analyzer-pattern-input" className="text-xs">
              搜索内容
            </Label>
            <Input
              id="analyzer-pattern-input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="普通文本或正则表达式"
              className="w-64"
              data-testid="analyzer-pattern"
            />
          </div>
        )}
        <div className="flex items-center gap-2 pb-1">
          <Switch id="hidden-switch" checked={includeHidden} onCheckedChange={setIncludeHidden} />
          <Label htmlFor="hidden-switch" className="text-xs">
            包含隐藏文件
          </Label>
        </div>
        {mode === 'search' && (
          <>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="regex-switch" checked={isRegex} onCheckedChange={setIsRegex} />
              <Label htmlFor="regex-switch" className="text-xs">
                正则
              </Label>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                id="case-switch"
                checked={caseInsensitive}
                onCheckedChange={setCaseInsensitive}
              />
              <Label htmlFor="case-switch" className="text-xs">
                忽略大小写
              </Label>
            </div>
          </>
        )}
        {mode !== 'file' && (
          <Button onClick={() => void handleRun()} disabled={!canRun} data-testid="analyzer-run">
            {state.status === 'running' ? '分析中…' : '开始分析'}
          </Button>
        )}
        <span className="text-xs text-muted-foreground truncate max-w-[40ch]" title={target ?? ''}>
          {target ? `目标:${target}` : '尚未选择目标'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">只读分析:不会写入或修改任何文件。</p>

      {state.status === 'running' && (
        <div className="flex items-center gap-3">
          <Progress value={undefined} className="flex-1" aria-label="分析进行中" />
          <span className="text-xs text-muted-foreground" data-testid="analyzer-progress-message">
            {state.message}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void cancel()}
            data-testid="analyzer-cancel"
          >
            取消
          </Button>
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      {/* 结果面板仅在「结果所属模式」下渲染:报告结构互不兼容,切换 Tab 后不显示旧结果。
          min-h-0 flex-1 给 Monaco 等内容提供有界高度,内部自行滚动 */}
      {state.status === 'done' && resultMode === 'scan' && mode === 'scan' && (
        <div className="min-h-0 flex-1">
          <ScanResultsPanel report={state.result as ScanReport} />
        </div>
      )}
      {state.status === 'done' && resultMode === 'search' && mode === 'search' && (
        <div className="min-h-0 flex-1">
          <SearchResultsPanel report={state.result as SearchReport} />
        </div>
      )}
      {state.status === 'done' && resultMode === 'file' && mode === 'file' && (
        <div className="min-h-0 flex-1">
          <FileInspectPanel report={state.result as FileInspectReport} />
        </div>
      )}
    </div>
  );
}
