/**
 * 文件外部修改冲突对话框 —— 保存乐观并发校验的交互出口
 *
 * 触发场景:Tab 保存带 expectedMtime,后端发现磁盘文件 mtime 与打开时
 * 不一致(Git checkout / 其它编辑器等外部程序已修改),拒绝写入并返回
 * ERR_FILE_MODIFIED。本对话框呈现三个出口(VSCode「文件已在磁盘上修改」
 * 同款语义):
 * - 覆盖:丢弃外部修改,以当前编辑内容写盘(仍走一次刷新基准的保存)
 * - 对比:先读磁盘最新内容,生成「磁盘快照 vs 当前编辑」的对比视图,
 *   由用户看完差异后自行决定
 * - 重新加载:丢弃本地未保存改动,以磁盘内容覆盖编辑器
 * 取消/Esc = 关闭对话框,保持现状(编辑内容与 dirty 均不变)
 *
 * 业务动作(重保存/开对比/重读)由宿主实现,本组件只管展示与回调。
 */
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { JSX } from 'react';

export interface FileModifiedDialogProps {
  /** 是否打开(推荐条件渲染:关闭即卸载) */
  open: boolean;
  /** 冲突文件显示名(对话框正文指名) */
  fileName: string;
  /** 覆盖:以当前编辑内容写盘(丢弃外部修改) */
  onOverwrite: () => void;
  /** 对比:磁盘最新内容 vs 当前编辑内容开对比视图 */
  onCompare: () => void;
  /** 重新加载:以磁盘内容覆盖编辑器(丢弃本地改动) */
  onReload: () => void;
  /** 取消(点遮罩 / Esc):保持现状 */
  onCancel: () => void;
  /** 测试定位 */
  'data-testid'?: string;
}

export function FileModifiedDialog({
  open,
  fileName,
  onOverwrite,
  onCompare,
  onReload,
  onCancel,
  'data-testid': dataTestId,
}: FileModifiedDialogProps): JSX.Element {
  const { t } = useTranslation();
  // 按钮固定以「file-modified-」为前缀:容器 testid 可为任意宿主值
  // (工作台用 file-modified-dialog),按钮查询不依赖容器前缀拼接
  const btn = (id: string): string => `file-modified-${id}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        data-testid={dataTestId}
        className="max-w-[min(calc(100%-2rem),30rem)] gap-4"
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t('tools.text_editor.modified_title')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('tools.text_editor.modified_desc', { name: fileName })}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={onCancel} data-testid={btn('cancel')}>
            {t('tools.text_editor.cancel')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onReload} data-testid={btn('reload')}>
              {t('tools.text_editor.modified_reload')}
            </Button>
            <Button variant="outline" size="sm" onClick={onCompare} data-testid={btn('compare')}>
              {t('tools.text_editor.modified_compare')}
            </Button>
            <Button size="sm" onClick={onOverwrite} data-testid={btn('overwrite')}>
              {t('tools.text_editor.modified_overwrite')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
