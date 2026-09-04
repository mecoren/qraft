import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, normalizeIpcError } from '@/lib/ipc';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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
import { useConfigStore } from '@/store/configStore';
import { useUiStore } from '@/store/uiStore';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { changeLocale } from '@/i18n';
import type { ShortcutBinding } from '@/types/config';
import {
  type PaletteId,
  getStoredPaletteId,
  getStoredCustomAccent,
  setPalette,
} from '@/lib/color-theme';
import { PRESET_PALETTES, parseHexColor } from '@/lib/design-tokens';
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
  /** i18n 键名(MODE_LABEL 模式),组件层翻译 */
  labelKey: string;
  /** 标记为暂未生效(该功能尚未实现对应快捷键处理) */
  pending?: boolean;
}> = [
  { key: 'open_command_palette', labelKey: 'settings.sc_open_command_palette' },
  { key: 'toggle_sidebar', labelKey: 'settings.sc_toggle_sidebar' },
  { key: 'execute_tool', labelKey: 'settings.sc_execute_tool' },
  { key: 'clear_input', labelKey: 'settings.sc_clear_input' },
  { key: 'copy_output', labelKey: 'settings.sc_copy_output' },
  { key: 'toggle_settings', labelKey: 'settings.sc_toggle_settings' },
  { key: 'switch_tool', labelKey: 'settings.sc_switch_tool' },
  { key: 'open_history', labelKey: 'settings.sc_open_history' },
  { key: 'search', labelKey: 'settings.sc_search', pending: true },
  { key: 'close_panel', labelKey: 'settings.sc_close_panel' },
  { key: 'save_file', labelKey: 'settings.sc_save_file' },
  { key: 'global_search', labelKey: 'settings.sc_global_search' },
  { key: 'cycle_naming_case', labelKey: 'settings.sc_cycle_naming_case' },
  { key: 'toggle_case', labelKey: 'settings.sc_toggle_case' },
];

