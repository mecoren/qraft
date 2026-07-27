import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Palette, Type, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  FONT_FAMILY_STORAGE_KEY,
  FONT_SIZE_LEVELS,
  FONT_SIZE_STORAGE_KEY,
  FONT_WEIGHT_LEVELS,
  FONT_WEIGHT_STORAGE_KEY,
  getStoredFontFamily,
  getStoredFontSizeLevel,
  getStoredFontWeightLevel,
} from '@/lib/theme';
import { listSystemFonts, type FontInfo } from '@/lib/fonts';
import { cn } from '@/lib/utils';

const SHORTCUT_KEYS: Array<{ key: keyof ShortcutBinding; label: string }> = [
  { key: 'open_command_palette', label: '打开命令面板' },
  { key: 'toggle_sidebar', label: '切换侧栏' },
  { key: 'execute_tool', label: '执行工具' },
  { key: 'clear_input', label: '清空输入' },
  { key: 'copy_output', label: '复制输出' },
  { key: 'toggle_settings', label: '切换设置' },
  { key: 'switch_tool', label: '切换工具' },
  { key: 'open_history', label: '打开历史' },
  { key: 'search', label: '搜索' },
  { key: 'close_panel', label: '关闭面板' },
];

const schema = z.object({
  maxHistory: z.number().int().min(0).max(10000),
  jsonIndent: z.number().int().min(0).max(8),
  confirmOnClear: z.boolean(),
  shortcuts: z.object(
    SHORTCUT_KEYS.reduce(
      (acc, s) => ({ ...acc, [s.key]: z.string().min(1) }),
      {} as Record<keyof ShortcutBinding, z.ZodString>,
    ),
  ),
});

type FormValues = z.infer<typeof schema>;

