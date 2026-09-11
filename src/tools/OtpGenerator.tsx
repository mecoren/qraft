/**
 * OTP 动态口令工具 —— Base32 密钥 → TOTP / HOTP 口令生成与校验。
 * 左右分栏(对齐 QrcodeTool 非编辑器面板模式):左密钥与参数「编辑框」式
 * 面板,右口令显示面板(大字号口令 + TOTP 时间窗倒计时);
 * 校验开关开启时右栏扩展口令输入与比对结果。仅在本机内存中计算,不落盘不上传。
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Timer, XCircle } from 'lucide-react';
import { ConfigRow, ConfigSection } from '@/components/config-card';
import { CopyAction } from '@/components/copy-action';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useToolShortcutActions } from '@/hooks/useToolShortcutActions';
import {
  base32Decode,
  constantTimeEqual,
  generateHotp,
  generateTotp,
  secondsRemainingInWindow,
} from './otp-utils';
import type { ToolProps } from './registry';

type OtpMode = 'totp' | 'hotp';

export function OtpGenerator({ toolId }: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<OtpMode>('totp');
  const [counter, setCounter] = useState(0);
  const [digits, setDigits] = useState(6);
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyMode, setVerifyMode] = useState(false);

  // 密钥解码:非法输入给本地化错误
  const secretBytes = useMemo(() => {
    const trimmed = secret.trim();
    if (!trimmed) return null;
    try {
      const bytes = base32Decode(trimmed);
      return { bytes, error: null as string | null };
    } catch (e) {
      return {
        bytes: null,
        error: t('tools.otp_generator.error_secret', {
          message: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [secret, t]);

  // TOTP 倒计时:每秒刷新剩余秒;窗口切换时重新生成
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (mode !== 'totp' || !secretBytes?.bytes) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [mode, secretBytes]);

  // 当前口令:secret / mode / counter / digits / now 任一变化即重算
  const [code, setCode] = useState('');
  useEffect(() => {
    const bytes = secretBytes?.bytes;
    if (!bytes) return;
    let cancelled = false;
    const compute =
      mode === 'totp' ? generateTotp(bytes, now, 30, digits) : generateHotp(bytes, counter, digits);
    void compute
      .then((c) => {
        if (!cancelled) setCode(c);
      })
      .catch(() => {
        if (!cancelled) setCode('');
      });
    return () => {
      cancelled = true;
    };
  }, [secretBytes, mode, counter, digits, now]);

  const remaining = secondsRemainingInWindow(now);

  // 密钥失效/清空时口令视为不存在(不依赖 effect 同步清空,避免级联渲染)
  const shownCode = secretBytes?.bytes ? code : '';

  // 校验:比对用户输入与当前口令(仅生成成功时启用)
  const verifyResult = useMemo(() => {
    if (!verifyMode || !shownCode) return null;
    const input = verifyInput.trim();
    if (!input) return null;
    return constantTimeEqual(input, shownCode);
  }, [verifyMode, verifyInput, shownCode]);

  useToolShortcutActions(toolId, {
    clearInput: () => {
      setSecret('');
      setVerifyInput('');
    },
    copyOutput: shownCode ? () => navigator.clipboard.writeText(shownCode) : undefined,
  });

  return (
    // 外层 shell 卡片(对齐 QrcodeTool 基准):配置区在上,左右分栏收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="otp-generator"
    >
      <ConfigSection title="" searchAnchor="otp_generator:config">
        <ConfigRow
          icon={KeyRound}
          label={t('tools.otp_generator.secret')}
          hint={t('tools.otp_generator.secret_hint')}
        >
          <Input
            aria-label={t('tools.otp_generator.secret')}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </ConfigRow>
        <ConfigRow
          icon={Timer}
          label={t('tools.otp_generator.mode')}
          hint={t('tools.otp_generator.mode_hint')}
        >
          <span className="text-xs text-muted-foreground">
            {mode === 'totp'
              ? t('tools.otp_generator.mode_totp')
              : t('tools.otp_generator.mode_hotp')}
          </span>
          <Switch
            aria-label={t('tools.otp_generator.mode')}
            checked={mode === 'hotp'}
            onCheckedChange={(hotp) => setMode(hotp ? 'hotp' : 'totp')}
          />
        </ConfigRow>
        {mode === 'hotp' && (
          <ConfigRow icon={Timer} label={t('tools.otp_generator.counter')}>
            <Input
              aria-label={t('tools.otp_generator.counter')}
              type="number"
              min={0}
              value={counter}
              onChange={(e) => setCounter(Number(e.target.value))}
              className="w-32"
            />
          </ConfigRow>
        )}
        <ConfigRow icon={KeyRound} label={t('tools.otp_generator.digits')}>
          <Input
            aria-label={t('tools.otp_generator.digits')}
            type="number"
            min={6}
            max={8}
            value={digits}
            onChange={(e) => setDigits(Math.min(8, Math.max(6, Number(e.target.value) || 6)))}
            className="w-20"
          />
        </ConfigRow>
        <ConfigRow
          icon={CheckCircle2}
          label={t('tools.otp_generator.verify')}
          hint={t('tools.otp_generator.verify_hint')}
        >
          <Switch
            aria-label={t('tools.otp_generator.verify')}
            checked={verifyMode}
            onCheckedChange={setVerifyMode}
          />
        </ConfigRow>
      </ConfigSection>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* 左栏:参数「编辑框」(照 QrcodeTool 图片预览面板模式:26px 标题栏 + 内容区) */}
        <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-r"
            data-search-anchor="otp_generator:input"
          >
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.otp_generator.params_title')}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-sm">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('tools.otp_generator.mode')}</dt>
                  <dd className="font-medium">
                    {mode === 'totp'
                      ? t('tools.otp_generator.mode_totp')
                      : t('tools.otp_generator.mode_hotp')}
                  </dd>
                </div>
                {mode === 'hotp' && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t('tools.otp_generator.counter')}
                    </dt>
                    <dd className="font-medium tabular-nums">{counter}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('tools.otp_generator.digits')}
                  </dt>
                  <dd className="font-medium tabular-nums">{digits}</dd>
                </div>
                {mode === 'totp' && shownCode && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t('tools.otp_generator.window_title')}
                    </dt>
                    <dd className="font-medium tabular-nums">30s · {remaining}s</dd>
                  </div>
                )}
              </dl>
              {secretBytes?.error && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
                  data-testid="otp-secret-error"
                >
                  {secretBytes.error}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* 右栏:口令显示面板(26px 标题栏 + 大字号口令,同编辑框同构) */}
        <ResizablePanel defaultSize="50" minSize="25" className="min-h-0 min-w-0">
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 border-l"
            data-testid="otp-output"
            data-search-anchor="otp_generator:output"
          >
            <div className="flex h-[26px] min-w-0 items-center justify-between gap-x-2 border-b border-input px-2">
              <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">
                {t('tools.otp_generator.output_title')}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {shownCode && <CopyAction text={shownCode} testId="copy-otp" />}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4">
              <div
                className="select-none text-5xl font-semibold tracking-[0.3em] tabular-nums"
                data-testid="otp-code"
              >
                {shownCode || '------'}
              </div>
              {mode === 'totp' && shownCode && (
                <div
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  data-testid="otp-remaining"
                >
                  <Timer aria-hidden className="size-3.5" />
                  {t('tools.otp_generator.remaining', { seconds: remaining })}
                </div>
              )}
              {verifyMode && (
                <div
                  className="w-full max-w-xs space-y-2"
                  data-testid="otp-verify-area"
                  data-search-anchor="otp_generator:verify"
                >
                  <Input
                    aria-label={t('tools.otp_generator.code_input')}
                    value={verifyInput}
                    onChange={(e) => setVerifyInput(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t('tools.otp_generator.code_input')}
                    className="text-center font-mono tracking-widest"
                  />
                  {verifyResult !== null && (
                    <div
                      className={
                        verifyResult
                          ? 'flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-600'
                          : 'flex items-center justify-center gap-2 rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-destructive'
                      }
                      data-testid="otp-verify-result"
                    >
                      {verifyResult ? (
                        <CheckCircle2 aria-hidden className="size-4" />
                      ) : (
                        <XCircle aria-hidden className="size-4" />
                      )}
                      {verifyResult
                        ? t('tools.otp_generator.verify_pass')
                        : t('tools.otp_generator.verify_fail')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
