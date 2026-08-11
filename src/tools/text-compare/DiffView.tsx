/**
 * DiffView —— 文本差异并排渲染
 *
 * 左右两列(旧 | 新),行级底色:
 * - 左列删除行 → --diff-remove-line;右列新增行 → --diff-add-line
 * - 行内模式(inline)下,配对的修改行做字符级分段强调(emph 色)
 * 两列滚动联动。空差异时保留一个空行(行号 1),与 DevToys 空态一致。
 */

import { useMemo, useRef, type JSX, type UIEvent } from 'react';
import { cn } from '@/lib/utils';
import { inlineDiff, type AlignedRow, type AlignedSide } from '@/lib/diff';

export interface DiffViewProps {
  rows: AlignedRow[];
  inline: boolean;
  className?: string;
}

function renderSegments(side: AlignedSide, segments: { text: string; changed: boolean }[], emphClass: string) {
  if (segments.length === 0) return side.text || ' ';
  return segments.map((seg, i) =>
    seg.changed ? (
      <span key={i} className={cn('rounded-sm', emphClass)}>
        {seg.text}
      </span>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

export function DiffView({ rows, inline, className }: DiffViewProps): JSX.Element {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  /** 行内模式:预先计算配对行的字符级分段 */
  const inlineSegments = useMemo(() => {
    if (!inline) return null;
    return rows.map((row) => {
      if (row.left?.paired && row.right?.paired) {
        return inlineDiff(row.left.text, row.right.text);
      }
      return null;
    });
  }, [rows, inline]);

  const handleScroll = (source: 'left' | 'right') => (e: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const target = source === 'left' ? rightRef.current : leftRef.current;
    if (target) target.scrollTop = e.currentTarget.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  const renderSide = (side: 'left' | 'right') => {
    const ref = side === 'left' ? leftRef : rightRef;
    const lineBg = side === 'left' ? 'bg-diff-remove-line' : 'bg-diff-add-line';
    const emph = side === 'left' ? 'bg-diff-remove-emph' : 'bg-diff-add-emph';
    const isEmpty = rows.length === 0;

    return (
      <div
        ref={ref}
        onScroll={handleScroll(side)}
        data-testid={`diff-${side}`}
        className="h-full overflow-auto font-mono text-xs leading-6"
      >
        {isEmpty ? (
          <div className="flex">
            <span className="w-11 shrink-0 select-none pr-2 text-right text-editor-gutter-fg">1</span>
            <span className="min-w-0 flex-1 whitespace-pre px-2" />
          </div>
        ) : (
          rows.map((row, i) => {
            const s = row[side];
            const segs = inlineSegments?.[i];
            return (
              <div key={i} className={cn('flex', s && s.op !== 'equal' && lineBg)}>
                <span className="w-11 shrink-0 select-none pr-2 text-right text-editor-gutter-fg">
                  {s?.lineNo ?? ''}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre px-2">
                  {s
                    ? segs
                      ? renderSegments(s, side === 'left' ? segs.left : segs.right, emph)
                      : s.text || ' '
                    : ' '}
                </span>
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <div className={cn('grid min-h-0 grid-cols-2 divide-x divide-border', className)}>
      {renderSide('left')}
      {renderSide('right')}
    </div>
  );
}
