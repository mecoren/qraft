/**
 * Monaco 折叠区域摘要 —— JSON 对象/数组折叠后显示字段/元素数量
 *
 * 背景(重要,Monaco 0.56.0 实测):
 * - 0.56.0 对行内装饰做了重构:`InjectedTextOptions.after: { content }`
 *   (即 createDecorationsCollection 装饰 options 里的 `after`/`before` 字段)
 *   在源码中并未被读取 —— `common/viewModel/inlineDecorations.js` 只处理
 *   `inlineClassName` / `beforeContentClassName` / `afterContentClassName`
 *   三个纯 CSS 类字段,`after: { content }` 会被静默丢弃(见该文件 50-78 行)。
 * - 因此本模块改用 **afterContentClassName + 动态 CSS `::after`** 方案:
 *   折叠装饰本身也是 `afterContentClassName: 'inline-folded'` + folding.css 的
 *   `.inline-folded:after { content: "\22EF" }` 画出的 "⋯"(`folding.css:33`)。
 * - 折叠动作只隐藏区域 2..end 行,锚点行(第一行)不隐藏(`hiddenRangeModel.js`),
 *   所以锚点行行尾的装饰照常渲染。
 *
 * 实现:
 * - 每个折叠区域按 (count, kind) 生成唯一 class(如 `monaco-fold-summary-obj-3`),
 *   首次遇到时向 document <style> 动态写入 `::after { content: " 3 字段" }`
 *   CSS 规则,同一 count 复用已生成的规则,避免无限增长。
 * - 用 afterContentClassName 把该 class 挂到折叠锚点行行尾,与 Monaco 的
 *   "⋯"(inline-folded)并排渲染,视觉 `> { 3 字段 ⋮`。
 *
 * 计数算法(computeFoldSummary):
 * - 仅识别以 '{' 开头、'}' 收尾的折叠区(object),或 '[' / ']' 配对(array)
 * - 计数范围:[startLine+1, endLine-1] 内 depth=0 的逗号数 + 1
 * - 跟踪字符串字面量状态,避免 "a,b,c" 内的逗号被误判为字段分隔
 *
 * 折叠状态订阅:
 * - Monaco 没有公开 API 查询折叠状态,只能通过
 *   `editor.getContribution('editor.contrib.folding')` 拿到私有 FoldingController
 *   再访问 foldingModel / hiddenRangeModel。hiddenRangeModel.onDidChange 在
 *   每次折叠/展开后必然触发(FoldingController.onHiddenRangesChanges 链路)。
 * - hiddenRangeModel 在 onModelChanged 时才创建、切 model 会重建,因此每次
 *   refresh 动态对比实例并重新订阅。
 */
import type { editor } from 'monaco-editor';

interface FoldSummaryInfo {
  count: number;
  kind: 'object' | 'array';
}

/**
 * count 安全上限:超出后不再显示具体数字,退化为通用摘要。
 * 目的不是"限制字段数"(JSON 顶层节点可以很大),而是防止 count 无限增长
 * 导致 CSS 规则/class 失控——10000+ 项的数组在样式表里生成等量规则
 * 显然不经济。用「具体数字 → N+」的渐进策略,视觉上仍保留信息。
 */
const MAX_EXACT_COUNT = 9999;

/** 通用折叠摘要 class(不分 count,基础样式见 globals.css) */
const BASE_CLASS = 'monaco-fold-summary';

/** CSS 规则注册表:class 名 → 已注入的规则;防止同一 count 重复写 <style> */
const injectedRules = new Set<string>();

/** 全局 <style> 节点(懒创建),承载所有折叠摘要的 ::after 规则 */
let styleSheet: HTMLStyleElement | null = null;

/** 取 (count, kind) 对应的 class 名;count 超上限时退化为通用 N+ 摘要 */
function summaryClassName(
  count: number,
  kind: 'object' | 'array',
): { cls: string; label: string } | null {
  if (count < 1) return null;
  const prefix = kind === 'object' ? 'monaco-fold-summary-obj' : 'monaco-fold-summary-arr';
  if (count > MAX_EXACT_COUNT) {
    // 超上限:只用「通用 class + 静态规则」,不再按 count 生成规则
    const plus = `${BASE_CLASS}-plus-${kind}`;
    ensureStaticPlusRule(plus, kind);
    return { cls: plus, label: '' };
  }
  return { cls: `${prefix}-${count}`, label: kind === 'object' ? `${count} 字段` : `${count} 项` };
}

/** 确保「N+」通用规则已注入(仅一次,count 超上限时使用) */
function ensureStaticPlusRule(cls: string, kind: 'object' | 'array'): void {
  if (injectedRules.has(cls)) return;
  const label = kind === 'object' ? `${MAX_EXACT_COUNT}+ 字段` : `${MAX_EXACT_COUNT}+ 项`;
  const rule = `.monaco-editor .${cls}:after { content: " ${label}"; }`;
  insertRule(rule, cls);
}

