/**
 * 对比差异视图 —— 文本比较工具与文本编辑器「文件对比」共用的差异渲染组件
 *
 * 职责(自 TextCompare 主区域抽取,行为不变):
 * - 并排布局:双 CodeEditor + ResizablePanelGroup 可拖分隔条;
 * - 差异渲染四件套:行级红/绿背景、行内词级高亮、gutter 色条 + 行号加粗、
 *   右缘概览标尺刻度(差异计算见 ./diff-utils);
 * - 行对齐:短侧按行数差垫 view zone(斜线占位),等价行垂直同高(VSCode 式),
 *   只看差异开启时不对齐;
 * - 工具栏:差异统计徽标 / 相似度 / 降级提示 / 差异导航(上一处/下一处+
 *   位置计数,并排 F7/Shift+F7 快捷键)/ 行内开关 / 滚动同步开关,
 *   内联在「修改侧标题旁」(VSCode 风格);
 * - 行内模式:单体 DiffEditor(renderSideBySide: false,修改侧可编辑),
 *   可选折叠未变更区域(Monaco 原生 hideUnchangedRegions)。
 *
 * 边界:
 * - 内容受控于调用方(onOriginalChange / onModifiedChange),组件不持久化;
 * - 多 Tab 切换、文件级按钮(粘贴/打开/清除)经 chrome props 由调用方决定;
 * - i18n 暂沿用 tools.text_compare.* 键(两处消费文案一致,避免键迁移扰动)。
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  FoldVertical,
  Link2,
  Link2Off,
  Rows3,
  TriangleAlert,
} from 'lucide-react';
import {
  DiffEditor,
  type DiffBeforeMount,
  type DiffOnMount,
  type Monaco,
} from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import type { IRange } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CodeEditor, type EditorLanguage } from '@/components/ui/code-editor';
import { useMonacoTheme, defineThemeFor, getThemeName } from '@/components/ui/monaco-theme';
import type { MonacoEditor } from '@/components/ui/monaco-context-menu';
import { useEditorFontSize } from '@/hooks/useEditorFontSize';
import { useShortcut } from '@/hooks/useShortcut';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_SHORTCUTS } from '@/types/config';
import { cn } from '@/lib/utils';
import {
  buildDiffDecorations,
  computeAlignmentZones,
  computeHiddenRanges,
  createBlockLineMapper,
  WORD_DIFF_MAX_CHARS,
  type AlignZone,
  type DiffBlock,
  type DiffRulerColors,
  type DiffSnapshot,
  type HiddenLineRange,
  type LineDiffResult,
} from './diff-utils';
import { createDiffService, type DiffService } from './diff-service';

// Monaco loader 路径配置(import 即执行,保证任何编辑器挂载前就绪;详见模块内注释)
import '@/lib/monaco-loader-config';

/** 行对齐垫块上限(两侧 zone 总数):病态大文件上万块时跳过对齐,防抖动 */
const ALIGN_ZONES_MAX = 1000;

/** 空差异结果(初始态:双侧内容尚未计算) */
const EMPTY_DIFF_RESULT: LineDiffResult = {
  stats: { added: 0, removed: 0, modified: 0 },
  originalDecos: [],
  modifiedDecos: [],
  blocks: [],
  degraded: false,
  similarity: 1,
};

/** 单侧编辑器的文件级外观选项(粘贴/打开/清除按钮与占位文案) */
export interface TextDiffSideChrome {
  showPaste?: boolean;
  showOpenFile?: boolean;
  showClear?: boolean;
  placeholder?: string;
  /** 文件装入回调(打开/拖放文件统一入口,宿主记录文件名用),缺省直写 onChange */
  onFileLoad?: (text: string, fileName: string) => void;
  /** 是否接受拖放文件填充(缺省关闭) */
  acceptFileDrop?: boolean;
}

