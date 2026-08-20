import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@/lib/ipc';
import { toast } from 'sonner';
import { Palette, Type, Check, ArrowUp, ArrowDown, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { FontPicker } from '@/components/ui/font-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Logo } from '@/components/Logo';
import { useConfigStore } from '@/store/configStore';
import type { ShortcutBinding } from '@/types/config';
import {
  type PaletteId,
  getStoredPaletteId,
  getStoredCustomAccent,
  setPalette,
} from '@/lib/color-theme';
import { PRESET_PALETTES } from '@/lib/design-tokens';
import {
  applyFontFamily,
  applyFontSizeLevel,
  applyFontWeightLevel,
  applyMonoFontFamily,
  FONT_FAMILY_STORAGE_KEY,
  MONO_FONT_FAMILY_STORAGE_KEY,
  FONT_SIZE_LEVELS,
  FONT_SIZE_STORAGE_KEY,
  FONT_WEIGHT_LEVELS,
  FONT_WEIGHT_STORAGE_KEY,
  getStoredFontFamily,
  getStoredMonoFontFamily,
  getStoredFontSizeLevel,
  getStoredFontWeightLevel,
} from '@/lib/theme';
import { listSystemFonts, type FontInfo } from '@/lib/fonts';
import { buildFontFamilyOptions, type FontFamilyOption } from '@/lib/fontFamilies';
import { cn } from '@/lib/utils';
import { NAMING_CONVENTIONS, type NamingConventionId } from '@/lib/naming-convention';
import { DEFAULT_EDITOR_CONFIG, DEFAULT_USER_CONFIG } from '@/types/config';

const SHORTCUT_KEYS: Array<{
  key: keyof ShortcutBinding;
  label: string;
  /** 标记为暂未生效(该功能尚未实现对应快捷键处理) */
  pending?: boolean;
}> = [
  { key: 'open_command_palette', label: '打开命令面板' },
  { key: 'toggle_sidebar', label: '切换侧栏' },
  { key: 'execute_tool', label: '执行工具', pending: true },
  { key: 'clear_input', label: '清空输入', pending: true },
  { key: 'copy_output', label: '复制输出', pending: true },
  { key: 'toggle_settings', label: '切换设置' },
  { key: 'switch_tool', label: '切换工具' },
  { key: 'open_history', label: '打开历史' },
  { key: 'search', label: '搜索', pending: true },
  { key: 'close_panel', label: '关闭面板' },
  { key: 'save_file', label: '保存编辑器' },
  { key: 'cycle_naming_case', label: '切换字符命名风格' },
  { key: 'toggle_case', label: '切换大小写' },
];

const generalSchema = z.object({
  maxHistory: z.number().int().min(0).max(10000),
  jsonIndent: z.number().int().min(0).max(8),
  confirmOnClear: z.boolean(),
});

const shortcutSchema = z.object({
  shortcuts: z.object(
    SHORTCUT_KEYS.reduce(
      // 允许空字符串,表示「禁用该快捷键」(运行时 parseShortcut 对空串返回 null 不注册)
      (acc, s) => ({ ...acc, [s.key]: z.string() }),
      {} as Record<keyof ShortcutBinding, z.ZodString>,
    ),
  ),
});

type GeneralFormValues = z.infer<typeof generalSchema>;

// ===== CheckUpdateResponse:与 Rust shell::updater::CheckUpdateResponse 对齐 =====
// 字段使用 camelCase(Rust 端 #[serde(rename_all = "camelCase")])
interface CheckUpdateResponse {
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

/**
 * 「检查更新」区块
 *
 * 自动更新是 Qraft 唯一允许的联网功能(见 PRD 13-security.md §3.1)。
 * 更新源接入 GitHub Releases(https://github.com/mecoren/qraft/releases)。
 * 不同平台/安装方式对应不同的安装包类型与安装流程:
 * - 就地覆盖类(portable / AppImage / zip):自动下载 patch 包并覆盖,带进度反馈
 * - 系统安装版(msi / dmg / deb):Tauri patch 模式无法可靠升级,自动跳转 GitHub
 *   Releases 供用户手动下载整包(「不同版本不同安装方式」的核心分流)
 */
export function UpdateSection(): JSX.Element {
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

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      const resp = await invoke<CheckUpdateResponse>('app_check_update');
      setUpdateInfo(resp);
      const isManual = resp.installMode != null && resp.installMode !== 'in-place';
      setManualInstall(isManual);
      if (!resp.available) {
        toast.success(`已是最新版本 (v${resp.currentVersion})`);
      } else if (isManual) {
        // 系统安装版:提示需前往 Releases 手动下载整包(不同安装方式)
        toast.info(`当前为「${resp.installModeLabel}」,需前往 GitHub Releases 下载整包更新`);
      }
    } catch (err) {
      toast.error(`检查更新失败: ${String(err)}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleInstallUpdate() {
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
      const msg = String(err);
      if (msg.includes('MANUAL_INSTALL_REQUIRED')) {
        // 兜底:Rust 端判定为系统安装版,跳转下载页
        void invoke('app_open_release_page');
      } else {
        toast.error(`安装更新失败: ${msg}`);
      }
      setInstalling(false);
      setProgress(null);
    }
  }

  function handleOpenReleasePage() {
    void invoke('app_open_release_page');
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">检查更新</h3>
        <p className="text-xs text-muted-foreground">
          自动更新接入 GitHub Releases,可在下方手动检查。
        </p>
      </div>

      {!updateInfo?.available && (
        <Button onClick={handleCheckUpdate} disabled={checking || installing}>
          {checking ? '检查中...' : '检查更新'}
        </Button>
      )}

      {updateInfo?.available && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div>
            <p className="font-medium">发现新版本 v{updateInfo.version}</p>
            <p className="text-xs text-muted-foreground">当前版本 v{updateInfo.currentVersion}</p>
          </div>
          {updateInfo.installModeLabel && (
            <p className="text-xs text-muted-foreground">
              安装方式：
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
            <Button onClick={handleInstallUpdate} disabled={installing}>
              {manualInstall
                ? '前往 GitHub 下载整包'
                : installing
                  ? `下载并安装中${progress !== null ? ` ${progress}%` : '...'}`
                  : '立即更新'}
            </Button>
            <Button variant="outline" onClick={handleOpenReleasePage} disabled={installing}>
              前往 GitHub Releases
            </Button>
            <Button variant="ghost" onClick={() => setUpdateInfo(null)} disabled={installing}>
              稍后再说
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 关于区块:应用信息 + 开源许可 + 开源组件
// 设计参考 wait-home/desktop 的 about-page(应用信息/开源许可/开源组件三部分)
// ============================================================

/**
 * 应用版本号 —— 构建时由 Vite 注入(唯一数据源:package.json 的 version 字段)。
 * 发版请使用 scripts/bump-version.sh 统一升级,勿在此处手动修改。
 */
const APP_VERSION = __APP_VERSION__;

/** 应用信息条目 */
const ABOUT_INFO_ITEMS: { label: string; value: string }[] = [
  { label: '应用名称', value: 'Qraft' },
  { label: '版本号', value: `v${APP_VERSION}` },
  { label: '技术栈', value: 'Tauri 2.0 + React 19 + Rust' },
  { label: 'UI 框架', value: 'shadcn/ui + Tailwind CSS v4' },
  { label: '更新源', value: 'GitHub Releases' },
];

interface LicenseEntry {
  name: string;
  license: string;
  homepage?: string;
}

/** 开源许可汇总(精选主要依赖) */
const LICENSES: LicenseEntry[] = [
  { name: 'React', license: 'MIT License', homepage: 'https://react.dev' },
  { name: 'React Router', license: 'MIT License', homepage: 'https://reactrouter.com' },
  { name: 'Tailwind CSS', license: 'MIT License', homepage: 'https://tailwindcss.com' },
  { name: 'shadcn/ui', license: 'MIT License', homepage: 'https://ui.shadcn.com' },
  { name: 'Radix UI', license: 'MIT License', homepage: 'https://www.radix-ui.com' },
  { name: 'Tauri', license: 'Apache-2.0 / MIT', homepage: 'https://tauri.app' },
  { name: 'Vite', license: 'MIT License', homepage: 'https://vitejs.dev' },
  { name: 'TypeScript', license: 'Apache-2.0', homepage: 'https://www.typescriptlang.org' },
  {
    name: 'Monaco Editor',
    license: 'MIT License',
    homepage: 'https://microsoft.github.io/monaco-editor',
  },
  { name: 'Lucide Icons', license: 'ISC License', homepage: 'https://lucide.dev' },
  { name: 'Zustand', license: 'MIT License', homepage: 'https://github.com/pmndrs/zustand' },
  { name: 'React Hook Form', license: 'MIT License', homepage: 'https://react-hook-form.com' },
  { name: 'Zod', license: 'MIT License', homepage: 'https://zod.dev' },
  {
    name: 'SQL Formatter',
    license: 'MIT License',
    homepage: 'https://github.com/sql-formatter-org/sql-formatter',
  },
  { name: 'sonner', license: 'MIT License', homepage: 'https://sonner.emilkowal.ski' },
  { name: 'Rust', license: 'MIT / Apache-2.0', homepage: 'https://www.rust-lang.org' },
  { name: 'Tokio', license: 'MIT License', homepage: 'https://tokio.rs' },
  { name: 'Serde', license: 'MIT / Apache-2.0', homepage: 'https://serde.rs' },
  { name: 'Chrono', license: 'MIT / Apache-2.0', homepage: 'https://github.com/chronotope/chrono' },
  {
    name: 'window-vibrancy',
    license: 'MIT License',
    homepage: 'https://github.com/tauri-apps/window-vibrancy',
  },
];

type ComponentSource = 'frontend' | 'rust';

interface OpenSourceComponent {
  name: string;
  version: string;
  source: ComponentSource;
  description: string;
  license: string;
  repository?: string;
  homepage?: string;
}

/** 开源组件清单(与 package.json / Cargo.toml 的依赖对齐) */
const COMPONENTS: OpenSourceComponent[] = [
  // ---------- 前端 npm 依赖 ----------
  {
    name: 'react',
    version: '^19.2.8',
    source: 'frontend',
    description: '用于构建用户界面的声明式库',
    license: 'MIT',
    repository: 'https://github.com/facebook/react',
    homepage: 'https://react.dev',
  },
  {
    name: 'react-dom',
    version: '^19.2.8',
    source: 'frontend',
    description: 'React 的 DOM 渲染器',
    license: 'MIT',
    repository: 'https://github.com/facebook/react',
  },
  {
    name: 'react-router-dom',
    version: '^7.18.2',
    source: 'frontend',
    description: 'React 官方声明式路由库',
    license: 'MIT',
    repository: 'https://github.com/remix-run/react-router',
    homepage: 'https://reactrouter.com',
  },
  {
    name: '@tauri-apps/api',
    version: '^2.11.1',
    source: 'frontend',
    description: 'Tauri 2.0 JavaScript API',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/tauri',
    homepage: 'https://tauri.app',
  },
  {
    name: '@tauri-apps/plugin-updater',
    version: '^2.10.1',
    source: 'frontend',
    description: 'Tauri 应用更新插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-dialog',
    version: '^2.7.2',
    source: 'frontend',
    description: 'Tauri 原生对话框插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-shell',
    version: '^2.3.5',
    source: 'frontend',
    description: 'Tauri Shell 调用插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: '@tauri-apps/plugin-clipboard-manager',
    version: '^2.3.2',
    source: 'frontend',
    description: 'Tauri 剪贴板管理插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'zustand',
    version: '^5.0.14',
    source: 'frontend',
    description: '轻量级状态管理库',
    license: 'MIT',
    repository: 'https://github.com/pmndrs/zustand',
  },
  {
    name: 'react-hook-form',
    version: '^7.83.0',
    source: 'frontend',
    description: '高性能表单状态管理',
    license: 'MIT',
    repository: 'https://github.com/react-hook-form/react-hook-form',
    homepage: 'https://react-hook-form.com',
  },
  {
    name: '@hookform/resolvers',
    version: '^5.5.7',
    source: 'frontend',
    description: 'React Hook Form 校验解析器',
    license: 'MIT',
    repository: 'https://github.com/react-hook-form/resolvers',
  },
  {
    name: 'zod',
    version: '^4.4.3',
    source: 'frontend',
    description: '运行时类型校验库',
    license: 'MIT',
    repository: 'https://github.com/colinhacks/zod',
    homepage: 'https://zod.dev',
  },
  {
    name: 'tailwindcss',
    version: '^4.3.3',
    source: 'frontend',
    description: '原子化 CSS 框架 v4',
    license: 'MIT',
    repository: 'https://github.com/tailwindlabs/tailwindcss',
    homepage: 'https://tailwindcss.com',
  },
  {
    name: '@radix-ui/primitives',
    version: '^1.1.21',
    source: 'frontend',
    description: '无头 UI 组件原语(Dialog / Tabs / Select 等)',
    license: 'MIT',
    repository: 'https://github.com/radix-ui/primitives',
    homepage: 'https://www.radix-ui.com',
  },
  {
    name: 'shadcn/ui',
    version: '—',
    source: 'frontend',
    description: '基于 Radix + Tailwind 的可复用组件集合',
    license: 'MIT',
    repository: 'https://github.com/shadcn-ui/ui',
    homepage: 'https://ui.shadcn.com',
  },
  {
    name: 'lucide-react',
    version: '^1.28.0',
    source: 'frontend',
    description: 'Lucide 图标库的 React 封装',
    license: 'ISC',
    repository: 'https://github.com/lucide-icons/lucide',
    homepage: 'https://lucide.dev',
  },
  {
    name: 'monaco-editor',
    version: '^0.56.0',
    source: 'frontend',
    description: 'VS Code 同款代码编辑器',
    license: 'MIT',
    repository: 'https://github.com/microsoft/monaco-editor',
    homepage: 'https://microsoft.github.io/monaco-editor',
  },
  {
    name: '@monaco-editor/react',
    version: '^4.7.0',
    source: 'frontend',
    description: 'Monaco 编辑器的 React 封装',
    license: 'MIT',
    repository: 'https://github.com/suren-atoyan/monaco-react',
  },
  {
    name: 'sonner',
    version: '^2.0.7',
    source: 'frontend',
    description: 'Toast 通知组件',
    license: 'MIT',
    repository: 'https://github.com/emilkowalski/sonner',
    homepage: 'https://sonner.emilkowal.ski',
  },
  {
    name: 'cmdk',
    version: '^1.1.1',
    source: 'frontend',
    description: '命令面板组件',
    license: 'MIT',
    repository: 'https://github.com/pacocoursey/cmdk',
  },
  {
    name: 'class-variance-authority',
    version: '^0.7.1',
    source: 'frontend',
    description: '类型安全的 className 变体管理',
    license: 'Apache-2.0',
    repository: 'https://github.com/joe-bell/cva',
  },
  {
    name: 'clsx',
    version: '^2.1.1',
    source: 'frontend',
    description: '条件 className 构造工具',
    license: 'MIT',
    repository: 'https://github.com/lukeed/clsx',
  },
  {
    name: 'tailwind-merge',
    version: '^3.6.0',
    source: 'frontend',
    description: '智能合并 Tailwind 类名',
    license: 'MIT',
    repository: 'https://github.com/dcastil/tailwind-merge',
  },
  {
    name: 'sql-formatter',
    version: '^15.8.2',
    source: 'frontend',
    description: 'SQL 语句格式化',
    license: 'MIT',
    repository: 'https://github.com/sql-formatter-org/sql-formatter',
  },
  {
    name: 'date-fns',
    version: '^4.4.0',
    source: 'frontend',
    description: '现代日期工具库',
    license: 'MIT',
    repository: 'https://github.com/date-fns/date-fns',
    homepage: 'https://date-fns.org',
  },
  {
    name: 'react-resizable-panels',
    version: '^4.12.2',
    source: 'frontend',
    description: '可调整大小的面板',
    license: 'MIT',
    repository: 'https://github.com/bvaughn/react-resizable-panels',
  },
  {
    name: '@tanstack/react-virtual',
    version: '^3.14.9',
    source: 'frontend',
    description: '虚拟列表渲染',
    license: 'MIT',
    repository: 'https://github.com/TanStack/virtual',
    homepage: 'https://tanstack.com/virtual',
  },
  {
    name: 'yaml',
    version: '^2.9.0',
    source: 'frontend',
    description: 'YAML 解析与序列化',
    license: 'ISC',
    repository: 'https://github.com/eemeli/yaml',
  },
  {
    name: 'vite',
    version: '^8.1.5',
    source: 'frontend',
    description: '下一代前端构建工具',
    license: 'MIT',
    repository: 'https://github.com/vitejs/vite',
    homepage: 'https://vitejs.dev',
  },
  {
    name: 'typescript',
    version: '^6.0.3',
    source: 'frontend',
    description: 'JavaScript 的超集，添加静态类型',
    license: 'Apache-2.0',
    repository: 'https://github.com/microsoft/TypeScript',
    homepage: 'https://www.typescriptlang.org',
  },
  {
    name: 'vitest',
    version: '^4.1.10',
    source: 'frontend',
    description: '单元测试框架',
    license: 'MIT',
    repository: 'https://github.com/vitest-dev/vitest',
    homepage: 'https://vitest.dev',
  },

  // ---------- Rust crates 依赖 ----------
  {
    name: 'tauri',
    version: '2',
    source: 'rust',
    description: '构建跨平台桌面应用的 Rust 框架',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/tauri',
    homepage: 'https://tauri.app',
  },
  {
    name: 'tauri-plugin-updater',
    version: '2',
    source: 'rust',
    description: '应用自动更新插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-dialog',
    version: '2',
    source: 'rust',
    description: '原生对话框插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-shell',
    version: '2',
    source: 'rust',
    description: 'Shell 命令调用插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-clipboard-manager',
    version: '2',
    source: 'rust',
    description: '剪贴板访问插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-window-state',
    version: '2',
    source: 'rust',
    description: '窗口状态记忆插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tauri-plugin-single-instance',
    version: '2',
    source: 'rust',
    description: '单实例运行插件',
    license: 'Apache-2.0 / MIT',
    repository: 'https://github.com/tauri-apps/plugins-workspace',
  },
  {
    name: 'tokio',
    version: '1.40',
    source: 'rust',
    description: '异步运行时与并发工具库',
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tokio',
    homepage: 'https://tokio.rs',
  },
  {
    name: 'serde',
    version: '1',
    source: 'rust',
    description: '序列化/反序列化框架',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/serde-rs/serde',
    homepage: 'https://serde.rs',
  },
  {
    name: 'serde_json',
    version: '1',
    source: 'rust',
    description: 'JSON 序列化实现',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/serde-rs/json',
  },
  {
    name: 'thiserror',
    version: '1',
    source: 'rust',
    description: '派生错误类型的库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/thiserror',
  },
  {
    name: 'anyhow',
    version: '1',
    source: 'rust',
    description: '灵活的错误处理库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/anyhow',
  },
  {
    name: 'uuid',
    version: '1',
    source: 'rust',
    description: 'UUID 生成与解析',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/uuid-rs/uuid',
  },
  {
    name: 'futures',
    version: '0.3',
    source: 'rust',
    description: '异步编程抽象库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/rust-lang/futures-rs',
  },
  {
    name: 'async-trait',
    version: '0.1',
    source: 'rust',
    description: '异步 trait 方法支持',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dtolnay/async-trait',
  },
  {
    name: 'tokio-util',
    version: '0.7',
    source: 'rust',
    description: 'Tokio 工具集',
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tokio',
  },
  {
    name: 'chrono',
    version: '0.4',
    source: 'rust',
    description: '日期时间库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/chronotope/chrono',
  },
  {
    name: 'chrono-tz',
    version: '0.9',
    source: 'rust',
    description: '时区数据',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/chronotope/chrono-tz',
  },
  {
    name: 'regex',
    version: '1',
    source: 'rust',
    description: '正则表达式库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/rust-lang/regex',
  },
  {
    name: 'sha2',
    version: '0.10',
    source: 'rust',
    description: 'SHA-2 哈希算法实现',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'sha3',
    version: '0.10',
    source: 'rust',
    description: 'SHA-3 哈希算法实现',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'blake3',
    version: '1.5',
    source: 'rust',
    description: 'BLAKE3 哈希算法实现',
    license: 'CC0-1.0 / Apache-2.0',
    repository: 'https://github.com/BLAKE3-team/BLAKE3',
  },
  {
    name: 'md-5',
    version: '0.10',
    source: 'rust',
    description: 'MD5 哈希算法实现',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/RustCrypto/hashes',
  },
  {
    name: 'jsonwebtoken',
    version: '9',
    source: 'rust',
    description: 'JWT 编解码库',
    license: 'MIT',
    repository: 'https://github.com/Keats/jsonwebtoken',
  },
  {
    name: 'base64',
    version: '0.22',
    source: 'rust',
    description: 'Base64 编码解码',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/marshallpierce/rust-base64',
  },
  {
    name: 'url',
    version: '2.5',
    source: 'rust',
    description: 'URL 解析库',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/servo/rust-url',
  },
  {
    name: 'percent-encoding',
    version: '2.3',
    source: 'rust',
    description: 'URL 百分号编码',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/servo/rust-url',
  },
  {
    name: 'window-vibrancy',
    version: '0.8',
    source: 'rust',
    description: 'Windows 云母 / macOS 亚克力窗口材质',
    license: 'MIT',
    repository: 'https://github.com/tauri-apps/window-vibrancy',
  },
  {
    name: 'windows',
    version: '0.61',
    source: 'rust',
    description: 'Windows API 绑定（DirectWrite 字体枚举等）',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/microsoft/windows-rs',
  },
  {
    name: 'directories',
    version: '5.0',
    source: 'rust',
    description: '系统数据目录查询',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/dirs-dev/directories-rs',
  },
  {
    name: 'parking_lot',
    version: '0.12',
    source: 'rust',
    description: '高性能同步原语',
    license: 'MIT / Apache-2.0',
    repository: 'https://github.com/Amanieu/parking_lot',
  },
  {
    name: 'tracing',
    version: '0.1',
    source: 'rust',
    description: '结构化日志库',
    license: 'MIT',
    repository: 'https://github.com/tokio-rs/tracing',
  },
];

/** 开源组件列表(按 source 分组渲染) */
function ComponentList({ list }: { list: OpenSourceComponent[] }): JSX.Element {
  return (
    <Card>
      <CardContent className="divide-y divide-border pt-0">
        {list.map((comp) => (
          <div key={`${comp.source}-${comp.name}`} className="flex flex-col gap-1 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm font-medium text-foreground">
                {comp.name}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  v{comp.version}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {comp.license}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{comp.description}</p>
            {comp.repository && (
              <a
                href={comp.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {comp.repository}
              </a>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** 关于区块:应用信息 + 开源许可 + 开源组件 */
export function AboutSection(): JSX.Element {
  const frontend = COMPONENTS.filter((c) => c.source === 'frontend');
  const rust = COMPONENTS.filter((c) => c.source === 'rust');

  return (
    <div className="flex flex-col gap-6">
      {/* ── 应用信息 ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-md border p-4">
          <Logo className="size-10 shrink-0 rounded-lg bg-muted/50 p-1.5" />
          <div className="min-w-0">
            <p className="text-base font-semibold">Qraft</p>
            <p className="text-xs text-muted-foreground">本地优先的开发者工具箱</p>
          </div>
          <Badge variant="secondary" className="ml-auto shrink-0">
            v{APP_VERSION}
          </Badge>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            {ABOUT_INFO_ITEMS.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm font-medium text-foreground">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── 开源许可 ── */}
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-semibold">开源许可</h3>
          <p className="text-xs text-muted-foreground">本应用使用的部分开源软件及其许可证</p>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            {LICENSES.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  {item.homepage && (
                    <a
                      href={item.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {item.homepage}
                    </a>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {item.license}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── 开源组件 ── */}
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-semibold">开源组件</h3>
          <p className="text-xs text-muted-foreground">
            本应用使用的全部开源组件清单（前端 {frontend.length} + Rust {rust.length} 个，共{' '}
            {COMPONENTS.length} 个）
          </p>
        </div>
        <Tabs defaultValue="frontend" className="flex flex-col gap-2">
          <TabsList>
            <TabsTrigger value="frontend">前端依赖（npm）</TabsTrigger>
            <TabsTrigger value="rust">Rust 依赖（crates.io）</TabsTrigger>
          </TabsList>
          <TabsContent value="frontend">
            <ComponentList list={frontend} />
          </TabsContent>
          <TabsContent value="rust">
            <ComponentList list={rust} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ============================================================
// 主题预览卡片
// ============================================================

interface ThemeCardProps {
  label: string;
  preview: [string, string];
  selected: boolean;
  onSelect: () => void;
}

/** 主题预览卡片:双色 accent + background 预览条 + 名称 */
function ThemeCard({ label, preview, selected, onSelect }: ThemeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-2 rounded-md border p-3 text-left transition-colors',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-input hover:bg-accent/50',
      )}
    >
      <div className="flex h-12 gap-1 overflow-hidden rounded">
        <div className="flex-1" style={{ background: preview[0] }} />
        <div className="flex-1" style={{ background: preview[1] }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {selected && <Check className="size-4 text-primary" aria-hidden />}
      </div>
    </button>
  );
}

// ============================================================
// 主题区块
// ============================================================

export function ThemeSection() {
  // ── 主题选择(预设 + 自定义 + 跟随系统)──
  const [paletteId, setPaletteId] = useState<PaletteId>(() => getStoredPaletteId());
  const [customAccent, setCustomAccent] = useState<string>(
    () => getStoredCustomAccent() ?? '#4E8CFF',
  );

  const handleSelectPalette = (id: PaletteId) => {
    setPalette(id, id === 'custom' ? customAccent : undefined);
    setPaletteId(id);
  };

  const handleCustomAccentChange = (hex: string) => {
    setCustomAccent(hex);
    if (paletteId === 'custom') {
      setPalette('custom', hex);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-5 text-muted-foreground" />
          主题
        </CardTitle>
        <CardDescription>选择预设主题或自定义 accent 色,切换即时生效并自动缓存</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* 跟随系统 */}
          <ThemeCard
            label="跟随系统"
            preview={['oklch(0.16 0.01 264)', 'oklch(0.99 0.005 264)']}
            selected={paletteId === 'system'}
            onSelect={() => handleSelectPalette('system')}
          />
          {/* 5 套预设主题 */}
          {PRESET_PALETTES.map((p) => (
            <ThemeCard
              key={p.id}
              label={p.displayName}
              preview={[p.accent, p.background]}
              selected={paletteId === p.id}
              onSelect={() => handleSelectPalette(p.id as PaletteId)}
            />
          ))}
          {/* 自定义 */}
          <ThemeCard
            label="自定义"
            preview={[customAccent, 'oklch(0.16 0 0)']}
            selected={paletteId === 'custom'}
            onSelect={() => handleSelectPalette('custom')}
          />
        </div>

        {/* 自定义 accent 选择器(仅自定义模式显示)*/}
        {paletteId === 'custom' && (
          <div className="flex items-center gap-3 rounded-md border p-3">
            <input
              type="color"
              value={customAccent}
              onChange={(e) => handleCustomAccentChange(e.target.value)}
              className="size-10 cursor-pointer rounded-md border border-input bg-transparent p-1"
              aria-label="选择 accent 色"
            />
            <Input
              value={customAccent}
              onChange={(e) => handleCustomAccentChange(e.target.value)}
              className="w-32 font-mono"
              placeholder="#RRGGBB"
              aria-label="Hex 色值"
            />
            <p className="text-xs text-muted-foreground">实时预览,修改后自动持久化</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// 字体区块
// ============================================================

export function FontSection() {
  // ── UI 字体族 ──
  const [fontFamily, setFontFamily] = useState<string | null>(() => getStoredFontFamily());
  // ── 代码字体族(Mono) ──
  const [monoFontFamily, setMonoFontFamily] = useState<string | null>(() =>
    getStoredMonoFontFamily(),
  );

  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listSystemFonts();
      if (!cancelled) {
        setFonts(list);
        setFontsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFontFamilyChange = (family: string | null) => {
    setFontFamily(family);
    applyFontFamily(family);
    if (family) {
      localStorage.setItem(FONT_FAMILY_STORAGE_KEY, family);
    } else {
      localStorage.removeItem(FONT_FAMILY_STORAGE_KEY);
    }
  };

  const handleMonoFontFamilyChange = (family: string | null) => {
    setMonoFontFamily(family);
    applyMonoFontFamily(family);
    if (family) {
      localStorage.setItem(MONO_FONT_FAMILY_STORAGE_KEY, family);
    } else {
      localStorage.removeItem(MONO_FONT_FAMILY_STORAGE_KEY);
    }
  };

  // ── 字号级别 ──
  const [fontSizeLevel, setFontSizeLevel] = useState<number>(() => getStoredFontSizeLevel());

  const handleFontSizeChange = (level: number) => {
    setFontSizeLevel(level);
    applyFontSizeLevel(level);
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(level));
  };

  // ── 字重级别 ──
  const [fontWeightLevel, setFontWeightLevel] = useState<number>(() => getStoredFontWeightLevel());

  const handleFontWeightChange = (level: number) => {
    setFontWeightLevel(level);
    applyFontWeightLevel(level);
    localStorage.setItem(FONT_WEIGHT_STORAGE_KEY, String(level));
  };

  // 构造 UI 字体 / 代码字体下拉选项
  // - 系统字体列表只取 family 字段(字符串数组)
  // - UI 字体：展示全部已安装字体
  // - 代码字体：仅展示 Mono/Code/Console 等关键字命中的字体，并按分数降序
  const installedFamilyNames = useMemo(() => fonts.map((f) => f.family), [fonts]);
  const uiFontOptions: FontFamilyOption[] = useMemo(
    () => buildFontFamilyOptions(installedFamilyNames, 'ui', '默认 UI 字体'),
    [installedFamilyNames],
  );
  const monoFontOptions: FontFamilyOption[] = useMemo(
    () => buildFontFamilyOptions(installedFamilyNames, 'mono', '默认代码字体'),
    [installedFamilyNames],
  );

  // 预览文本的 inline style：UI 字体族 + 字重；代码字体预览单独一块
  const previewStyle: CSSProperties = {
    fontFamily: fontFamily ? `'${fontFamily}', system-ui, sans-serif` : undefined,
    fontWeight: FONT_WEIGHT_LEVELS[fontWeightLevel].weight,
  };
  const monoPreviewStyle: CSSProperties = {
    fontFamily: monoFontFamily
      ? `'${monoFontFamily}', 'JetBrains Mono', ui-monospace, monospace`
      : undefined,
    fontWeight: FONT_WEIGHT_LEVELS[fontWeightLevel].weight,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Type className="size-5 text-muted-foreground" />
          字体
        </CardTitle>
        <CardDescription>
          选择界面字体与代码字体，设置自动缓存。代码字体作用于 SQL 编辑器、AI 代码块、日志、DDL
          与数据表等宽内容。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 字体族：界面字体 + 代码字体 双选择器 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>界面字体</Label>
            {!fontsLoading && (
              <span className="text-xs text-muted-foreground">
                已读取系统 {fonts.length} 个字体族
              </span>
            )}
          </div>
          <FontPicker
            value={fontFamily}
            options={uiFontOptions}
            placeholder="默认 UI 字体"
            loading={fontsLoading}
            onChange={handleFontFamilyChange}
            aria-label="界面字体"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>代码字体</Label>
            <span className="text-xs text-muted-foreground">默认 JetBrains Mono</span>
          </div>
          <FontPicker
            value={monoFontFamily}
            options={monoFontOptions}
            placeholder="默认代码字体"
            loading={fontsLoading}
            onChange={handleMonoFontFamilyChange}
            aria-label="代码字体"
          />
          <p className="text-xs text-muted-foreground">
            优先展示名称接近 Mono / Code / Console 的系统已安装字体。
          </p>
        </div>

        {/* 字号级别按钮组 */}
        <div className="flex flex-col gap-2">
          <Label>字号</Label>
          <div className="flex gap-2">
            {FONT_SIZE_LEVELS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleFontSizeChange(idx)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                  fontSizeLevel === idx
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input text-muted-foreground hover:bg-accent/50',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 字重级别按钮组 */}
        <div className="flex flex-col gap-2">
          <Label>字重</Label>
          <div className="flex gap-2">
            {FONT_WEIGHT_LEVELS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleFontWeightChange(idx)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                  fontWeightLevel === idx
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input text-muted-foreground hover:bg-accent/50',
                )}
                style={{ fontWeight: item.weight }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 字体预览：UI 字体 */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">界面字体预览</p>
          <div style={previewStyle} className="flex flex-col gap-1">
            <p className="text-lg">The quick brown fox jumps over the lazy dog</p>
            <p className="text-lg">敏捷的棕色狐狸跳过了懒狗的背</p>
            <p className="text-sm text-muted-foreground">0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
          </div>
        </div>

        {/* 字体预览：代码字体(Mono) */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">代码字体预览</p>
          <div style={monoPreviewStyle} className="flex flex-col gap-1 font-mono">
            <p className="text-sm">{'SELECT * FROM users WHERE id = 42;'}</p>
            <p className="text-sm">{'const greet = (name: string) => `Hello, ${name}!`;'}</p>
            <p className="text-sm text-muted-foreground">
              {'0123456789 abcdefghijklmnopqrstuvwxyz'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 通用设置区块:最大历史数 / JSON 缩进 / 确认清空。
 * 独立组件供设置面板与设置弹窗复用。
 */
export function GeneralSection(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);

  // mode: 'onChange' 让验证在输入时触发,便于即时反馈
  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalSchema),
    mode: 'onChange',
    defaultValues: {
      maxHistory: 100,
      jsonIndent: 2,
      confirmOnClear: true,
    },
  });

  // 配置加载后同步表单
  useEffect(() => {
    if (!config) return;
    form.reset({
      maxHistory: config.general.maxHistory,
      // jsonIndent 来自 toolPrefs.json_formatter.values.indent,缺省 2
      // 用可选链保护 toolPrefs 本身,防止旧配置缺少该字段时崩溃
      jsonIndent: (config.toolPrefs?.['json_formatter']?.values?.indent as number | undefined) ?? 2,
      confirmOnClear: config.general.confirmOnClear,
    });
  }, [config, form]);

  const onSubmit = async (values: GeneralFormValues) => {
    await setConfig('general.max_history', values.maxHistory);
    await setConfig('general.confirm_on_clear', values.confirmOnClear);
    await setConfig('toolPrefs.json_formatter.values.indent', values.jsonIndent);
    toast.success('设置已保存');
  };

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      aria-label="通用设置表单"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">通用</CardTitle>
          <CardDescription>历史记录与清空确认</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="maxHistory">最大历史数</Label>
            <Input
              id="maxHistory"
              type="number"
              {...form.register('maxHistory', { valueAsNumber: true })}
            />
            {errors.maxHistory && (
              <span className="text-xs text-destructive">必须为 0 或正整数</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="jsonIndent">JSON 默认缩进</Label>
            <Input
              id="jsonIndent"
              type="number"
              {...form.register('jsonIndent', { valueAsNumber: true })}
            />
          </div>

          <div className="flex items-center gap-2">
            <input id="confirmOnClear" type="checkbox" {...form.register('confirmOnClear')} />
            <Label htmlFor="confirmOnClear">清空前确认</Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit">保存</Button>
        <Button type="button" variant="outline" onClick={() => form.reset()}>
          重置
        </Button>
      </div>
    </form>
  );
}

/**
 * 快捷键捕获输入框。
 * 点击后进入「监听模式」,捕获用户下一次按键组合并自动写入 value;
 * 监听模式下单独按下 Esc 取消监听,Backspace/Delete 清空绑定。
 * 再次点击或点击外部区域可退出监听模式。
 */
function ShortcutInput({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  'aria-label'?: string;
}): JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 监听键盘:在捕获阶段拦截,先于全局快捷键生效,避免触发现有绑定
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key;
      // 仅按下修饰键时不捕获,等待主键
      if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return;
      if (key === 'Escape') {
        setCapturing(false);
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        onChange('');
        setCapturing(false);
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      if (e.metaKey) parts.push('Meta');
      const main = key.length === 1 ? key.toUpperCase() : key;
      parts.push(main);
      onChange(parts.join('+'));
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onChange]);

  // 监听外部点击:点击组件外部区域取消监听
  useEffect(() => {
    if (!capturing) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setCapturing(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [capturing]);

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setCapturing((c) => !c)}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-background px-3 text-left text-sm',
          'transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          capturing ? 'border-primary ring-2 ring-ring' : '',
        )}
      >
        {capturing ? (
          <span className="text-muted-foreground">请按下按键…</span>
        ) : value ? (
          <span className="font-mono">{value}</span>
        ) : (
          <span className="text-muted-foreground">未绑定</span>
        )}
      </button>
      {value && !capturing && (
        <button
          type="button"
          aria-label="清空快捷键"
          title="清空"
          onClick={() => onChange('')}
          className={cn(
            'absolute right-1 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground',
            'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * 快捷键区块:自定义各功能的快捷键绑定。
 * 独立组件供设置面板与设置弹窗复用。
 */
export function ShortcutSection(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const resetConfig = useConfigStore((s) => s.resetConfig);
  const [resetting, setResetting] = useState(false);

  const form = useForm<{ shortcuts: ShortcutBinding }>({
    resolver: zodResolver(shortcutSchema),
    mode: 'onChange',
    defaultValues: {
      shortcuts: {
        open_command_palette: 'Ctrl+K',
        toggle_sidebar: 'Ctrl+B',
        execute_tool: 'Ctrl+Enter',
        clear_input: 'Ctrl+L',
        copy_output: 'Ctrl+Shift+C',
        toggle_settings: 'Ctrl+,',
        switch_tool: 'Ctrl+P',
        open_history: 'Ctrl+H',
        search: 'Ctrl+F',
        close_panel: 'Esc',
        save_file: 'Ctrl+S',
        cycle_naming_case: 'Ctrl+Shift+U',
        toggle_case: 'Ctrl+Shift+L',
      },
    },
  });

  useEffect(() => {
    if (!config) return;
    form.reset({
      shortcuts: { ...(config.shortcuts ?? DEFAULT_USER_CONFIG.shortcuts) },
    });
  }, [config, form]);

  const onSubmit = async (values: { shortcuts: ShortcutBinding }) => {
    // 仅持久化有改动的字段,避免整批覆盖,也更稳健
    const dirty = form.formState.dirtyFields.shortcuts ?? {};
    const changedKeys = (Object.keys(dirty) as Array<keyof ShortcutBinding>).filter(
      (k) => dirty[k],
    );
    if (changedKeys.length === 0) {
      toast.info('没有需要保存的更改');
      return;
    }
    for (const k of changedKeys) {
      await setConfig(`shortcuts.${k}`, values.shortcuts[k]);
    }
    form.reset(values);
    toast.success('快捷键已保存');
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      aria-label="快捷键表单"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">快捷键</CardTitle>
          <CardDescription>自定义各功能的快捷键绑定</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {SHORTCUT_KEYS.map((s) => (
              <div key={s.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor={`sc-${s.key}`}>{s.label}</Label>
                  {s.pending && (
                    <span
                      className="rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground"
                      title="该功能的快捷键暂未生效"
                    >
                      暂未生效
                    </span>
                  )}
                </div>
                <ShortcutInput
                  id={`sc-${s.key}`}
                  aria-label={s.label}
                  value={form.watch(`shortcuts.${s.key}`)}
                  onChange={(next) =>
                    form.setValue(`shortcuts.${s.key}`, next, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit">保存快捷键</Button>
        <Button
          type="button"
          variant="outline"
          disabled={resetting}
          onClick={async () => {
            setResetting(true);
            try {
              // 先把本地表单恢复成默认值,避免等待异步事件期间 UI 出现空值
              form.reset({ shortcuts: { ...DEFAULT_USER_CONFIG.shortcuts } });
              const r = await resetConfig('shortcuts');
              if (r.ok) {
                toast.success('快捷键已恢复默认');
              } else {
                toast.error('恢复默认失败,请重试');
              }
            } catch {
              toast.error('恢复默认时出错,请重试');
            } finally {
              setResetting(false);
            }
          }}
        >
          {resetting ? '恢复中…' : '恢复默认'}
        </Button>
      </div>
    </form>
  );
}

/**
 * 文本编辑器区块：字符命名转换的启用项与循环顺序。
 */
export function EditorSection(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const naming = config?.editor?.namingConvention;
  const enabled = new Set(
    naming?.enabled?.length ? naming.enabled : DEFAULT_EDITOR_CONFIG.namingConvention.enabled,
  );
  const order = naming?.order?.length ? naming.order : DEFAULT_EDITOR_CONFIG.namingConvention.order;

  const toggleConvention = async (id: NamingConventionId) => {
    const nextEnabled = new Set(enabled);
    if (nextEnabled.has(id)) {
      nextEnabled.delete(id);
    } else {
      nextEnabled.add(id);
    }
    await setConfig('editor.namingConvention.enabled', Array.from(nextEnabled));
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    await setConfig('editor.namingConvention.order', next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" />
          文本编辑器
        </CardTitle>
        <CardDescription>字符命名转换的启用项与循环顺序</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Label className="text-sm font-medium">启用风格</Label>
          <div className="grid grid-cols-2 gap-3">
            {NAMING_CONVENTIONS.map((convention: { id: NamingConventionId; label: string }) => (
              <div key={convention.id} className="flex items-center gap-2">
                <Checkbox
                  id={`naming-${convention.id}`}
                  checked={enabled.has(convention.id)}
                  onChange={() => toggleConvention(convention.id)}
                  label={convention.label}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Label className="text-sm font-medium">循环顺序</Label>
          <div className="flex gap-4">
            <div className="flex-1 divide-y divide-border rounded-md border border-border bg-background">
              {order.map((id, index) => {
                const convention = NAMING_CONVENTIONS.find((c) => c.id === id);
                if (!convention) return null;
                return (
                  <div key={id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm">{convention.label}</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`上移 ${convention.label}`}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === order.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`下移 ${convention.label}`}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden w-24 flex-col justify-center gap-2 md:flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => move(0, -1)}
                disabled
              >
                UP
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => move(0, 1)} disabled>
                DOWN
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            在文本编辑器中选中字符后按「切换字符命名风格」快捷键，将按此顺序循环切换。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPanel(): JSX.Element {
  return (
    <div className="h-full bg-background-layer">
      <ScrollArea className="h-full">
        <div className="p-6 flex flex-col gap-6">
          <h2 className="text-lg font-semibold">设置</h2>

          {/* 主题区块:主题网格 + 自定义 accent */}
          <ThemeSection />

          {/* 字体区块:字体族 + 字号 + 字重 + 预览 */}
          <FontSection />

          {/* 通用设置表单:最大历史数 / JSON 缩进 / 确认清空 */}
          <GeneralSection />

          {/* 文本编辑器设置 */}
          <EditorSection />

          {/* 快捷键表单 */}
          <ShortcutSection />

          <Separator />

          <UpdateSection />

          <Separator />

          {/* 关于区块:应用信息 + 开源许可 + 开源组件 */}
          <AboutSection />
        </div>
      </ScrollArea>
    </div>
  );
}
