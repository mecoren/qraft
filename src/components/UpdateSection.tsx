/**
 * 「检查更新」视图组件(AboutDialog 应用信息区)
 *
 * 状态与动作在 @/hooks/useUpdateCheck(触发按钮在关于弹窗的徽标行,发现新版本时
 * 以模态弹窗承载安装操作,由宿主调用 hook 一次再分发渲染);联网与安装流程说明
 * 见该 hook 头注释。
 */

import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UpdateCheckState } from '@/hooks/useUpdateCheck';

/** 徽标行内的「检查更新」小按钮(h-6 与版本 Badge 同高,描述走原生 title 提示) */
export function UpdateCheckButton({ state }: { state: UpdateCheckState }): JSX.Element {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      className="h-6 rounded-full px-2 text-xs"
      onClick={state.check}
      disabled={state.checking || state.installing}
      title={t('settings.update_desc')}
    >
      {state.checking ? t('settings.checking') : t('settings.check_update')}
    </Button>
  );
}

/**
 * 发现新版本时的更新弹窗(立即更新 / 前往 GitHub Releases / 稍后再说)
 *
 * 弹窗本身不持有开关状态:是否展示直接由 `state.updateInfo.available` 派生,
 * 「稍后再说」经 `state.dismiss()` 清空 updateInfo 即关闭。
 *
 * 下载安装期间屏蔽全部关闭途径(ESC / 点击遮罩 / 关闭按钮),避免下载被中断后
 * 前端仍停留在旧状态。
 */
export function UpdateDialog({ state }: { state: UpdateCheckState }): JSX.Element {
  const { t } = useTranslation();
  const { updateInfo, installing, progress, manualInstall, dismiss } = state;

  return (
    <Dialog
      open={Boolean(updateInfo?.available)}
      onOpenChange={(next) => {
        if (!next && !installing) dismiss();
      }}
    >
      <DialogContent
        className="max-w-md"
        hideCloseButton={installing}
        onEscapeKeyDown={(event) => {
          if (installing) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (installing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('settings.new_version_found', { version: updateInfo?.version ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('settings.current_version', { version: updateInfo?.currentVersion ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {updateInfo?.installModeLabel && (
            <p className="text-xs text-muted-foreground">
              {t('settings.install_mode_label')}
              <span className="font-medium text-foreground">{updateInfo.installModeLabel}</span>
            </p>
          )}
          {updateInfo?.notes && (
            <ScrollArea className="max-h-40 rounded-md border border-border">
              <pre className="p-2 text-xs whitespace-pre-wrap">{updateInfo.notes}</pre>
            </ScrollArea>
          )}
          {progress !== null && !manualInstall && <Progress value={progress} className="w-full" />}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={installing}>
            {t('settings.later')}
          </Button>
          <Button variant="outline" onClick={state.openReleasePage} disabled={installing}>
            {t('settings.open_releases')}
          </Button>
          <Button onClick={state.install} disabled={installing}>
            {manualInstall
              ? t('settings.go_download')
              : installing
                ? t('settings.downloading', {
                    progress: progress !== null ? ` ${progress}%` : '...',
                  })
                : t('settings.install_now')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