export interface TextDiffViewProps {
  /** 原始侧内容(受控) */
  original: string;
  /** 修改侧内容(受控) */
  modified: string;
  onOriginalChange: (value: string) => void;
  onModifiedChange: (value: string) => void;
  /** 两侧标题(显示在各自编辑器标题栏) */
  originalTitle: string;
  modifiedTitle: string;
  /** 两侧语言(按文件/文档分别传入,默认纯文本) */
  originalLanguage?: EditorLanguage;
  modifiedLanguage?: EditorLanguage;
  /** 是否启用代码折叠(文件对比场景开启),默认关闭 */
  folding?: boolean;
  /** 初始即使用行内模式,默认并排 */
  defaultInline?: boolean;
  /** 比较时忽略行尾空白差异(受控,由调用方保存状态) */
  ignoreWhitespace?: boolean;
  /** 比较时忽略大小写差异(受控,由调用方保存状态) */
  ignoreCase?: boolean;
  /** 比较时忽略换行符差异(CRLF/LF 归一,受控,由调用方保存状态) */
  ignoreEol?: boolean;
  /**
   * 「复制差异块到对侧」回调(WinMerge 式逐块拷贝)。提供时并排模式
   * 在差异块的 gutter 中点显示复制按钮;缺省(如文本编辑器文件对比)
   * 不显示。side 为动作发起侧,block 标识块的两侧行号区间。
   */
  onCopyBlock?: (side: 'original' | 'modified', block: DiffBlock) => void;
  /**
   * 差异快照回调(导出补丁用):每次差异结果就绪时上报本次计算的输入、
   * 选项与块(见 DiffSnapshot)。调用方存 ref,导出时比对新鲜度——新鲜
   * 即按显示块生成补丁,过期回退 jsdiff 独立计算。
   */
  onDiffSnapshot?: (snapshot: DiffSnapshot) => void;
  /** 左(原始)侧文件级外观 */
  leftChrome?: TextDiffSideChrome;
  /** 右(修改)侧文件级外观 */
  rightChrome?: TextDiffSideChrome;
  /**
   * 自定义工具栏动作区(渲染在修改侧标题旁的统计/导航区之后):
   * 编辑器「文件对比」等宿主注入「交换两侧 / 导出补丁」按钮;
   * 缺省不渲染。
   */
  toolbarActions?: React.ReactNode;
  /** 主区域搜索锚点(全局搜索定位用) */
  searchAnchor?: string;
  /** 左侧编辑器搜索锚点 */
  leftSearchAnchor?: string;
  /** 右侧编辑器搜索锚点 */
  rightSearchAnchor?: string;
  /** testid 前缀:生成 `{prefix}-stats` / `{prefix}-original` 等 */
  testIdPrefix?: string;
  className?: string;
}

/**
 * 单侧差异块的 gutter 复制按钮浮层(顶层组件,props 驱动;WinMerge 式):
 * - 悬停差异行(含行号槽)时,在该侧块的中点行 gutter 显示「→ 对侧」按钮;
 * - 纯增/纯删块:按钮只挂在「有差异行的一侧」(对侧无对应行,无按钮可挂);
 * - 垂直位置 = 编辑器 getTopForLineNumber(中点行) - 滚动偏移,gutter 左缘对齐;
 * - 点击后按钮消失(diff 重算),新块出现时自然重新定位。
 */