/** 确保某 (count, kind) 对应的 ::after 规则已注入样式表 */
function ensureSummaryRule(count: number, kind: 'object' | 'array'): void {
  const resolved = summaryClassName(count, kind);
  if (!resolved) return;
  // N+ 通用规则的注入已由 summaryClassName 内部完成,这里只需精确 count 规则
  if (count > MAX_EXACT_COUNT) return;
  const cls = resolved.cls;
  if (injectedRules.has(cls)) return;

  const label = kind === 'object' ? `${count} 字段` : `${count} 项`;
  // ::after content 的引号需转义;这里 label 全是数字 + 中文,安全
  const rule = `.monaco-editor .${cls}:after { content: " ${label}"; }`;
  insertRule(rule, cls);
}

/** 向全局样式表注入单条规则(按 cls 去重) */
function insertRule(rule: string, cls: string): void {
  if (!styleSheet) {
    styleSheet = document.createElement('style');
    styleSheet.setAttribute('data-monaco-fold-summary', '1');
    document.head.appendChild(styleSheet);
  }
  // sheet 在 append 到 DOM 后同步可用;若仍为 null(极端时序)则不标记已注入,
  // 让后续 refresh 重试,避免 class 永久缺失 ::after 规则
  if (styleSheet.sheet) {
    styleSheet.sheet.insertRule(rule, styleSheet.sheet.cssRules.length);
    injectedRules.add(cls);
  }
}

/**
 * 解析折叠范围内的 JSON 节点,返回顶层字段/元素数量与节点种类。
 *
 * 关键前提(Monaco 0.56 JSON folding provider 实测):
 * - 折叠 region 的 endLine 是**最后一个内容行**,而不是 `}` / `]` 所在行!
 *   例如:
 *     {                      ← startLine(anchor, 保留)
 *       "a": 1,              ← 内容
 *       "b": 2               ← endLine(最后一个内容行)
 *     }                      ← 不在 region 内,折叠后仍可见
 *   因此**绝不能**用 "末行是否含 `}`" 来判定 object/array。
 *
 * 算法:
 * - 扫描整个 region(start..end 全部行),跟踪字符串字面量状态
 * - 遇到的第一个结构括号决定种类(object `{` / array `[`)
 * - 统计「根深度(rootDepth === 1)」的逗号数 → 顶层项数 = commas + 1
 * - region 全空(无任何内容)时返回 null,不显示 count
 */
function computeFoldSummary(
  model: editor.ITextModel,
  startLine: number,
  endLine: number,
): FoldSummaryInfo | null {
  // 单行闭合(region 至少跨 2 行才可折叠)
  if (endLine <= startLine) return null;

  let depth = 0;
  let commas = 0;
  let nonWhitespace = 0;
  let inString = false;
  let escaped = false;
  let kind: 'object' | 'array' | null = null;

  for (let line = startLine; line <= endLine; line += 1) {
    const content = model.getLineContent(line);
    for (let i = 0; i < content.length; i += 1) {
      const ch = content[i];
      if (ch !== ' ' && ch !== '\t') nonWhitespace += 1;

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        if (kind === null) kind = ch === '{' ? 'object' : 'array';
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        depth -= 1;
      } else if (ch === ',' && depth === 1 && kind !== null) {
        commas += 1;
      }
    }
  }

  // 没有结构括号(region 内不是对象/数组) → 不显示
  if (kind === null) return null;
  // 判空:开括号本身已占 1 个非空白字符,region 内除括号外还有内容才非空
  // ({ \n (空白) \n } 这种空对象不显示 count,避免误导)
  if (nonWhitespace <= 1) return null;
  // 根深度(depth=1)逗号数 + 1 = 顶层项数;即使无逗号({ "only": 1 })也至少有 1 项
  return { count: commas + 1, kind };
}

/** Monaco 私有 folding 贡献的接口形态(0.56 实测) */
interface FoldingContribution {
  foldingModel?: {
    regions: {
      length: number;
      toRegion(i: number): {
        startLineNumber: number;
        endLineNumber: number;
        isCollapsed: boolean;
      };
    };
  } | null;
  /**
   * 内部 hidden range 变化事件(折叠/展开后触发)。
   *
   * Monaco 没有公开"折叠状态变化"的事件——fold 动作只修改 FoldingController
   * 内部的 FoldingModel / HiddenRangeModel,不会触发 onDidChangeCursorPosition
   * 或 onDidChangeModelContent。因此必须订阅 HiddenRangeModel.onDidChange:
   * 点击折叠箭头 / Ctrl+Shift+[ 等动作都会经 onHiddenRangesChanges fire
   * 该事件(见 monaco-editor .../folding/browser/hiddenRangeModel.js)。
   */
  hiddenRangeModel?: {
    onDidChange(listener: () => void): { dispose(): void };
  } | null;
}

/** 通过编辑器私有 contribution API 获取 folding 贡献;Monaco 没有公开 API */
function getFoldingContribution(
  editor: editor.IStandaloneCodeEditor,
): FoldingContribution | null {
  return (
    editor as unknown as {
      getContribution(id: string): FoldingContribution | null;
    }
  ).getContribution('editor.contrib.folding');
}

export interface FoldSummaryHandle {
  /** 释放装饰与事件订阅 */
  dispose: () => void;
}

