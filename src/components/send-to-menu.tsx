/**
 * 输出区「发送到…」菜单:把本工具输出作为另一工具的输入。
 *
 * - 目标清单集中于此;仅列出已接入 useToolHandoff 消费的文本型工具
 *   (label 存目录 id,展示名经 catalog LocalizedText 随语言走)
 * - 文本编辑器走其自有 openDroppedText(新 Tab 承载),其余走 handoffStore
 * - 使用方式:放进 CodeEditor 的 actions 插槽,紧挨 CopyAction
 */
import { useTranslation } from 'react-i18next';
import { Forward } from 'lucide-react';
import type { JSX } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { requestHandoff, type HandoffSide } from '@/store/handoffStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { DEFAULT_TOOL_ID, getCatalogEntry, pickText } from '@/lib/tool-catalog';

const HANDOFF_TARGETS: ReadonlyArray<{ toolId: string }> = [
  { toolId: DEFAULT_TOOL_ID },
  { toolId: 'json_formatter' },
  { toolId: 'base64_codec' },
  { toolId: 'hash_calculator' },
  { toolId: 'json_minifier' },
  { toolId: 'text_compare' },
];

interface SendToMenuProps {
  /** 待发送的文本(通常为工具输出) */
  text: string;
  /** 当前工具 id,从目标清单中排除自身 */
  currentToolId: string;
  testId?: string;
}

export function SendToMenu({ text, currentToolId, testId }: SendToMenuProps): JSX.Element {
  const { t } = useTranslation();
  const targets = HANDOFF_TARGETS.filter((target) => target.toolId !== currentToolId);
  if (targets.length === 0 || !text) return <span />;

  const send = (toolId: string, side?: HandoffSide): void => {
    if (toolId === DEFAULT_TOOL_ID) {
      useEditorWorkspaceStore
        .getState()
        .openDroppedText(t('chrome.send_to.dropped_tab_name'), text);
      return;
    }
    requestHandoff(toolId, text, side);
  };

  const labelOf = (toolId: string): string =>
    pickText(getCatalogEntry(toolId)?.name ?? { zh: toolId, en: toolId });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          title={t('chrome.send_to.send_aria')}
          aria-label={t('chrome.send_to.send_aria')}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Forward aria-hidden className="size-3.5" />
          {t('chrome.send_to.send_to')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.flatMap((target) =>
          // 文本比较是双栏目标:扁平列出修改前(左)/修改后(右)两个入口
          // (子菜单 hover 在触屏/键盘下难用,两项扁平更直接),其余单输入工具直达
          target.toolId === 'text_compare'
            ? (['original', 'modified'] as const).map((side) => (
                <DropdownMenuItem
                  key={`${target.toolId}-${side}`}
                  onSelect={() => send(target.toolId, side)}
                >
                  {`${labelOf(target.toolId)} · ${side === 'original' ? t('chrome.send_to.side_original') : t('chrome.send_to.side_modified')}`}
                </DropdownMenuItem>
              ))
            : [
                <DropdownMenuItem key={target.toolId} onSelect={() => send(target.toolId)}>
                  {labelOf(target.toolId)}
                </DropdownMenuItem>,
              ],
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
