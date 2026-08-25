/**
 * 输出区「发送到…」菜单:把本工具输出作为另一工具的输入。
 *
 * - 目标清单集中于此;仅列出已接入 useToolHandoff 消费的文本型工具
 * - 文本编辑器走其自有 openDroppedText(新 Tab 承载),其余走 handoffStore
 * - 使用方式:放进 CodeEditor 的 actions 插槽,紧挨 CopyAction
 */
import { Forward } from 'lucide-react';
import type { JSX } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { requestHandoff } from '@/store/handoffStore';
import { useEditorWorkspaceStore } from '@/tools/code-editor-workspace/useEditorWorkspaceStore';
import { DEFAULT_TOOL_ID } from '@/lib/tool-catalog';

const HANDOFF_TARGETS: ReadonlyArray<{ toolId: string; label: string }> = [
  { toolId: DEFAULT_TOOL_ID, label: '文本编辑器' },
  { toolId: 'json_formatter', label: 'JSON 格式化器' },
  { toolId: 'base64_codec', label: 'Base64 转换器' },
  { toolId: 'hash_calculator', label: '哈希计算器' },
];

interface SendToMenuProps {
  /** 待发送的文本(通常为工具输出) */
  text: string;
  /** 当前工具 id,从目标清单中排除自身 */
  currentToolId: string;
  testId?: string;
}

export function SendToMenu({ text, currentToolId, testId }: SendToMenuProps): JSX.Element {
  const targets = HANDOFF_TARGETS.filter((t) => t.toolId !== currentToolId);
  if (targets.length === 0 || !text) return <span />;

  const send = (target: (typeof HANDOFF_TARGETS)[number]): void => {
    if (target.toolId === DEFAULT_TOOL_ID) {
      useEditorWorkspaceStore.getState().openDroppedText('发送的内容', text);
      return;
    }
    requestHandoff(target.toolId, text);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          title="发送到其他工具"
          aria-label="发送到其他工具"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Forward aria-hidden className="size-3.5" />
          发送到
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((t) => (
          <DropdownMenuItem key={t.toolId} onSelect={() => send(t)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
