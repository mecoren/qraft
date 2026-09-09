/**
 * 文件本地历史对话框 —— Tab 右键「历史版本」的列表与操作出口
 *
 * 每次覆盖保存前,Rust 端会把磁盘旧内容快照到本地(file-history/)。
 * 本对话框列出该文件的全部快照(新 → 旧),提供三个动作:
 * - 对比当前:读取快照内容,生成「当前编辑(左) vs 历史版本(右)」的
 *   编辑器内建对比(ComparePair,与外部修改冲突的「对比」同款动线)
 * - 恢复内容:把历史内容读进一个新 Tab(不动原文件,由用户自行保存)
 * - 清空历史:删除该文件的全部快照(确认后执行)
 *
 * 数据加载由宿主(编辑器工作台)完成:快照元数据在打开对话框时拉取,
 * 组件只管展示与回调——保持 FileModifiedDialog 的同款「纯展示」分层。
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { History, GitCompare, RotateCcw, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { FileSnapshotMeta } from './fileOps';
import { ICON_STROKE_WIDTH } from '@/lib/icon-constants';

export interface FileHistoryDialogProps {
  /** 是否打开(推荐条件渲染:关闭即卸载并重新拉取) */
  open: boolean;
  /** 目标文件显示名 */
  fileName: string;
  /** 快照元数据(宿主加载;新 → 旧) */
  snapshots: FileSnapshotMeta[];
  /** 加载状态:true 显示加载中,false 显示列表/空态 */
  loading: boolean;
  /** 版本选中态(id;缺省不选中) */
  selectedId: string | null;
  /** 选中变化(点击行 / 键盘) */
  onSelect: (id: string) => void;
  /** 对比当前:以选中快照与当前编辑开对比 */
  onCompare: (id: string) => void;
  /** 恢复内容:把选中快照内容读进新 Tab */
  onRestore: (id: string) => void;
  /** 清空历史:第一次点击进入确认态,再次点击才真正执行(不可逆操作二段确认) */
  onClear: () => void;
  /** 关闭(遮罩 / Esc / 取消) */
  onCancel: () => void;
  /** 测试定位 */
  'data-testid'?: string;
}

/** epoch 毫秒 → 本地时间字符串(列表内联展示;后端只给毫秒数) */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** 字节数人性化(列表内联展示) */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileHistoryDialog({
  open,
  fileName,
  snapshots,
  loading,
  selectedId,
  onSelect,
  onCompare,
  onRestore,
  onClear,
  onCancel,
  'data-testid': dataTestId,
}: FileHistoryDialogProps): JSX.Element {
  const { t } = useTranslation();
  const selected = snapshots.find((s) => s.id === selectedId) ?? null;

  // 打开且无选中时默认选最新版(最常用对比对象)
  useEffect(() => {
    if (open && !selectedId && snapshots.length > 0) {
      onSelect(snapshots[0].id);
    }
  }, [open, selectedId, snapshots, onSelect]);

  // 「清空历史」二段确认:第一次点击进入确认态(按钮描红变文案),
  // 再次点击才执行;超时未确认自动复原,避免误触也有反悔窗口
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimerRef = useRef<number | undefined>(undefined);
  const requestClear = (): void => {
    if (confirmClear) {
      setConfirmClear(false);
      window.clearTimeout(confirmTimerRef.current);
      onClear();
      return;
    }
    setConfirmClear(true);
    confirmTimerRef.current = window.setTimeout(() => setConfirmClear(false), 3000);
  };
  // 确认态无需随 open 复位的 effect:宿主以条件渲染挂载本组件
  // (`{historyTabId && <Dialog>}`),关闭即卸载,本地 state 自然重置;
  // 挂起的超时定时器也随 jsdom 环境回收,不会跨实例触发。

  /**
   * 列表键盘导航:↑/↓ 在版本间移动选中(循环),Home/End 跳首末,
   * Enter 直接对选中版开对比(列表上最常用的动作)。
   * role=listbox 容器持焦点,aria-activedescendant 指示选中行。
   */
  const handleListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (snapshots.length === 0) return;
    const idx = snapshots.findIndex((s) => s.id === selectedId);
    const move = (next: number): void => {
      e.preventDefault();
      const wrapped = (next + snapshots.length) % snapshots.length;
      onSelect(snapshots[wrapped].id);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(idx < 0 ? 0 : idx + 1);
        break;
      case 'ArrowUp':
        move(idx < 0 ? 0 : idx - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(snapshots.length - 1);
        break;
      case 'Enter': {
        const target = idx >= 0 ? snapshots[idx] : snapshots[0];
        if (target) {
          e.preventDefault();
          onCompare(target.id);
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid={dataTestId} className="max-w-[min(calc(100%-2rem),34rem)] gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <History
              aria-hidden
              className="size-4 text-muted-foreground"
              strokeWidth={ICON_STROKE_WIDTH}
            />
            {t('tools.text_editor.history_title')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('tools.text_editor.history_desc', { name: fileName })}
        </p>

        <div
          role="listbox"
          aria-label={t('tools.text_editor.history_list_aria')}
          aria-activedescendant={selectedId ? `file-history-opt-${selectedId}` : undefined}
          data-testid="file-history-list"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="max-h-64 min-h-20 overflow-y-auto rounded-md border border-input focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        >
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('tools.text_editor.history_loading')}
            </div>
          ) : snapshots.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('tools.text_editor.history_empty')}
            </div>
          ) : (
            snapshots.map((s) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  id={`file-history-opt-${s.id}`}
                  role="option"
                  aria-selected={active}
                  data-testid={`file-history-item-${s.id}`}
                  onClick={() => onSelect(s.id)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-input px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                  }`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate tabular-nums">{formatTime(s.savedAtMs)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('tools.text_editor.history_version_size', {
                        size: formatBytes(s.originalBytes),
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('tools.text_editor.history_version_nth', {
                      num: snapshots.length - snapshots.indexOf(s),
                    })}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant={confirmClear ? 'destructive' : 'ghost'}
            size="sm"
            onClick={requestClear}
            disabled={snapshots.length === 0}
            data-testid="file-history-clear"
          >
            <Trash2 aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
            {confirmClear
              ? t('tools.text_editor.history_clear_confirm')
              : t('tools.text_editor.history_clear')}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              data-testid="file-history-cancel"
            >
              {t('tools.text_editor.cancel')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!selected}
              onClick={() => selected && onRestore(selected.id)}
              data-testid="file-history-restore"
            >
              <RotateCcw aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
              {t('tools.text_editor.history_restore')}
            </Button>
            <Button
              size="sm"
              disabled={!selected}
              onClick={() => selected && onCompare(selected.id)}
              data-testid="file-history-compare"
            >
              <GitCompare aria-hidden className="size-3.5" strokeWidth={ICON_STROKE_WIDTH} />
              {t('tools.text_editor.history_compare')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