// ===== CheckUpdateResponse:与 Rust shell::updater::CheckUpdateResponse 对齐 =====
// 字段使用 camelCase(Rust 端 #[serde(rename_all = "camelCase")])
interface CheckUpdateResponse {
  available: boolean;
  version: string | null;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

/**
 * 「检查更新」区块
 *
 * 自动更新是 Qraft 唯一允许的联网功能(见 PRD 13-security.md §3.1)。
 * 用户点击「检查更新」按钮调用 app_check_update IPC,
 * 有新版本时显示版本号与 release notes,确认后调用 app_install_update。
 */
export function UpdateSection(): JSX.Element {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<CheckUpdateResponse | null>(null);

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      const resp = await invoke<CheckUpdateResponse>('app_check_update');
      setUpdateInfo(resp);
      if (!resp.available) {
        toast.success(`已是最新版本 (v${resp.currentVersion})`);
      }
    } catch (err) {
      toast.error(`检查更新失败: ${String(err)}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleInstallUpdate() {
    setInstalling(true);
    try {
      await invoke('app_install_update');
      // 安装后会自动重启,代码不会执行到这里
    } catch (err) {
      toast.error(`安装更新失败: ${String(err)}`);
      setInstalling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">检查更新</h3>
        <p className="text-xs text-muted-foreground">
          自动更新是 Qraft 唯一允许的联网功能,可在下方手动检查。
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
          {updateInfo.notes && (
            <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">
              {updateInfo.notes}
            </pre>
          )}
          <div className="flex gap-2">
            <Button onClick={handleInstallUpdate} disabled={installing}>
              {installing ? '下载并安装中...' : '立即更新'}
            </Button>
            <Button variant="outline" onClick={() => setUpdateInfo(null)} disabled={installing}>
              稍后再说
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
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-input hover:bg-accent/50',
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

function ThemeSection() {
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

function FontSection() {
  // ── 字体族 ──
  const [fontFamily, setFontFamily] = useState<string | null>(() => getStoredFontFamily());
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

  const handleFontFamilyChange = (value: string) => {
    // "__system_default__" 代表系统默认(清除自定义字体)
    const family = value === '__system_default__' ? null : value;
    setFontFamily(family);
    applyFontFamily(family);
    if (family) {
      localStorage.setItem(FONT_FAMILY_STORAGE_KEY, family);
    } else {
      localStorage.removeItem(FONT_FAMILY_STORAGE_KEY);
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

  // 预览文本的 inline style:应用当前字体族 + 字重
  const previewStyle: CSSProperties = {
    fontFamily: fontFamily ? `'${fontFamily}', system-ui, sans-serif` : undefined,
    fontWeight: FONT_WEIGHT_LEVELS[fontWeightLevel].weight,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Type className="size-5 text-muted-foreground" />
          字体
        </CardTitle>
        <CardDescription>选择应用全局字体、字号与字重,设置自动缓存</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 字体族下拉选择 */}
        <div className="flex flex-col gap-2">
          <Label>字体族</Label>
          {fontsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              加载系统字体列表…
            </div>
          ) : (
            <Select
              value={fontFamily ?? '__system_default__'}
              onValueChange={handleFontFamilyChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__system_default__">系统默认</SelectItem>
                {fonts.map((font) => (
                  <SelectItem
                    key={font.family}
                    value={font.family}
                    style={{ fontFamily: `'${font.family}', sans-serif` }}
                  >
                    {font.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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

        {/* 字体预览 */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">预览</p>
          <div style={previewStyle} className="flex flex-col gap-1">
            <p className="text-lg">The quick brown fox jumps over the lazy dog</p>
            <p className="text-lg">敏捷的棕色狐狸跳过了懒狗的背</p>
            <p className="text-sm text-muted-foreground">
              0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPanel(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);

  // mode: 'onChange' 让验证在输入时触发,便于即时反馈
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      maxHistory: 100,
      jsonIndent: 2,
      confirmOnClear: true,
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
      },
    },
  });

  // 配置加载后同步表单
  useEffect(() => {
    if (!config) return;
    form.reset({
      maxHistory: config.general.maxHistory,
      // jsonIndent 来自 toolPrefs.json_formatter.values.indent,缺省 2
      jsonIndent: (config.toolPrefs['json_formatter']?.values?.indent as number | undefined) ?? 2,
      confirmOnClear: config.general.confirmOnClear,
      shortcuts: { ...config.shortcuts },
    });
  }, [config, form]);

  const onSubmit = async (values: FormValues) => {
    // 多次调用 setConfig 持久化每个变更字段
    // key 使用 snake_case 以匹配 Rust 后端字段命名约定
    await setConfig('general.max_history', values.maxHistory);
    await setConfig('general.confirm_on_clear', values.confirmOnClear);
    await setConfig('toolPrefs.json_formatter.values.indent', values.jsonIndent);
    for (const k of Object.keys(values.shortcuts) as Array<keyof ShortcutBinding>) {
      await setConfig(`shortcuts.${k}`, values.shortcuts[k]);
    }
    toast.success('设置已保存');
  };

  const errors = form.formState.errors;

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        <h2 className="text-lg font-semibold">设置</h2>

        {/* 主题区块:主题网格 + 自定义 accent */}
        <ThemeSection />

        {/* 字体区块:字体族 + 字号 + 字重 + 预览 */}
        <FontSection />

        {/* 通用设置表单:最大历史数 / JSON 缩进 / 确认清空 / 快捷键 */}
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
                <input
                  id="confirmOnClear"
                  type="checkbox"
                  {...form.register('confirmOnClear')}
                />
                <Label htmlFor="confirmOnClear">清空前确认</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">快捷键</CardTitle>
              <CardDescription>自定义各功能的快捷键绑定</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {SHORTCUT_KEYS.map((s) => (
                  <div key={s.key} className="flex flex-col gap-1">
                    <Label htmlFor={`sc-${s.key}`}>{s.label}</Label>
                    <Input id={`sc-${s.key}`} {...form.register(`shortcuts.${s.key}`)} />
                  </div>
                ))}
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

        <Separator />

        <UpdateSection />
      </div>
    </div>
  );
}
