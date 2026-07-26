import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState, type JSX } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
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
import { useConfigStore } from '@/store/configStore';
import type { ShortcutBinding } from '@/types/config';

const SHORTCUT_KEYS: Array<{ key: keyof ShortcutBinding; label: string }> = [
  { key: 'open_command_palette', label: 'Open Command Palette' },
  { key: 'toggle_sidebar', label: 'Toggle Sidebar' },
  { key: 'execute_tool', label: 'Execute Tool' },
  { key: 'clear_input', label: 'Clear Input' },
  { key: 'copy_output', label: 'Copy Output' },
  { key: 'toggle_settings', label: 'Toggle Settings' },
  { key: 'switch_tool', label: 'Switch Tool' },
  { key: 'open_history', label: 'Open History' },
  { key: 'search', label: 'Search' },
  { key: 'close_panel', label: 'Close Panel' },
];

const schema = z.object({
  themeMode: z.enum(['light', 'dark', 'system']),
  fontSize: z.number().int().min(10).max(24),
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

export function SettingsPanel(): JSX.Element {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);

  // mode: 'onChange' 让验证在输入时触发,便于即时反馈
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      themeMode: 'dark',
      fontSize: 14,
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
      themeMode: config.theme.mode,
      fontSize: config.general.fontSize,
      maxHistory: config.general.maxHistory,
      // jsonIndent 来自 toolPrefs.json_formatter.indent,缺省 2
      jsonIndent: (config.toolPrefs['json_formatter']?.values?.indent as number | undefined) ?? 2,
      confirmOnClear: config.general.confirmOnClear,
      shortcuts: { ...config.shortcuts },
    });
  }, [config, form]);

  const onSubmit = async (values: FormValues) => {
    // 多次调用 setConfig 持久化每个变更字段
    // key 使用 snake_case 以匹配 Rust 后端字段命名约定
    await setConfig('theme.mode', values.themeMode);
    await setConfig('general.font_size', values.fontSize);
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
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="max-w-xl mx-auto p-6 flex flex-col gap-6"
        aria-label="设置表单"
      >
        <h2 className="text-lg font-semibold">通用设置</h2>

        <div className="flex flex-col gap-2">
          <Label htmlFor="themeMode">Theme Mode</Label>
          <Select
            value={form.watch('themeMode')}
            onValueChange={(v) => form.setValue('themeMode', v as FormValues['themeMode'])}
          >
            <SelectTrigger id="themeMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark (MVP)</SelectItem>
              <SelectItem value="light">Light (待 v1.0)</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fontSize">Font Size</Label>
          <Input
            id="fontSize"
            type="number"
            {...form.register('fontSize', { valueAsNumber: true })}
          />
          {errors.fontSize && (
            <span className="text-xs text-destructive">{errors.fontSize.message}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="maxHistory">Max History</Label>
          <Input
            id="maxHistory"
            type="number"
            {...form.register('maxHistory', { valueAsNumber: true })}
          />
          {errors.maxHistory && (
            <span className="text-xs text-destructive">must be 0 or greater</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="jsonIndent">JSON Default Indent</Label>
          <Input
            id="jsonIndent"
            type="number"
            {...form.register('jsonIndent', { valueAsNumber: true })}
          />
        </div>

        <div className="flex items-center gap-2">
          <input id="confirmOnClear" type="checkbox" {...form.register('confirmOnClear')} />
          <Label htmlFor="confirmOnClear">Confirm on clear</Label>
        </div>

        <Separator />

        <h3 className="text-sm font-semibold">快捷键</h3>
        <div className="grid grid-cols-2 gap-4">
          {SHORTCUT_KEYS.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <Label htmlFor={`sc-${s.key}`}>{s.label}</Label>
              <Input id={`sc-${s.key}`} {...form.register(`shortcuts.${s.key}`)} />
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="outline" onClick={() => form.reset()}>
            Reset
          </Button>
        </div>
      </form>

      <Separator />

      <UpdateSection />
    </div>
  );
}