const generalSchema = z.object({
  maxHistory: z.number().int().min(0).max(10000),
  jsonIndent: z.number().int().min(0).max(8),
  confirmOnClear: z.boolean(),
  language: z.enum(['zh-CN', 'en-US']),
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

  async function handleCheckUpdate() {
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
      if (!resp.available) {
        toast.success(t('settings.up_to_date_toast', { version: resp.currentVersion }));
      } else if (isManual) {
        // 系统安装版:提示需前往 Releases 手动下载整包(不同安装方式)
        toast.info(t('settings.manual_install_toast', { mode: resp.installModeLabel ?? '' }));
      }
    } catch (err) {
      // Tauri 命令 Err(AppError) 时以序列化错误对象 reject,需归一化取真实消息
      toast.error(t('settings.check_failed_toast', { message: normalizeIpcError(err).message }));
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

  return (
    <div className="flex flex-col gap-4">
      <div data-search-anchor="settings:update:check">
        <h3 className="text-sm font-semibold">{t('settings.update_heading')}</h3>
        <p className="text-xs text-muted-foreground">{t('settings.update_desc')}</p>
      </div>

      {!updateInfo?.available && (
        <Button onClick={handleCheckUpdate} disabled={checking || installing}>
          {checking ? t('settings.checking') : t('settings.check_update')}
        </Button>
      )}

      {updateInfo?.available && (
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
            <Button onClick={handleInstallUpdate} disabled={installing}>
              {manualInstall
                ? t('settings.go_download')
                : installing
                  ? t('settings.downloading', {
                      progress: progress !== null ? ` ${progress}%` : '...',
                    })
                  : t('settings.install_now')}
            </Button>
            <Button variant="outline" onClick={handleOpenReleasePage} disabled={installing}>
              {t('settings.open_releases')}
            </Button>
            <Button variant="ghost" onClick={() => setUpdateInfo(null)} disabled={installing}>
              {t('settings.later')}
            </Button>
          </div>
        </div>
      )}
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
  /** 全局搜索锚点,用于跳转定位高亮 */
  searchAnchor?: string;
}

/** 主题预览卡片:双色 accent + background 预览条 + 名称 */
function ThemeCard({ label, preview, selected, onSelect, searchAnchor }: ThemeCardProps) {
  return (
    <button
      type="button"
      data-search-anchor={searchAnchor}
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
  const { t } = useTranslation();
  // ── 主题选择(预设 + 自定义 + 跟随系统)──
  const [paletteId, setPaletteId] = useState<PaletteId>(() => getStoredPaletteId());
  const [customAccent, setCustomAccent] = useState<string>(
    () => getStoredCustomAccent() ?? '#4E8CFF',
  );
  const [accentInvalid, setAccentInvalid] = useState(false);

  const handleSelectPalette = (id: PaletteId) => {
    setPalette(id, id === 'custom' ? customAccent : undefined);
    setPaletteId(id);
  };

  const handleCustomAccentChange = (hex: string) => {
    setCustomAccent(hex);
    // HEX 手输校验:type=color 拾取器恒合法,仅手输可能产生非法中间态;
    // 非法输入不落库不应用,避免半输入状态污染主题
    const valid = parseHexColor(hex) !== null;
    setAccentInvalid(!valid);
    if (valid && paletteId === 'custom') {
      setPalette('custom', hex);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-5 text-muted-foreground" />
          {t('settings.theme_title')}
        </CardTitle>
        <CardDescription>{t('settings.theme_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          data-search-anchor="settings:theme:presets"
        >
          {/* 跟随系统 */}
          <ThemeCard
            label={t('settings.theme_system')}
            preview={['oklch(0.16 0.01 264)', 'oklch(0.99 0.005 264)']}
            selected={paletteId === 'system'}
            onSelect={() => handleSelectPalette('system')}
            searchAnchor="settings:theme:system"
          />
          {/* 5 套预设主题 */}
          {PRESET_PALETTES.map((p) => (
            <ThemeCard
              key={p.id}
              label={t(p.displayNameKey)}
              preview={[p.accent, p.background]}
              selected={paletteId === p.id}
              onSelect={() => handleSelectPalette(p.id as PaletteId)}
            />
          ))}
          {/* 自定义 */}
          <ThemeCard
            label={t('settings.theme_custom')}
            preview={[customAccent, 'oklch(0.16 0 0)']}
            selected={paletteId === 'custom'}
            onSelect={() => handleSelectPalette('custom')}
          />
        </div>

        {/* 自定义 accent 选择器(仅自定义模式显示)*/}
        {paletteId === 'custom' && (
          <div
            className="flex items-center gap-3 rounded-md border p-3"
            data-search-anchor="settings:theme:custom"
          >
            <input
              type="color"
              value={customAccent}
              onChange={(e) => handleCustomAccentChange(e.target.value)}
              className="size-10 cursor-pointer rounded-md border border-input bg-transparent p-1"
              aria-label={t('settings.accent_picker_aria')}
            />
            <Input
              value={customAccent}
              onChange={(e) => handleCustomAccentChange(e.target.value)}
              className="w-32"
              placeholder="#RRGGBB"
              aria-label={t('settings.accent_hex_aria')}
              aria-invalid={accentInvalid}
            />
            {accentInvalid ? (
              <p className="text-xs text-destructive" role="alert">
                {t('settings.accent_invalid')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('settings.accent_hint')}</p>
            )}
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
  const { t } = useTranslation();
  // ── UI 字体族 ──
  const [fontFamily, setFontFamily] = useState<string | null>(() => getStoredFontFamily());
  // ── 代码字体族(Mono) ──
  const [monoFontFamily, setMonoFontFamily] = useState<string | null>(() =>
    getStoredMonoFontFamily(),
  );

  /**
   * 系统字体懒加载:打开设置面板时不再枚举全部系统字体(数百上千个
   * DirectWrite 枚举 + 每项字体预览的排版开销会造成首次打开卡顿),
   * 而是等用户首次展开任一字体下拉框时才触发一次,结果全会话复用。
   */
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [fontsLoading, setFontsLoading] = useState(false);
  const fontsLoadedRef = useRef(false);
  const ensureFontsLoaded = useCallback(() => {
    if (fontsLoadedRef.current) return;
    fontsLoadedRef.current = true;
    setFontsLoading(true);
    void (async () => {
      const list = await listSystemFonts();
      setFonts(list);
      setFontsLoading(false);
    })();
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
    () => buildFontFamilyOptions(installedFamilyNames, 'ui', t('settings.font_ui_default')),
    [installedFamilyNames, t],
  );
  const monoFontOptions: FontFamilyOption[] = useMemo(
    () => buildFontFamilyOptions(installedFamilyNames, 'mono', t('settings.font_mono_default')),
    [installedFamilyNames, t],
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
          {t('settings.font_title')}
        </CardTitle>
        <CardDescription>{t('settings.font_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 字体族：界面字体 + 代码字体 双选择器 */}
        <div className="flex flex-col gap-2" data-search-anchor="settings:font:ui">
          <div className="flex items-center justify-between">
            <Label>{t('settings.font_ui_label')}</Label>
            {!fontsLoading && (
              <span className="text-xs text-muted-foreground">
                {t('settings.font_count', { count: fonts.length })}
              </span>
            )}
          </div>
          <FontPicker
            value={fontFamily}
            options={uiFontOptions}
            placeholder={t('settings.font_ui_default')}
            loading={fontsLoading}
            onOpen={ensureFontsLoaded}
            onChange={handleFontFamilyChange}
            aria-label={t('settings.font_ui_label')}
          />
        </div>

        <div className="flex flex-col gap-2" data-search-anchor="settings:font:mono">
          <div className="flex items-center justify-between">
            <Label>{t('settings.font_mono_label')}</Label>
            <span className="text-xs text-muted-foreground">{t('settings.font_mono_note')}</span>
          </div>
          <FontPicker
            value={monoFontFamily}
            options={monoFontOptions}
            placeholder={t('settings.font_mono_default')}
            loading={fontsLoading}
            onOpen={ensureFontsLoaded}
            onChange={handleMonoFontFamilyChange}
            aria-label={t('settings.font_mono_label')}
          />
          <p className="text-xs text-muted-foreground">{t('settings.font_mono_hint')}</p>
        </div>

        {/* 字号级别按钮组 */}
        <div className="flex flex-col gap-2" data-search-anchor="settings:font:size">
          <Label>{t('settings.font_size_label')}</Label>
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
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 字重级别按钮组 */}
        <div className="flex flex-col gap-2" data-search-anchor="settings:font:weight">
          <Label>{t('settings.font_weight_label')}</Label>
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
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 字体预览：UI 字体 */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">{t('settings.font_preview_ui')}</p>
          <div style={previewStyle} className="flex flex-col gap-1">
            <p className="text-lg">The quick brown fox jumps over the lazy dog</p>
            <p className="text-lg">敏捷的棕色狐狸跳过了懒狗的背</p>
            <p className="text-sm text-muted-foreground">0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
          </div>
        </div>

        {/* 字体预览：代码字体(Mono) */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">{t('settings.font_preview_mono')}</p>
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
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  // Smart Detection 开关走 uiStore(会话偏好),不经 Rust 配置表单
  const smartDetectionEnabled = useUiStore((s) => s.smartDetectionEnabled);
  const toggleSmartDetection = useUiStore((s) => s.toggleSmartDetection);

  // mode: 'onChange' 让验证在输入时触发,便于即时反馈
  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalSchema),
    mode: 'onChange',
    defaultValues: {
      maxHistory: 100,
      jsonIndent: 2,
      confirmOnClear: true,
      language: 'zh-CN',
    },
  });

  // 语言下拉的受控显示值:用户选择后的覆盖态,未选择时回退 config 存储值。
  // 不用 form.watch 镜像(避免 React Compiler 跳过编译),也不在 effect 里同步 state
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const configLanguage = config?.general.language === 'en-US' ? 'en-US' : 'zh-CN';
  const languageValue = languageOverride ?? configLanguage;

  // 配置加载后同步表单
  useEffect(() => {
    if (!config) return;
    const language = configLanguage;
    form.reset({
      maxHistory: config.general.maxHistory,
      // jsonIndent 来自 toolPrefs.json_formatter.values.indent,缺省 2
      // 用可选链保护 toolPrefs 本身,防止旧配置缺少该字段时崩溃
      jsonIndent: (config.toolPrefs?.['json_formatter']?.values?.indent as number | undefined) ?? 2,
      confirmOnClear: config.general.confirmOnClear,
      language,
    });
  }, [config, form, configLanguage]);

  const onSubmit = async (values: GeneralFormValues) => {
    await setConfig('general.max_history', values.maxHistory);
    await setConfig('general.confirm_on_clear', values.confirmOnClear);
    await setConfig('general.language', values.language);
    await setConfig('toolPrefs.json_formatter.values.indent', values.jsonIndent);
    toast.success(t('settings.saved_toast'));
  };

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      aria-label={t('settings.general_form_aria')}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.general_title')}</CardTitle>
          <CardDescription>{t('settings.general_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2" data-search-anchor="settings:general:max_history">
            <Label htmlFor="maxHistory">{t('settings.max_history')}</Label>
            <Input
              id="maxHistory"
              type="number"
              {...form.register('maxHistory', { valueAsNumber: true })}
            />
            {errors.maxHistory && (
              <span className="text-xs text-destructive">{t('settings.max_history_error')}</span>
            )}
          </div>

          <div className="flex flex-col gap-2" data-search-anchor="settings:general:json_indent">
            <Label htmlFor="jsonIndent">{t('settings.json_indent')}</Label>
            <Input
              id="jsonIndent"
              type="number"
              {...form.register('jsonIndent', { valueAsNumber: true })}
            />
          </div>

          <div
            className="flex items-center gap-2"
            data-search-anchor="settings:general:confirm_clear"
          >
            <input id="confirmOnClear" type="checkbox" {...form.register('confirmOnClear')} />
            <Label htmlFor="confirmOnClear">{t('settings.confirm_clear')}</Label>
          </div>

          <div className="flex flex-col gap-2" data-search-anchor="settings:general:language">
            <Label htmlFor="language">{t('settings.language_label')}</Label>
            {/* shadcn Select:受控接 RHF(watch/setValue);onChange 即时预览切 locale,
                持久化仍走表单统一保存 */}
            <Select
              value={languageValue}
              onValueChange={(v) => {
                if (v === 'en-US' || v === 'zh-CN') {
                  setLanguageOverride(v);
                  form.setValue('language', v, { shouldValidate: true, shouldDirty: true });
                  changeLocale(v);
                }
              }}
            >
              <SelectTrigger id="language" className="h-9 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2"
            data-search-anchor="settings:general:smart_detect"
          >
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="smartDetect">{t('settings.smart_detect')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.smart_detect_hint')}</p>
            </div>
            <Switch
              id="smartDetect"
              checked={smartDetectionEnabled}
              onCheckedChange={toggleSmartDetection}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit">{t('settings.save')}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset();
            setLanguageOverride(null);
          }}
        >
          {t('settings.reset')}
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
  const { t } = useTranslation();
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
          <span className="text-muted-foreground">{t('settings.shortcut_capture')}</span>
        ) : value ? (
          <span className="font-mono">{value}</span>
        ) : (
          <span className="text-muted-foreground">{t('settings.shortcut_none')}</span>
        )}
      </button>
      {value && !capturing && (
        <button
          type="button"
          aria-label={t('settings.shortcut_clear_aria')}
          title={t('settings.shortcut_clear_title')}
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
  const { t } = useTranslation();
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
        global_search: 'Ctrl+Shift+F',
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
      toast.info(t('settings.no_changes_toast'));
      return;
    }
    for (const k of changedKeys) {
      await setConfig(`shortcuts.${k}`, values.shortcuts[k]);
    }
    form.reset(values);
    toast.success(t('settings.shortcuts_saved_toast'));
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      aria-label={t('settings.shortcut_form_aria')}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.shortcut_title')}</CardTitle>
          <CardDescription>{t('settings.shortcut_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {SHORTCUT_KEYS.map((s) => {
              const label = t(s.labelKey);
              return (
                <div
                  key={s.key}
                  className="flex flex-col gap-1"
                  data-search-anchor={`settings:shortcuts:${s.key}`}
                >
                  <div className="flex items-center gap-1">
                    <Label htmlFor={`sc-${s.key}`}>{label}</Label>
                    {s.pending && (
                      <span
                        className="rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground"
                        title={t('settings.pending_title')}
                      >
                        {t('settings.pending_badge')}
                      </span>
                    )}
                  </div>
                  <ShortcutInput
                    id={`sc-${s.key}`}
                    aria-label={label}
                    value={form.watch(`shortcuts.${s.key}`)}
                    onChange={(next) =>
                      form.setValue(`shortcuts.${s.key}`, next, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit">{t('settings.save_shortcuts')}</Button>
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
                toast.success(t('settings.restored_toast'));
              } else {
                toast.error(t('settings.restore_failed_toast'));
              }
            } catch {
              toast.error(t('settings.restore_error_toast'));
            } finally {
              setResetting(false);
            }
          }}
        >
          {resetting ? t('settings.restoring') : t('settings.restore_defaults')}
        </Button>
      </div>
    </form>
  );
}

/**
 * 文本编辑器区块：字符命名转换的启用项与循环顺序。
 */
export function EditorSection(): JSX.Element {
  const { t } = useTranslation();
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
          {t('settings.editor_title')}
        </CardTitle>
        <CardDescription>{t('settings.editor_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3" data-search-anchor="settings:editor:enabled_styles">
          <Label className="text-sm font-medium">{t('settings.editor_enabled_label')}</Label>
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

        <div className="flex flex-col gap-3" data-search-anchor="settings:editor:cycle_order">
          <Label className="text-sm font-medium">{t('settings.editor_order_label')}</Label>
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
                        aria-label={t('settings.move_up_aria', { label: convention.label })}
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
                        aria-label={t('settings.move_down_aria', { label: convention.label })}
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
          <p className="text-xs text-muted-foreground">{t('settings.editor_cycle_hint')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPanel(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="h-full bg-background-layer">
      <ScrollArea className="h-full">
        <div className="p-6 flex flex-col gap-6">
          <h2 className="text-lg font-semibold">{t('settings.title')}</h2>

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

          {/* 更新区块 */}
          <UpdateSection />
        </div>
      </ScrollArea>
    </div>
  );
}