function GutterCopyOverlay({
  side,
  editorInstance,
  copyBlocks,
  onCopy,
  testIdPrefix,
  t,
}: {
  side: 'original' | 'modified';
  editorInstance: MonacoEditor | null;
  copyBlocks: readonly DiffBlock[];
  /** 点击复制回调(side + 块) */
  onCopy: (side: 'original' | 'modified', block: DiffBlock) => void;
  testIdPrefix: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): JSX.Element | null {
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  useEffect(() => {
    if (!editorInstance || copyBlocks.length === 0) return;
    const dom = editorInstance.getDomNode();
    if (!dom) return;

    /** 从鼠标事件解出 1-based 行号;命中不到行(gutter 外/视口外)返回 null */
    const lineFromEvent = (e: MouseEvent): number | null => {
      const target = editorInstance.getTargetAtClientPoint(e.clientX, e.clientY);
      if (!target || !target.position) return null;
      return target.position.lineNumber;
    };

    const onMouseMove = (e: MouseEvent) => {
      const line = lineFromEvent(e);
      setHoverLine((prev) => (prev === line ? prev : line));
    };
    const onMouseLeave = () => setHoverLine(null);
    dom.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('mouseleave', onMouseLeave);
    return () => {
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [editorInstance, copyBlocks]);

  // 悬停行不在任何块内 → 不显示
  const block = hoverLine !== null ? blockAtLine(copyBlocks, side, hoverLine) : null;
  if (!block || !editorInstance) return null;

  // 中点行:本侧区间为 null 时(对侧纯增/纯删)本侧本就不在块内,已排除
  const start = (side === 'original' ? block.origStart : block.modStart)!;
  const end = (side === 'original' ? block.origEnd : block.modEnd)!;
  const mid = Math.floor((start + end) / 2);
  const model = editorInstance.getModel();
  const dom = editorInstance.getDomNode();
  if (!model || !dom || mid < 1 || mid > model.getLineCount()) return null;

  const layout = editorInstance.getLayoutInfo();
  const top = editorInstance.getTopForLineNumber(mid) - editorInstance.getScrollTop();
  // 按钮挂 gutter 中缝:行号槽右侧、内容左缘(约行号区宽 + 4px)
  const left = layout.glyphMarginWidth + layout.lineNumbersWidth + 4;
  // 行高经相邻行 top 差推导(避免依赖 EditorOption enum 的导出差异)
  const lineHeight =
    editorInstance.getTopForLineNumber(Math.min(mid + 1, model.getLineCount() + 1)) -
    editorInstance.getTopForLineNumber(mid);
  const dirIcon = side === 'original' ? '→' : '←';

  return createPortal(
    <button
      type="button"
      data-testid={`${testIdPrefix}-copy-block-${side}`}
      title={t('tools.text_compare.copy_block_to_other', { side: dirIcon })}
      aria-label={t('tools.text_compare.copy_block_aria')}
      onClick={() => onCopy(side, block)}
      className="text-compare-copy-btn"
      style={{ position: 'absolute', top: top + Math.max(0, (lineHeight - 18) / 2), left }}
    >
      {dirIcon}
    </button>,
    dom,
  );
}

/**
 * 未变更隐藏的底层调用:monaco 0.56 公开类型未导出 setHiddenAreas,但实现
 * 常驻(codeEditorWidget.js:480,行内 DiffEditor 的 hideUnchangedRegions
 * 走同一入口),此处经结构化调用,不做 ESM 深路径 import(双实例禁区)。
 */
function setEditorHiddenAreas(
  ed: MonacoEditor,
  ranges: readonly {
    startLineNumber: number;
    endLineNumber: number;
    endColumn: number;
  }[],
): void {
  const withHidden = ed as MonacoEditor & {
    setHiddenAreas(ranges: IRange[]): void;
  };
  withHidden.setHiddenAreas(
    ranges.map((r) => ({
      startLineNumber: r.startLineNumber,
      startColumn: 1,
      endLineNumber: r.endLineNumber,
      endColumn: r.endColumn,
    })),
  );
}

/** 找行号所属的块(无则 null);块区间为本侧有差异行的连续段 */
function blockAtLine(
  blocks: readonly DiffBlock[],
  side: 'original' | 'modified',
  line: number,
): DiffBlock | null {
  for (const b of blocks) {
    const start = side === 'original' ? b.origStart : b.modStart;
    const end = side === 'original' ? b.origEnd : b.modEnd;
    if (start !== null && end !== null && line >= start && line <= end) return b;
  }
  return null;
}

export function TextDiffView({
  original,
  modified,
  onOriginalChange,
  onModifiedChange,
  originalTitle,
  modifiedTitle,
  originalLanguage = 'plaintext',
  modifiedLanguage = 'plaintext',
  folding = false,
  defaultInline = false,
  // 默认忽略空白差异(VSCode DiffEditor 默认 ignoreTrimWhitespace:true 同义;
  // 关掉开关即严格比对,缩进/行尾空格也会标红)
  ignoreWhitespace = true,
  ignoreCase = false,
  ignoreEol = false,
  onCopyBlock,
  onDiffSnapshot,
  leftChrome,
  rightChrome,
  toolbarActions,
  searchAnchor,
  leftSearchAnchor,
  rightSearchAnchor,
  testIdPrefix = 'text-diff',
  className,
}: TextDiffViewProps): JSX.Element {
  const { t } = useTranslation();

  // —— 差异计算(deferred 缓冲 + service 快慢路径 + 大输入 worker)——
  // service 挂载即创建、卸载时 dispose;worker 本身在首个大输入时才惰性创建,
  // 小文档(同步快路径)全程零 worker 开销
  const serviceRef = useRef<DiffService | null>(null);
  useEffect(() => {
    serviceRef.current = createDiffService();
    return () => {
      serviceRef.current?.dispose();
      serviceRef.current = null;
    };
  }, []);

  const deferredOriginal = useDeferredValue(original);
  const deferredModified = useDeferredValue(modified);
  const includeWordDiff =
    deferredOriginal.length <= WORD_DIFF_MAX_CHARS &&
    deferredModified.length <= WORD_DIFF_MAX_CHARS;

  // 差异结果异步到达:优先隐藏 DiffEditor 原生计算(与行内同源),不可用时
  // 回退 jsdiff(小输入同步微任务即达,大输入走 worker 不阻塞主线程);
  // 计算期间保留上一次结果,统计与高亮不清空
  const [diffResult, setDiffResult] = useState<LineDiffResult>(EMPTY_DIFF_RESULT);
  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    let cancelled = false;
    void service
      .compute(deferredOriginal, deferredModified, {
        includeWordDiff,
        ignoreWhitespace,
        ignoreCase,
        ignoreEol,
      })
      .then((result) => {
        // 只采纳最新一次请求:输入连续变化时,旧响应结果丢弃,防止乱序回写
        // 过期高亮(装饰构建处另有行号/列号夹取兜底)
        if (!cancelled) setDiffResult(result);
      });
    return () => {
      cancelled = true;
    };
  }, [
    deferredOriginal,
    deferredModified,
    includeWordDiff,
    ignoreWhitespace,
    ignoreCase,
    ignoreEol,
  ]);
  const stats = diffResult.stats;
  const hasDiff = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  // —— 编辑器实例与装饰注入 ——
  const [origEditor, setOrigEditor] = useState<MonacoEditor | null>(null);
  const [modEditor, setModEditor] = useState<MonacoEditor | null>(null);
  const origDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const modDecoRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // 装饰集合生命周期:随编辑器实例创建/销毁(实例复用于多次内容变化)
  useEffect(() => {
    if (!origEditor) return;
    origDecoRef.current?.clear();
    origDecoRef.current = origEditor.createDecorationsCollection([]);
    return () => {
      origDecoRef.current?.clear();
      origDecoRef.current = null;
    };
  }, [origEditor]);
  useEffect(() => {
    if (!modEditor) return;
    modDecoRef.current?.clear();
    modDecoRef.current = modEditor.createDecorationsCollection([]);
    return () => {
      modDecoRef.current?.clear();
      modDecoRef.current = null;
    };
  }, [modEditor]);

  const themeName = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);

  /**
   * VSCode 对齐:差异行在右缘概览标尺绘制红/绿刻度。Monaco 标尺经
   * canvas 绘制,不接受 CSS var(),须经 getComputedStyle 解析成具体
   * 色值;主题/调色板切换时随 themeName 重算,装饰 effect 依赖本值
   * 联动刷新。
   */
  const rulerColors = useMemo<DiffRulerColors>(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      added: style.getPropertyValue('--diff-add-emph').trim(),
      removed: style.getPropertyValue('--diff-remove-emph').trim(),
    };
    // themeName 不在闭包内:仅作为「主题/调色板已切换」的重算信号,
    // 使标尺刻度色随当前调色板的 --diff-*-emph 值刷新
    // eslint-disable-next-line react-x/exhaustive-deps, react-hooks/exhaustive-deps
  }, [themeName]);

  // 差异结果变化时刷新两侧装饰(deferred 值滞后时越界装饰在构建处跳过)
  useEffect(() => {
    if (origDecoRef.current && origEditor) {
      origDecoRef.current.set(
        buildDiffDecorations(origEditor, diffResult.originalDecos, 'original', rulerColors),
      );
    }
  }, [diffResult, origEditor, rulerColors]);
  useEffect(() => {
    if (modDecoRef.current && modEditor) {
      modDecoRef.current.set(
        buildDiffDecorations(modEditor, diffResult.modifiedDecos, 'modified', rulerColors),
      );
    }
  }, [diffResult, modEditor, rulerColors]);

  // —— 行内/并排布局开关(行内 = 单体 DiffEditor,修改侧可编辑)——
  const [inlineMode, setInlineMode] = useState(defaultInline);

  /**
   * 切换到行内时并排侧 CodeEditor 卸载,但 onMount 设置的实例 state 不会自动
   * 清空(CodeEditor 无 onUnmount 回调)—— 在切换事件里同步置 null(与
   * setInlineMode 同批更新),防止滚动同步监听挂在已销毁实例上;切回并排时
   * CodeEditor 重新挂载并经 onMount 回填实例
   */
  const handleToggleInline = useCallback(() => {
    const next = !inlineMode;
    setInlineMode(next);
    if (next) {
      setOrigEditor(null);
      setModEditor(null);
    }
  }, [inlineMode]);

  // —— 左右滚动按差异对齐同步(可开关;等值判断自收敛,防事件回环)——
  // 不再镜像 scrollTop:增删不等长时同 scrollTop 指向毫不相干的内容。
  // 以发起侧首个可见行经块映射落到对侧同义行,再补行内偏移;
  // getTopForLineNumber 归一了换行/折叠/隐藏行的高度差。
  const blockMapper = useMemo(() => createBlockLineMapper(diffResult.blocks), [diffResult]);
  const [syncScroll, setSyncScroll] = useState(true);
  const syncingRef = useRef(false);
  useEffect(() => {
    if (!origEditor || !modEditor) return;
    const syncFrom = (from: MonacoEditor, to: MonacoEditor, mapLine: (line: number) => number) => {
      if (!syncScroll || syncingRef.current) return;
      const toModel = to.getModel();
      if (!from.getModel() || !toModel) return;
      const top = from.getScrollTop();
      const visible = from.getVisibleRanges();
      const firstLine = visible[0]?.startLineNumber ?? 1;
      const mapped = Math.min(Math.max(1, mapLine(firstLine)), toModel.getLineCount());
      const target = to.getTopForLineNumber(mapped) + (top - from.getTopForLineNumber(firstLine));
      if (to.getScrollTop() !== target) {
        syncingRef.current = true;
        to.setScrollTop(target);
        syncingRef.current = false;
      }
    };
    const d1 = origEditor.onDidScrollChange(() =>
      syncFrom(origEditor, modEditor, (line) => blockMapper.origToMod(line)),
    );
    const d2 = modEditor.onDidScrollChange(() =>
      syncFrom(modEditor, origEditor, (line) => blockMapper.modToOrig(line)),
    );
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [origEditor, modEditor, syncScroll, blockMapper]);

  // —— 只看差异(可开关;仅并排模式)——
  // 等价行游程掐头去尾隐藏(上下文行保留),大文件少量差异一目了然;
  // 藏的是整模型行,不碰装饰与行号,差异行永不隐藏,导航/复制块/
  // 滚动映射照常工作(getTopForLineNumber 已归一高度)。
  const [hideUnchanged, setHideUnchanged] = useState(false);
  useEffect(() => {
    if (!origEditor || !modEditor || inlineMode) return;
    const applySide = (ed: MonacoEditor, ranges: readonly HiddenLineRange[]) => {
      const model = ed.getModel();
      if (!model) return;
      const lineCount = model.getLineCount();
      setEditorHiddenAreas(
        ed,
        ranges.flatMap((r) => {
          const start = Math.max(1, r.start);
          const end = Math.min(r.end, lineCount);
          return start <= end
            ? [
                {
                  startLineNumber: start,
                  endLineNumber: end,
                  endColumn: model.getLineMaxColumn(end),
                },
              ]
            : [];
        }),
      );
    };
    if (!hideUnchanged) {
      applySide(origEditor, []);
      applySide(modEditor, []);
      return;
    }
    const hidden = computeHiddenRanges(
      diffResult.blocks,
      origEditor.getModel()?.getLineCount() ?? 0,
      modEditor.getModel()?.getLineCount() ?? 0,
    );
    applySide(origEditor, hidden.original);
    applySide(modEditor, hidden.modified);
  }, [hideUnchanged, diffResult, origEditor, modEditor, inlineMode]);

  // —— 两侧行对齐(VSCode 式空白占位 + 斜线,仅并排全量模式)——
  // 短侧按行数差垫 view zone,使等价行垂直同高,不再靠滚动映射"追"对齐;
  // 只看差异(隐藏行)开启时高度语义变化,此时不对齐(折叠视图本就压缩);
  // 超长 zone 列表(病态大文件上万块)跳过对齐,回退无垫层旧观感,防抖动。
  // 注意:wordWrap 换行会让"行"高度不一,两侧换行位置不同时仍有像素级
  // 漂移(VSCode 同款局限),行号级对齐不受影响。
  useEffect(() => {
    if (!origEditor || !modEditor || inlineMode || hideUnchanged) return;
    const zones = computeAlignmentZones(diffResult.blocks);
    const total = zones.original.length + zones.modified.length;
    if (total === 0 || total > ALIGN_ZONES_MAX) return;
    const applySide = (ed: MonacoEditor, list: readonly AlignZone[]): string[] => {
      let ids: string[] = [];
      ed.changeViewZones((accessor) => {
        ids = list.map((z) => {
          const domNode = document.createElement('div');
          domNode.className = 'text-compare-align-zone';
          return accessor.addZone({
            afterLineNumber: z.afterLineNumber,
            heightInLines: z.heightInLines,
            domNode,
            // 占位区不抢光标:点击不移动光标
            suppressMouseDown: true,
          });
        });
      });
      return ids;
    };
    const origIds = applySide(origEditor, zones.original);
    const modIds = applySide(modEditor, zones.modified);
    return () => {
      try {
        origEditor.changeViewZones((accessor) => {
          for (const id of origIds) accessor.removeZone(id);
        });
        modEditor.changeViewZones((accessor) => {
          for (const id of modIds) accessor.removeZone(id);
        });
      } catch {
        // 卸载期编辑器已销毁,zone 随之释放,无需清理
      }
    };
  }, [diffResult, origEditor, modEditor, inlineMode, hideUnchanged]);

  // —— 差异导航(仅并排模式;行内 DiffEditor 无装饰行号,导航不可用)——
  // 按差异块跳转(VSCode 语义):50 行大块只占一站,不再逐行卡住;块内两侧
  // 起始行各自定位,纯增/纯删块的对侧落到对齐锚点(夹取到模型行数内)。
  const navBlocks = useMemo(() => (inlineMode ? [] : diffResult.blocks), [diffResult, inlineMode]);
  const diffCount = navBlocks.length;

  const [navIndexRaw, setNavIndexRaw] = useState(0);
  // 差异集变化(内容编辑/切换)时当前导航位置可能越界:渲染期直接夹取,
  // 不用 effect(setState-in-effect 会级联渲染),越界值也无需回写状态
  const navIndex = Math.min(navIndexRaw, Math.max(0, diffCount - 1));

  /** 目标行夹取到模型行数内(纯增删块的对侧锚点可能越界一行) */
  const revealClamped = useCallback(
    (ed: MonacoEditor | null, line: number | null, fallback: number | null) => {
      if (!ed) return;
      const count = Math.max(1, ed.getModel()?.getLineCount() ?? 1);
      ed.revealLineInCenter(Math.min(Math.max(1, line ?? fallback ?? 1), count));
    },
    [],
  );

  const revealDiffAt = useCallback(
    (index: number) => {
      if (navBlocks.length === 0) return;
      const clamped = ((index % navBlocks.length) + navBlocks.length) % navBlocks.length;
      setNavIndexRaw(clamped);
      const block = navBlocks[clamped];
      if (!block) return;
      revealClamped(origEditor, block.origStart, block.modStart);
      revealClamped(modEditor, block.modStart, block.origStart);
    },
    [navBlocks, origEditor, modEditor, revealClamped],
  );
  const goToPrevDiff = useCallback(() => revealDiffAt(navIndex - 1), [revealDiffAt, navIndex]);
  const goToNextDiff = useCallback(() => revealDiffAt(navIndex + 1), [revealDiffAt, navIndex]);

  // 导航按钮 tooltip 展示用户实际配置的快捷键组合(设置页同源)
  const navPrevLabel =
    useConfigStore((s) => s.config?.shortcuts.diff_prev_change) ??
    DEFAULT_SHORTCUTS.diff_prev_change;
  const navNextLabel =
    useConfigStore((s) => s.config?.shortcuts.diff_next_change) ??
    DEFAULT_SHORTCUTS.diff_next_change;

  // F7 / Shift+F7 导航快捷键(VSCode Diff Editor 同款语义;窗口捕获阶段
  // 监听,Monaco 聚焦时也生效);行内/无差异时放行不吞
  useShortcut(
    'diff_prev_change',
    (e) => {
      if (inlineMode || diffCount === 0) return false;
      goToPrevDiff();
      e.preventDefault();
      e.stopPropagation();
    },
    [inlineMode, diffCount, goToPrevDiff],
  );
  useShortcut(
    'diff_next_change',
    (e) => {
      if (inlineMode || diffCount === 0) return false;
      goToNextDiff();
      e.preventDefault();
      e.stopPropagation();
    },
    [inlineMode, diffCount, goToNextDiff],
  );

  // —— 复制差异块到对侧(WinMerge 式;仅并排模式 + 提供 onCopyBlock)——
  // 块列表由 computeLineDiff 的 chunk 循环直接产出(配对边界精确);
  // deferred 滞后时区间可能超模型行数,overlay 渲染处夹取
  const copyBlocks = useMemo(
    () => (onCopyBlock && !inlineMode ? diffResult.blocks : []),
    [onCopyBlock, inlineMode, diffResult],
  );

  // onCopyBlock 经 ref 取最新(与 onModifiedChangeRef 同模式),供 overlay 回调稳定引用
  const onCopyBlockRef = useRef(onCopyBlock);
  useEffect(() => {
    onCopyBlockRef.current = onCopyBlock;
  });

  /** overlay 点击 → 调用方回调(经 ref 取最新,回调 identity 不进 overlay props 破坏 hover state) */
  const handleCopyBlockClick = useCallback((side: 'original' | 'modified', block: DiffBlock) => {
    onCopyBlockRef.current?.(side, block);
  }, []);

  // 差异快照上报(导出补丁的新鲜度依据):与 onCopyBlockRef 同模式经 ref
  // 取最新回调;快照内容随每次计算结果更新,调用方只存 ref 不 setState
  const onDiffSnapshotRef = useRef(onDiffSnapshot);
  useEffect(() => {
    onDiffSnapshotRef.current = onDiffSnapshot;
  });
  useEffect(() => {
    onDiffSnapshotRef.current?.({
      original: deferredOriginal,
      modified: deferredModified,
      ignoreWhitespace,
      ignoreCase,
      ignoreEol,
      blocks: diffResult.blocks,
    });
  }, [deferredOriginal, deferredModified, diffResult, ignoreWhitespace, ignoreCase, ignoreEol]);
  // 行内模式写回经 ref 取最新回调:监听只在挂载时注册一次,直接闭包会
  // 滞留首次渲染的回调(多 Tab/多对比切换时写错目标);受控 prop 同步更新
  // 模型时监听同样触发,getValue 与受控值相等,写回为幂等 no-op,不会成环
  const onModifiedChangeRef = useRef(onModifiedChange);
  useEffect(() => {
    onModifiedChangeRef.current = onModifiedChange;
  });

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    defineThemeFor(monaco, getThemeName());
  }, []);

  const handleInlineMount: DiffOnMount = useCallback((instance) => {
    const mod = instance.getModifiedEditor();
    mod.onDidChangeModelContent(() => {
      onModifiedChangeRef.current(mod.getValue());
    });
  }, []);

  // 主题名变化时,重新定义并切换 Monaco 主题(无需重挂载编辑器)
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineThemeFor(monaco, themeName);
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  /** 与 CodeEditor 展示优化对齐的 DiffEditor 公共选项(字号随设置档位缩放) */
  const editorFontSize = useEditorFontSize();
  const baseDiffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
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
      folding,
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
      // VSCode 对齐:行内 DiffEditor 由原生逻辑绘制右缘差异刻度
      overviewRulerLanes: 3,
      scrollBeyondLastColumn: 0,
      contextmenu: true,
      fixedOverflowWidgets: true,
      // 不折叠未变更区域,保持"全量并排"观感
      hideUnchangedRegions: { enabled: false },
    }),
    [editorFontSize, folding],
  );

  /** 行内模式:修改侧可编辑(onChange 写回),原始侧只读 */
  const [inlineFold, setInlineFold] = useState(false);
  const inlineOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      ...baseDiffOptions,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: false,
      // 行内模式直接用 Monaco 原生空白忽略;大小写忽略无原生选项,经输入预处理
      ignoreTrimWhitespace: ignoreWhitespace,
      // 折叠未变更区域(仅行内 DiffEditor 原生支持;并排装饰方案无法成对协调):
      // 大文档只有少量差异时,折叠能让差异一目了然;折叠区点击可展开
      hideUnchangedRegions: { enabled: inlineFold, minimumLineCount: 3, contextLineCount: 3 },
    }),
    [baseDiffOptions, ignoreWhitespace, inlineFold],
  );

  // 行内模式大小写忽略:Monaco 无原生选项,对 original 做小写化比较
  // (modified 保持原样可编辑,写回不受影响)
  const inlineOriginal = useMemo(
    () => (ignoreCase ? original.toLowerCase() : original),
    [original, ignoreCase],
  );

  // —— 工具栏公共小件:统计徽标 / 相似度 / 降级提示 / 导航 / 行内开关 ——
  const statsBadge = (
    <span
      className="flex items-center gap-1 whitespace-nowrap tabular-nums text-xs text-muted-foreground"
      data-testid={`${testIdPrefix}-stats`}
    >
      {hasDiff ? (
        <>
          <span className="text-success">+{stats.added}</span>
          <span className="text-destructive">−{stats.removed}</span>
          <span>~{stats.modified}</span>
          <span title={t('tools.text_compare.similarity_title')}>
            {t('tools.text_compare.similarity_value', {
              percent: Math.round(diffResult.similarity * 100),
            })}
          </span>
        </>
      ) : (
        t('tools.text_compare.diff_none')
      )}
    </span>
  );

  /** 降级提示:行级 diff 超限,当前按整体替换展示,统计非真实粒度 */
  const degradedBadge = diffResult.degraded ? (
    <span
      className="flex items-center gap-1 whitespace-nowrap text-xs text-warning"
      data-testid={`${testIdPrefix}-degraded`}
      title={t('tools.text_compare.degraded_title')}
    >
      <TriangleAlert aria-hidden className="size-3.5" />
      {t('tools.text_compare.degraded_badge')}
    </span>
  ) : null;

  /** 差异导航(并排专属):上一处/下一处 + 当前位置计数;无差异时禁用 */
  const diffNav =
    !inlineMode && diffCount > 0 ? (
      <span
        className="flex items-center gap-0.5 whitespace-nowrap tabular-nums text-xs text-muted-foreground"
        data-testid={`${testIdPrefix}-nav`}
      >
        <button
          type="button"
          data-testid={`${testIdPrefix}-nav-prev`}
          title={t('tools.text_compare.nav_prev_title', { combo: navPrevLabel })}
          aria-label={t('tools.text_compare.nav_prev_title', { combo: navPrevLabel })}
          onClick={goToPrevDiff}
          className="flex items-center rounded px-1 py-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronUp aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-nav-next`}
          title={t('tools.text_compare.nav_next_title', { combo: navNextLabel })}
          aria-label={t('tools.text_compare.nav_next_title', { combo: navNextLabel })}
          onClick={goToNextDiff}
          className="flex items-center rounded px-1 py-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </button>
        <span data-testid={`${testIdPrefix}-nav-count`}>
          {diffCount === 0 ? '' : `${navIndex + 1}/${diffCount}`}
        </span>
      </span>
    ) : null;

  const inlineToggle = (
    <button
      type="button"
      data-testid={`${testIdPrefix}-inline-toggle`}
      aria-pressed={inlineMode}
      title={t('tools.text_compare.inline_mode')}
      aria-label={t('tools.text_compare.inline_mode')}
      onClick={handleToggleInline}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inlineMode ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Rows3 aria-hidden className="size-3.5" />
    </button>
  );

  /** 行内模式的未变更区折叠开关(Monaco 原生 hideUnchangedRegions) */
  const inlineFoldToggle = inlineMode ? (
    <button
      type="button"
      data-testid={`${testIdPrefix}-inline-fold`}
      aria-pressed={inlineFold}
      title={t('tools.text_compare.inline_fold')}
      aria-label={t('tools.text_compare.inline_fold')}
      onClick={() => setInlineFold((v) => !v)}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inlineFold ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <FoldVertical aria-hidden className="size-3.5" />
    </button>
  ) : null;

  const syncScrollButton = (
    <button
      type="button"
      data-testid={`${testIdPrefix}-sync-scroll`}
      aria-pressed={syncScroll}
      title={
        syncScroll
          ? t('tools.text_compare.sync_scroll_on')
          : t('tools.text_compare.sync_scroll_off')
      }
      aria-label={t('tools.text_compare.sync_scroll_aria')}
      onClick={() => setSyncScroll((v) => !v)}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        syncScroll ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {syncScroll ? (
        <Link2 aria-hidden className="size-3.5" />
      ) : (
        <Link2Off aria-hidden className="size-3.5" />
      )}
    </button>
  );

  /** 只看差异开关(并排专属;行内由原生折叠开关覆盖,此处不渲染) */
  const hideUnchangedButton = !inlineMode ? (
    <button
      type="button"
      data-testid={`${testIdPrefix}-hide-unchanged`}
      aria-pressed={hideUnchanged}
      title={
        hideUnchanged
          ? t('tools.text_compare.hide_unchanged_off')
          : t('tools.text_compare.hide_unchanged_on')
      }
      aria-label={t('tools.text_compare.hide_unchanged_aria')}
      onClick={() => setHideUnchanged((v) => !v)}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        hideUnchanged ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <EyeOff aria-hidden className="size-3.5" />
    </button>
  ) : null;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {inlineMode ? (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-search-anchor={searchAnchor}
          data-testid={`${testIdPrefix}-inline`}
        >
          {/* 工具栏:与 CodeEditor 标题栏同款样式(行内模式无同步滚动/导航);
           * 统计/开关紧跟标题(VSCode 风格),不贴工具栏右缘 */}
          <div className="flex min-w-0 shrink-0 items-center border-b border-input px-2 py-0.5">
            <span className="flex min-w-0 items-center gap-2 pl-1 text-xs font-medium text-foreground">
              <span className="truncate">{t('tools.text_compare.inline_diff_title')}</span>
              {statsBadge}
              {degradedBadge}
              {inlineToggle}
              {inlineFoldToggle}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              language={modifiedLanguage}
              theme={themeName}
              beforeMount={handleBeforeMount}
              original={inlineOriginal}
              modified={modified}
              // 行内模式修改侧可编辑:onMount 挂载内容监听写回(经 ref 取最新回调)
              onMount={handleInlineMount}
              options={inlineOptions}
              className="h-full"
              loading={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t('tools.text_compare.loading_editor')}
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          data-search-anchor={searchAnchor}
        >
          <ResizablePanel defaultSize="50" minSize="20" className="relative min-h-0 min-w-0">
            <CodeEditor
              title={originalTitle}
              language={originalLanguage}
              value={original}
              onChange={onOriginalChange}
              placeholder={leftChrome?.placeholder}
              onFileLoad={leftChrome?.onFileLoad}
              acceptFileDrop={leftChrome?.acceptFileDrop}
              // 只保留右侧边框(朝向中间分隔缝),去掉外三边:外层容器已提供
              // 框体,避免双线/双圆角叠加
              className="h-full rounded-none border-0 border-r"
              data-testid={`${testIdPrefix}-original`}
              searchAnchor={leftSearchAnchor}
              folding={folding}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste={leftChrome?.showPaste}
              showOpenFile={leftChrome?.showOpenFile}
              showClear={leftChrome?.showClear}
              onMount={(instance) => setOrigEditor(instance)}
            />
            {onCopyBlock && (
              <GutterCopyOverlay
                side="original"
                editorInstance={origEditor}
                copyBlocks={copyBlocks}
                onCopy={handleCopyBlockClick}
                testIdPrefix={testIdPrefix}
                t={t}
              />
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="50" minSize="20" className="relative min-h-0 min-w-0">
            <CodeEditor
              title={modifiedTitle}
              language={modifiedLanguage}
              // VSCode 风格:差异统计与布局操作紧跟标题展示,而非贴工具栏
              // 最右缘(header 复用 CodeEditor 的自定义标题区插槽);
              // 文件级按钮(粘贴/打开/清除)仍由 CodeEditor 常规放在右侧
              header={
                <span
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`${testIdPrefix}-modified-header`}
                >
                  <span className="truncate">{modifiedTitle}</span>
                  {statsBadge}
                  {degradedBadge}
                  {diffNav}
                  {inlineToggle}
                  {syncScrollButton}
                  {hideUnchangedButton}
                  {toolbarActions}
                </span>
              }
              value={modified}
              onChange={onModifiedChange}
              placeholder={rightChrome?.placeholder}
              onFileLoad={rightChrome?.onFileLoad}
              acceptFileDrop={rightChrome?.acceptFileDrop}
              // 对称:只保留左侧边框(朝向中间分隔缝),理由同原始侧
              className="h-full rounded-none border-0 border-l"
              data-testid={`${testIdPrefix}-modified`}
              searchAnchor={rightSearchAnchor}
              folding={folding}
              // VSCode 对齐:右缘概览标尺显示红/绿差异刻度
              overviewRulerLanes={3}
              showPaste={rightChrome?.showPaste}
              showOpenFile={rightChrome?.showOpenFile}
              showClear={rightChrome?.showClear}
              onMount={(instance) => setModEditor(instance)}
            />
            {onCopyBlock && (
              <GutterCopyOverlay
                side="modified"
                editorInstance={modEditor}
                copyBlocks={copyBlocks}
                onCopy={handleCopyBlockClick}
                testIdPrefix={testIdPrefix}
                t={t}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
