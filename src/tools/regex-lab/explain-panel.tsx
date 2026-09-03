/**
 * Regex Lab 子面板:解释树(Explain)递归渲染
 *
 * regex101 的 "Explanation" 面板:逐 token 列出标题 + 说明,层级结构
 * 按组/量词/字符类嵌套;hover 高亮联动 pattern 对应区间由父级处理。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RegexExplainNode } from './types';

export function ExplainPanel({
  nodes,
  onHoverSpan,
}: {
  nodes: RegexExplainNode[];
  /** hover 时上报 token 的 pattern 字符偏移区间(父级联动 pattern 选区) */
  onHoverSpan?: (span: [number, number] | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        {t('tools.regex_tester.explain_empty')}
      </div>
    );
  }
  return (
    <ul data-testid="explain-list" className="divide-y divide-border/70 p-2">
      {nodes.map((n, i) => (
        // eslint-disable-next-line react-x/no-array-index-key -- 解释树节点随输入全量重建,无稳定主键;token+索引定位足够
        <ExplainNodeItem key={i} node={n} onHoverSpan={onHoverSpan} />
      ))}
    </ul>
  );
}

function ExplainNodeItem({
  node,
  onHoverSpan,
}: {
  node: RegexExplainNode;
  onHoverSpan?: (span: [number, number] | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li
      className="rounded-md px-1 py-1 hover:bg-accent/50"
      data-testid="explain-node"
      data-explain-title={node.title}
      onMouseEnter={() => onHoverSpan?.(node.span)}
      onMouseLeave={() => onHoverSpan?.(null)}
    >
      <div className="flex items-start gap-1.5">
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? t('tools.regex_tester.collapse') : t('tools.regex_tester.expand')}
            className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="mt-0.5 inline-block size-3.5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {node.token || '∅'}
            </code>
            <span className="truncate text-xs font-medium">{node.title}</span>
          </div>
          <p className="mt-0.5 pl-1 text-xs leading-relaxed text-muted-foreground">
            {node.description}
          </p>
          {open && hasChildren && (
            <ul className="mt-1 space-y-0.5 border-l border-border pl-2">
              {node.children.map((c, i) => (
                // eslint-disable-next-line react-x/no-array-index-key -- 递归子节点同上:全量重建的快照列表
                <ExplainNodeItem key={i} node={c} onHoverSpan={onHoverSpan} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
