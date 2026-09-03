/**
 * Regex Lab 子面板:匹配信息(Match Information)
 *
 * regex101 的 "Match Information" 面板:逐条列出整体匹配 + 编号/命名分组,
 * hover 时在测试文本编辑器内联动高亮对应区间。
 *
 * 渲染护栏:初始只渲染前 RENDER_LIMIT 条(后端已封顶 5000,但万级 DOM 节点
 * 仍会拖垮滚动),点击「显示更多」按批追加。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { RegexGroupEntry, RegexLiveOutput } from './types';

/** 首屏渲染条数;后续每次点击追加同量 */
const RENDER_LIMIT = 200;

export function MatchInfoPanel({
  output,
  onHoverRange,
}: {
  output: RegexLiveOutput | null;
  /** hover 区间([start, end] 字符偏移,unhover 传 null) */
  onHoverRange?: (range: [number, number] | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [renderCount, setRenderCount] = useState(RENDER_LIMIT);

  if (!output || !output.ok) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="match-info-empty"
      >
        {t('tools.regex_tester.match_info_empty')}
      </div>
    );
  }

  const { matches, groups, matchCount } = output;
  const visible = matches.slice(0, renderCount);
  const hidden = matches.length - visible.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {matchCount === 0 ? (
        <div
          className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground"
          data-testid="match-info-no-matches"
        >
          {t('tools.regex_tester.no_matches')}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-1.5 p-2" data-testid="match-info-list">
            {visible.map((m) => (
              <li
                key={m.index}
                className="rounded-md border border-border p-2 hover:bg-accent/40"
                data-testid="match-item"
                onMouseEnter={() => onHoverRange?.(m.range)}
                onMouseLeave={() => onHoverRange?.(null)}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary">
                    #{m.index}
                  </span>
                  <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {m.text === '' ? t('tools.regex_tester.zero_width') : m.text}
                  </code>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {m.range[0]}–{m.range[1]}
                  </span>
                </div>

                {/* 编号分组 */}
                {m.groups.length > 0 && (
                  <GroupRow
                    entries={groups}
                    spans={m.groups.map((g) => (g ? [g.start, g.end] : null))}
                    texts={m.groups.map((g) => (g ? g.text : null))}
                    onHoverRange={onHoverRange}
                    kind="numbered"
                  />
                )}

                {/* 命名分组 */}
                {m.namedGroups.length > 0 && (
                  <GroupRow
                    entries={groups}
                    spans={m.namedGroups.map((g) => [g.start, g.end] as [number, number])}
                    texts={m.namedGroups.map((g) => g.text)}
                    names={m.namedGroups.map((g) => g.name)}
                    onHoverRange={onHoverRange}
                    kind="named"
                  />
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              className="mb-2 flex w-full items-center justify-center gap-1 rounded border border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              onClick={() => setRenderCount((c) => c + RENDER_LIMIT)}
              data-testid="show-more-matches"
            >
              <ChevronDown aria-hidden className="size-3" />
              {t('tools.regex_tester.show_more', { count: Math.min(hidden, RENDER_LIMIT) })}
            </button>
          )}
        </ScrollArea>
      )}
    </div>
  );
}

function GroupRow({
  entries,
  spans,
  texts,
  names,
  onHoverRange,
  kind,
}: {
  /** 分组清单(用于把序号映射为名字) */
  entries: RegexGroupEntry[];
  spans: Array<[number, number] | null>;
  texts: Array<string | null>;
  names?: string[];
  onHoverRange?: (range: [number, number] | null) => void;
  kind: 'numbered' | 'named';
}): JSX.Element | null {
  const { t } = useTranslation();
  if (spans.length === 0) return null;
  const label =
    kind === 'numbered'
      ? t('tools.regex_tester.groups_label')
      : t('tools.regex_tester.named_groups_label');

  return (
    <div className="mt-1.5 space-y-0.5 pl-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {spans.map((span, i) => {
          const name = names?.[i] ?? entries[i]?.name ?? '';
          const badge = kind === 'numbered' ? `${i + 1}` : name;
          const full = kind === 'numbered' && name ? `${i + 1} (${name})` : badge;
          return (
            <span
              // eslint-disable-next-line react-x/no-array-index-key -- 分组徽章随匹配快照重建,序号即分组号语义
              key={i}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs"
              onMouseEnter={() => span && onHoverRange?.(span)}
              onMouseLeave={() => onHoverRange?.(null)}
              title={
                span
                  ? t('tools.regex_tester.group_span_title', {
                      name: full,
                      start: span[0],
                      end: span[1],
                    })
                  : t('tools.regex_tester.group_not_matched')
              }
            >
              <span className="text-muted-foreground">{full}=</span>
              <span className="max-w-40 truncate">
                {texts[i] ?? t('tools.regex_tester.group_empty')}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
