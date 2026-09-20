/**
 * useUpdateCheck —— 「检查更新」状态与动作(关于 → 应用信息)
 *
 * 自动更新是 Qraft 唯一允许的联网功能(见 PRD 13-security.md §3.1),
 * 更新源接入 GitHub Releases(https://github.com/mecoren/qraft/releases)。
 * 触发按钮(徽标行)与更新弹窗(UpdateDialog)在关于弹窗中相隔两处,故状态
 * 收拢在本 hook,由宿主(AboutDialog InfoSection)调用一次再分发渲染。
 *
 * 不同平台/安装方式对应不同的安装流程:
 * - 就地覆盖类(portable / AppImage / zip):自动下载 patch 包并覆盖,带进度反馈
 * - 系统安装版(msi / dmg / deb):Tauri patch 模式无法可靠升级,自动跳转 GitHub
 *   Releases 供用户手动下载整包(「不同版本不同安装方式」的核心分流)
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen, normalizeIpcError } from '@/lib/ipc';
import { toast } from 'sonner';

// ===== CheckUpdateResponse:与 Rust shell::updater::CheckUpdateResponse 对齐 =====
// 字段使用 camelCase(Rust 端 #[serde(rename_all = "camelCase")])
export interface CheckUpdateResponse {
  available: boolean;
  version: string | null;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  // 不同平台/安装方式对应不同的安装包类型与安装流程
  packageType:
    'msi' | 'nsis' | 'portable' | 'dmg' | 'app-archive' | 'appimage' | 'deb' | 'archive' | null;
  installMode: 'windows-msi' | 'windows-nsis' | 'in-place' | 'macos-dmg' | 'linux-deb' | null;
  installModeLabel: string | null;
}

/** 检查更新的全部状态与动作,由宿主组件调用一次、分发给按钮与更新弹窗 */
export interface UpdateCheckState {
  checking: boolean;
  installing: boolean;
  progress: number | null;
  updateInfo: CheckUpdateResponse | null;
  manualInstall: boolean;
  check: () => void;
  install: () => void;
  openReleasePage: () => void;
  dismiss: () => void;
}

export function useUpdateCheck(): UpdateCheckState {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [updateInfo, setUpdateInfo] = useState<CheckUpdateResponse | null>(null);
  // 系统安装版(msi / dmg / deb)需要手动下载整包;render 阶段需要读取该标记,
  // 故用 state 而非 ref(React 规则不允许在渲染期访问 ref)。
  const [manualInstall, setManualInstall] = useState(false);

  // 监听 Rust 端广播的下载进度事件(仅 in-place 自动更新使用)
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    void (async () => {
      unlistenProgress = await listen<number>('update-download-progress', (p) => setProgress(p));
      unlistenFinished = await listen('update-download-finished', () => setProgress(100));
    })();
    return () => {
      unlistenProgress?.();
      unlistenFinished?.();
    };
  }, []);

  async function handleCheck() {
    setChecking(true);
    try {
      const resp = await invoke<CheckUpdateResponse>('app_check_update');
      setUpdateInfo(resp);
      // 仅 MSI / dmg / deb 等 updater 无法自动升级的模式走手动分流;
      // NSIS 安装版与便携版一样由 updater 原生支持自动安装
      const isManual =
        resp.installMode != null &&
        resp.installMode !== 'in-place' &&
        resp.installMode !== 'windows-nsis';
      setManualInstall(isManual);
      // 发现新版本时不再另发 toast:更新弹窗会同时弹出并展示版本、安装方式与动作
      if (!resp.available) {
        toast.success(t('settings.up_to_date_toast', { version: resp.currentVersion }));
      }
    } catch (err) {
      // Tauri 命令 Err(AppError) 时以序列化错误对象 reject,需归一化取真实消息
      toast.error(t('settings.check_failed_toast', { message: normalizeIpcError(err).message }));
    } finally {
      setChecking(false);
    }
  }

  async function handleInstall() {
    // 系统安装版:直接跳转 GitHub Releases 手动下载整包(不走自动 patch)
    if (manualInstall) {
      void invoke('app_open_release_page');
      return;
    }
    setInstalling(true);
    setProgress(0);
    try {
      // in-place 类:把安装方式回传 Rust 走 download_and_install,完成后自动重启
      await invoke('app_install_update', { installMode: updateInfo?.installMode ?? null });
      // 安装后会自动重启,代码不会执行到这里
    } catch (err) {
      // 归一化后取真实消息(哨兵标记 MANUAL_INSTALL_REQUIRED 在 detail 文本中)
      const msg = normalizeIpcError(err).message;
      if (msg.includes('MANUAL_INSTALL_REQUIRED')) {
        // 兜底:Rust 端判定为系统安装版,跳转下载页
        void invoke('app_open_release_page');
      } else {
        toast.error(t('settings.install_failed_toast', { message: msg }));
      }
      setInstalling(false);
      setProgress(null);
    }
  }

  function handleOpenReleasePage() {
    void invoke('app_open_release_page');
  }

  return {
    checking,
    installing,
    progress,
    updateInfo,
    manualInstall,
    check: () => void handleCheck(),
    install: () => void handleInstall(),
    openReleasePage: handleOpenReleasePage,
    dismiss: () => setUpdateInfo(null),
  };
}
