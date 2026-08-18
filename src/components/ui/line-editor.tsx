/**
 * LineEditor —— 带行号的轻量代码编辑器(DevToys 风格)
 *
 * 结构:
 * - 外框:圆角边框卡片
 * - 顶部工具栏(可选):左侧标题,右侧操作按钮(粘贴 / 打开文件 / 清除 + 自定义)
 * - 主体:行号 gutter + textarea,滚动同步
 *
 * 不使用 Monaco:轻量、无 CSP 风险,贴合 DevToys 编辑器视觉。
 */

import { useMemo, useRef, type JSX, type ReactNode, type UIEvent } from 'react';
import { ClipboardPaste, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { readClipboardText } from '@/lib/clipboard';
import { readFileAsText } from '@/lib/file-utils';

export interface LineEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** 顶部工具栏标题;提供时才渲染工具栏 */
  title?: string;
  /** 工具栏按钮显隐(默认全部显示,readOnly 时仅保留自定义按钮) */
  showPaste?: boolean;
  showOpenFile?: boolean;
  showClear?: boolean;
  /** 追加到工具栏右侧的自定义按钮 */
  actions?: ReactNode;
  className?: string;
  'data-testid'?: string;
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
}): JSX.Element {
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

export function LineEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  title,
  showPaste = true,
  showOpenFile = true,
  showClear = true,
  actions,
  className,
  'data-testid': testId,
}: LineEditorProps): JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lineCount = useMemo(() => {
    if (value.length === 0) return 1;
    let count = 1;
    for (let i = 0; i < value.length; i++) if (value[i] === '\n') count++;
    return count;
  }, [value]);

  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handlePaste = async () => {
    const text = await readClipboardText();
    if (text) {
      onChange?.(text);
    } else {
      toast.info('剪贴板为空或不可用');
    }
  };

  const handleFileChange = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      onChange?.(text);
    } catch {
      toast.error('读取文件失败');
    }
    // 允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const showToolbar = Boolean(title) || Boolean(actions);

  return (
    <div
      data-testid={testId}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card-layer',
        className,
      )}
    >
      {showToolbar && (
        // 工具栏:min-w-0 + flex-1 让标题 truncate 在 flex 容器中真正生效,
        // 避免长路径把工具栏撑爆溢出。右侧动作区 shrink-0 保证按钮不被挤压消失
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-2 py-0.5">
          <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
            {title}
          </span>
          <span className="flex shrink-0 items-center">
            {!readOnly && showPaste && (
              <ToolbarButton
                label="粘贴"
                testId={testId ? `${testId}-paste` : undefined}
                onClick={() => void handlePaste()}
              >
                <ClipboardPaste aria-hidden className="size-3.5" />
                粘贴
              </ToolbarButton>
            )}
            {!readOnly && showOpenFile && (
              <ToolbarButton
                label="打开文件"
                testId={testId ? `${testId}-open` : undefined}
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen aria-hidden className="size-3.5" />
              </ToolbarButton>
            )}
            {!readOnly && showClear && (
              <ToolbarButton
                label="清除"
                testId={testId ? `${testId}-clear` : undefined}
                onClick={() => onChange?.('')}
              >
                <X aria-hidden className="size-3.5" />
              </ToolbarButton>
            )}
            {actions}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 行号 gutter */}
        <div
          ref={gutterRef}
          aria-hidden
          className="w-11 shrink-0 select-none overflow-hidden border-r border-border bg-editor-gutter-bg py-2 pr-2 text-right font-mono text-xs leading-6 text-editor-gutter-fg"
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <textarea
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            onChange={(e) => onChange?.(e.target.value)}
            onScroll={handleScroll}
            aria-label={title ?? '文本编辑器'}
            className={cn(
              'h-full w-full resize-none whitespace-pre bg-transparent px-2 py-2 font-mono text-xs leading-6 outline-none',
              'placeholder:text-muted-foreground/60',
              readOnly && 'cursor-default',
            )}
          />
          {placeholder && value.length === 0 && !readOnly && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-2 top-2 font-mono text-xs leading-6 text-muted-foreground/60"
            >
              {placeholder}
            </div>
          )}
        </div>
      </div>

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