/**
 * 为编辑器的折叠区域添加 JSON 节点摘要。
 *
 * 仅适用于 JSON 语言(其他语言的对象/数组/函数体语法边界不可靠,
 * 误标摘要会形成误导);调用方按语言启用。
 */
export function attachFoldSummary(
  editor: editor.IStandaloneCodeEditor,
): FoldSummaryHandle {
  const collection = editor.createDecorationsCollection();

  // 折叠状态变化的防抖触发:多个来源事件(onDidChangeModelContent /
  // onDidChangeCursorPosition / hiddenRangeModel.onDidChange / onMouseUp)
  // 可在同一事件循环内合并,避免频繁重建装饰;50ms 后实际执行刷新
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = (): void => {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 50);
  };

  const refresh = (): void => {
    // 确保订阅到当前 hiddenRangeModel(FoldingController 在 onModelChanged 时
    // 才创建/重建它;只有订阅了它,点击折叠箭头才能触发 count 刷新)
    ensureHiddenRangeSubscription();
    const model = editor.getModel();
    const contribution = getFoldingContribution(editor);
    const fm = contribution?.foldingModel ?? null;
    if (!model || !fm) {
      collection.set([]);
      return;
    }

    const regions = fm.regions;
    const decorations: editor.IModelDeltaDecoration[] = [];

    for (let i = 0; i < regions.length; i += 1) {
      const region = regions.toRegion(i);
      if (!region.isCollapsed) continue;

      const summary = computeFoldSummary(model, region.startLineNumber, region.endLineNumber);
      if (!summary) continue;

      const resolved = summaryClassName(summary.count, summary.kind);
      if (!resolved) continue;
      ensureSummaryRule(summary.count, summary.kind);
      const cls = resolved.cls;

      const startLine = region.startLineNumber;
      const lineContent = model.getLineContent(startLine);
      // afterContentClassName 渲染在 range 的 endColumn 之后(见
      // inlineDecorations.js:70-78 After 型装饰)。这里放在 line 末尾的
      // 虚拟 column(lineLength + 1),紧贴行内容,视觉上夹在 line 内容和
      // Monaco 的 "⋯"(inline-folded,同样 After 型)之间:
      //   `> { 3 字段 ⋮`
      const endCol = lineContent.length + 1;

      decorations.push({
        range: {
          startLineNumber: startLine,
          startColumn: endCol,
          endLineNumber: startLine,
          endColumn: endCol,
        },
        options: {
          // 0.56.0 不支持 after: { content },必须用 afterContentClassName +
          // 动态 CSS ::after(folding 自身的 "⋯" 也是这么画的)
          afterContentClassName: cls,
          // 关键:粘贴/复制时 count 不进入模型内容
          stickiness: 1 /* TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges */,
        },
      });
    }

    collection.set(decorations);
  };

  // hiddenRangeModel 订阅(FoldingController 在 onModelChanged 时才创建,
  // 且切换 model 时会重建实例):每次 refresh 时对比实例,变化则重新订阅。
  // 旧实例被 Monaco dispose 后其 onDidChange 订阅自动失效,这里只需
  // dispose 我们持有的引用即可(Monaco 的 IDisposable.dispose 幂等)。
  let hiddenRangeSub: { dispose(): void } | null = null;
  let lastHiddenRange: unknown = null;
  const ensureHiddenRangeSubscription = (): void => {
    const contribution = getFoldingContribution(editor);
    const hrm = contribution?.hiddenRangeModel ?? null;
    if (hrm && hrm !== lastHiddenRange) {
      hiddenRangeSub?.dispose();
      hiddenRangeSub = hrm.onDidChange(scheduleRefresh);
      lastHiddenRange = hrm;
    }
  };

  // 核心订阅:
  // 1. 内容 / 光标 / 鼠标变化(含折叠点击移动光标、展开等)
  // 2. model 切换时 hiddenRangeModel 会重建,必须触发 refresh 重订阅
  const disposers: Array<{ dispose(): void }> = [
    editor.onDidChangeModelContent(scheduleRefresh),
    editor.onDidChangeCursorPosition(scheduleRefresh),
    editor.onDidChangeModel(scheduleRefresh),
    // 兜底:某些折叠触发路径(如鼠标点击 gutter)不会改变光标位置,
    // 但必然会触发 mouseup;防抖合并后成本可忽略
    editor.onMouseUp(scheduleRefresh),
  ];

  // 初次应用:Monaco 内部 folding 计算是 debounce 200ms,
  // setTimeout 0 排队到下一事件循环,250ms 二次保险
  const initTimers = [
    setTimeout(scheduleRefresh, 0),
    setTimeout(scheduleRefresh, 250),
  ];

  return {
    dispose(): void {
      initTimers.forEach((t) => clearTimeout(t));
      if (refreshTimer != null) clearTimeout(refreshTimer);
      hiddenRangeSub?.dispose();
      hiddenRangeSub = null;
      lastHiddenRange = null;
      collection.set([]);
      disposers.forEach((d) => d.dispose());
    },
  };
}