/**
 * 「检查更新」视图组件(AboutDialog 应用信息区)
 *
 * 状态与动作在 @/hooks/useUpdateCheck(触发按钮与结果卡片在弹窗中相隔两处,
 * 由宿主调用 hook 一次再分发渲染);联网与安装流程说明见该 hook 头注释。
 */

import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
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

/** 发现新版本时的结果卡片(安装 / 手动下载 / 稍后) */
export function UpdateResultCard({ state }: { state: UpdateCheckState }): JSX.Element | null {
  const { t } = useTranslation();
  const { updateInfo, installing, progress, manualInstall } = state;
  if (!updateInfo?.available) return null;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div>
        <p className="font-medium">
          {t('settings.new_version_found', { version: updateInfo.version ?? '' })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('settings.current_version', { version: updateInfo.currentVersion })}
        </p>
      </div>
      {updateInfo.installModeLabel && (
        <p className="text-xs text-muted-foreground">
          {t('settings.install_mode_label')}
          <span className="font-medium text-foreground">{updateInfo.installModeLabel}</span>
        </p>
      )}
      {updateInfo.notes && (
        <ScrollArea className="max-h-40 rounded-md border border-border">
          <pre className="p-2 text-xs whitespace-pre-wrap">{updateInfo.notes}</pre>
        </ScrollArea>
      )}
      {progress !== null && !manualInstall && <Progress value={progress} className="w-full" />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={state.install} disabled={installing}>
          {manualInstall
            ? t('settings.go_download')
            : installing
              ? t('settings.downloading', {
                  progress: progress !== null ? ` ${progress}%` : '...',
                })
              : t('settings.install_now')}
        </Button>
        <Button variant="outline" onClick={state.openReleasePage} disabled={installing}>
          {t('settings.open_releases')}
        </Button>
        <Button variant="ghost" onClick={state.dismiss} disabled={installing}>
          {t('settings.later')}
        </Button>
      </div>
    </div>
  );
}
