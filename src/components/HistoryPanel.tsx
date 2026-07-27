import { useRef, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHistoryStore } from '@/store/historyStore';
import type { HistoryEntry } from '@/types/history';

export interface HistoryPanelProps {
  onSelect: (entry: HistoryEntry) => void;
}

export function HistoryPanel({ onSelect }: HistoryPanelProps): JSX.Element {
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const parentRef = useRef<HTMLDivElement>(null);

  // 虚拟列表:仅渲染可见行,即使有数千条历史也保持流畅
  // initialRect 让首次渲染就有非零可视区,避免在 jsdom 或异步 ResizeObserver 下漏渲染
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
    initialRect: { width: 800, height: 600 },
  });

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-semibold flex-1">历史记录</h2>
        <Button
          variant="ghost"
          size="sm"
          aria-label="清空历史记录"
          onClick={() => void clearHistory()}
          disabled={entries.length === 0}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="ml-1">清空历史</span>
        </Button>
      </header>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          暂无历史记录
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto" aria-label="历史记录列表">
          <ul style={{ height: `${virtualizer.getTotalSize()}px` }} className="relative">
            {virtualizer.getVirtualItems().map((vi) => {
              const entry = entries[vi.index];
              return (
                <li
                  key={entry.id}
                  className="absolute left-0 w-full"
                  style={{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-accent transition-colors flex flex-col gap-0.5"
                    onClick={() => onSelect(entry)}
                  >
                    <span className="text-sm font-medium">
                      {entry.toolId}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                      </span>
                    </span>
                    <span className="text-xs font-mono text-muted-foreground truncate">
                      {entry.inputSummary.textPreview}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
