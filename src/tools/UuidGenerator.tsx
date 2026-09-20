/**
 * UUID 生成器 —— 新代统一布局
 *
 * 结构(对齐 JsonFormatter 基准):
 * - 外层 shell 卡片,顶部为扁平「配置」区:版本 / 数量 / 格式(大写·连字符)三行
 * - 下方全高输出编辑器:「生成」动作在编辑器工具栏,结果区带「全部复制」
 *
 * 错误处理遵循新代约定:执行失败信息直接写入输出编辑器。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Hash, Play, Type } from 'lucide-react';
import { formatError } from '@/lib/format-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor } from '@/components/ui/code-editor';
import { ConfigRow, ConfigSection, HeaderAction } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { copyTextWithFeedback } from '@/lib/toast-alert';
import { invokeCommand } from '@/lib/ipc';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import type { ToolProps } from './registry';
import type { ToolOutput } from '@/types/tool';

interface UuidParams {
  version: 'v4' | 'v7';
  count: number;
  uppercase: boolean;
  hyphens: boolean;
}

export function UuidGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [version, setVersion] = useState<'v4' | 'v7'>('v4');
  const [count, setCount] = useState(1);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params: UuidParams = {
        version,
        // 非法/越界数量按 1 兜底(UlidGenerator 同口径),不再把 0 发给后端报错
        count: Math.floor(count) || 1,
        uppercase,
        hyphens,
      };
      const result = await invokeCommand<ToolOutput>('tool_execute', {
        toolId,
        input: { text: undefined, params },
      });
      setOutput(result.text ?? '');
    } catch (e) {
      setOutput(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  useToolShortcutActions(toolId, {
    execute: loading ? undefined : () => void handleGenerate(),
    clearInput: () => setOutput(''),
    copyOutput: output ? () => void copyTextWithFeedback(output) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 JsonFormatter / EditorWorkbench 基准):
    // rounded-lg + border + shadow,配置区与输出编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="uuid-generator"
    >
      <ConfigSection
        headerHint={t('tools.uuid_generator.section_hint')}
        searchAnchor="uuid_generator:config"
      >
        <ConfigRow
          icon={Fingerprint}
          caption={t('tools.uuid_generator.version')}
          captionHint={t('tools.uuid_generator.version_hint')}
        >
          <Select value={version} onValueChange={(v) => setVersion(v as 'v4' | 'v7')}>
            <SelectTrigger
              className="h-7 w-24 text-xs"
              aria-label={t('tools.uuid_generator.version')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="v4">v4</SelectItem>
              <SelectItem value="v7">v7</SelectItem>
            </SelectContent>
          </Select>
        </ConfigRow>
        <ConfigRow icon={Hash} caption={t('tools.uuid_generator.count')} captionHint="1 ~ 1000">
          <Input
            id="count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-7 w-24 text-xs"
            aria-label={t('tools.uuid_generator.count')}
          />
        </ConfigRow>
        <ConfigRow
          icon={Type}
          caption={t('tools.uuid_generator.format')}
          captionHint={t('tools.uuid_generator.format_hint')}
        >
          <div className="flex items-center gap-2">
            <Switch
              id="uppercase"
              aria-label={t('tools.uuid_generator.uppercase')}
              checked={uppercase}
              onCheckedChange={setUppercase}
            />
            <Label htmlFor="uppercase" className="text-xs">
              {t('tools.uuid_generator.uppercase')}
            </Label>
          </div>
          <span className="h-4 w-px bg-border" aria-hidden />
          <div className="flex items-center gap-2">
            <Switch
              id="hyphens"
              aria-label={t('tools.uuid_generator.hyphens')}
              checked={hyphens}
              onCheckedChange={setHyphens}
            />
            <Label htmlFor="hyphens" className="text-xs">
              {t('tools.uuid_generator.hyphens')}
            </Label>
          </div>
        </ConfigRow>
      </ConfigSection>

      <CodeEditor
        readOnly
        title={t('tools.uuid_generator.output_title')}
        language="plaintext"
        value={output}
        placeholder={t('tools.uuid_generator.output_placeholder')}
        className="min-h-0 flex-1 rounded-none border-0"
        data-testid="output"
        searchAnchor="uuid_generator:output"
        actions={
          <>
            <HeaderAction onClick={() => void handleGenerate()} disabled={loading}>
              <Play aria-hidden className="size-3.5" />
              {loading ? t('tools.uuid_generator.generating') : t('tools.uuid_generator.generate')}
            </HeaderAction>
            {output && <CopyAction text={output} testId="copy-all" />}
          </>
        }
      />
    </div>
  );
}
