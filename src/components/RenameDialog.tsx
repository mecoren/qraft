/**
 * 重命名对话框 —— 通用「输入新名称」小窗
 *
 * 供 JSON 格式化器 Tab 重命名与文本编辑器 Tab 重命名复用:
 * - 打开时预填当前名称并全选,直接输入即可覆盖
 * - Enter 确认、Esc / 点遮罩取消;名称为空(或全空白)时确认按钮禁用
 * - 由父组件持有 open 与重命名目标(推荐条件渲染,关闭即卸载,
 *   使 useState 初始化器每次打开都拿到最新的 initialValue)
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface RenameDialogProps {
  open: boolean;
  /** 对话框标题(如「重命名 Tab」) */
  title: string;
  /** 打开时的初始名称(通常为当前名称) */
  initialValue?: string;
  /** 输入框占位文本 */
  placeholder?: string;
  /** 确认回调(入参已 trim;空名称不会触发) */
  onConfirm: (name: string) => void;
  /** 取消回调(点取消 / 遮罩 / Esc) */
  onCancel: () => void;
  /** 测试定位 */
  'data-testid'?: string;
}

export function RenameDialog({
  open,
  title,
  initialValue = '',
  placeholder,
  onConfirm,
  onCancel,
  'data-testid': dataTestId,
}: RenameDialogProps): JSX.Element {
  // 条件渲染(父组件关闭即卸载)下,useState 初始化器每次打开都取最新值
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        data-testid={dataTestId}
        className="max-w-[min(calc(100%-2rem),24rem)] gap-4"
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          // 聚焦即全选(Radix 对话框默认聚焦首个可聚焦元素,配合覆盖输入)
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (trimmed) onConfirm(trimmed);
            }
          }}
          data-testid={`${dataTestId}-input`}
        />
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid={`${dataTestId}-cancel`}
          >
            {t('chrome.common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!trimmed}
            onClick={() => {
              if (trimmed) onConfirm(trimmed);
            }}
            data-testid={`${dataTestId}-confirm`}
          >
            {t('chrome.common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
