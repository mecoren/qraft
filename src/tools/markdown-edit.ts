/**
 * Markdown 格式编辑纯函数(工具栏按钮 / Monaco 快捷键共用)
 *
 * 设计:所有变换以「字符串进出」建模,Monaco 侧只做薄适配
 * (取选区/行集 → 调用纯函数 → executeEdits + 恢复选区),
 * 便于对包裹/取消包裹/行前缀切换逻辑做完整单测。
 */

/** 行内包裹(加粗/斜体/删除线/行内代码)结果:insert 相对于插入起点的选区偏移 */
export interface InlineEditResult {
  /** 应写入的文本 */
  insert: string;
  /** 插入后应选中的起点偏移(相对插入起点) */
  selectStart: number;
  /** 插入后应选中的终点偏移 */
  selectEnd: number;
}

/**
 * 行内包裹/取消包裹:
 * - 选区文本已被相同标记包裹 → 剥离标记(选中还原后的原文)
 * - 有选区未包裹 → 两侧加标记(仍选中原文)
 * - 无选区 → 插入「标记+占位文字」并选中占位文字
 */
export function applyInlineWrap(
  selected: string,
  before: string,
  after: string,
  placeholder: string,
): InlineEditResult {
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { insert: inner, selectStart: 0, selectEnd: inner.length };
  }
  if (selected) {
    return {
      insert: `${before}${selected}${after}`,
      selectStart: before.length,
      selectEnd: before.length + selected.length,
    };
  }
  return {
    insert: `${before}${placeholder}${after}`,
    selectStart: before.length,
    selectEnd: before.length + placeholder.length,
  };
}

/** 行前缀模式:H1/H2 标题、引用、无序列表、任务列表 */
export type LinePrefixMode = 'h1' | 'h2' | 'quote' | 'bullet' | 'task';

const PREFIX_ADD: Record<Exclude<LinePrefixMode, 'h1' | 'h2'>, string> = {
  quote: '> ',
  bullet: '- ',
  task: '- [ ] ',
};

const HEADING_PATTERN = /^#{1,6}[ \t]+/;
const TASK_PATTERN = /^- \[[xX ]\][ \t]*/;
const BULLET_PATTERN = /^-[ \t]+/;
const QUOTE_PATTERN = /^>[ \t]?/;

/** 剥离标题标记,返回剩余文本与原级别(null=非标题) */
function stripHeading(line: string): { text: string; level: number | null } {
  const match = HEADING_PATTERN.exec(line);
  if (!match) return { text: line, level: null };
  return { text: line.slice(match[0].length), level: match[0].trim().length };
}

/** 判断该行是否已应用目标前缀 */
function detectApplied(line: string, mode: LinePrefixMode): boolean {
  switch (mode) {
    case 'h1':
      return stripHeading(line).level === 1;
    case 'h2':
      return stripHeading(line).level === 2;
    case 'quote':
      return QUOTE_PATTERN.test(line);
    case 'bullet':
      return BULLET_PATTERN.test(line);
    case 'task':
      return TASK_PATTERN.test(line);
  }
}

/** 为未应用行添加目标前缀(h1/h2 会替换既有标题级别;bullet/task 相互转换) */
function applyToLine(line: string, mode: LinePrefixMode): string {
  if (mode === 'h1' || mode === 'h2') {
    return `${mode === 'h1' ? '#' : '##'} ${stripHeading(line).text}`;
  }
  // 列表类:先剥离已有列表/任务标记再加目标前缀
  let base = line;
  const task = TASK_PATTERN.exec(base);
  if (task) base = base.slice(task[0].length);
  else {
    const bullet = BULLET_PATTERN.exec(base);
    if (bullet) base = base.slice(bullet[0].length);
  }
  return `${PREFIX_ADD[mode]}${base}`;
}

/** 从已应用行移除目标前缀 */
function removeFromLine(line: string, mode: LinePrefixMode): string {
  switch (mode) {
    case 'h1':
    case 'h2':
      return stripHeading(line).text;
    case 'quote':
      return line.replace(QUOTE_PATTERN, '');
    case 'bullet': {
      const task = TASK_PATTERN.exec(line);
      if (task) return line.slice(task[0].length);
      return line.replace(BULLET_PATTERN, '');
    }
    case 'task':
      return line.replace(TASK_PATTERN, '');
  }
}

/**
 * 对所选行集合做前缀切换:
 * - 全部非空行都已应用 → 整体移除
 * - 否则添加到所有非空行(h1/h2 替换既有标题级别;bullet↔task 智能转换;
 *   空白行在「添加」时保持不变)
 */
export function toggleLinePrefixes(
  lines: readonly string[],
  mode: LinePrefixMode,
): { lines: string[]; appliedToAll: boolean } {
  const meaningful = lines.filter((line) => line.trim().length > 0);
  const appliedToAll =
    meaningful.length > 0 && meaningful.every((line) => detectApplied(line, mode));

  const result = lines.map((line) => {
    if (!line.trim()) return line;
    if (mode === 'h1' || mode === 'h2') {
      if (!appliedToAll && stripHeading(line).text.trim() === '') return line;
    }
    return appliedToAll ? removeFromLine(line, mode) : applyToLine(line, mode);
  });

  return { lines: result, appliedToAll };
}
