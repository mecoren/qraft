/**
 * XML / XSD 测试器 —— xmllint-wasm(libxml2)真实 XSD 校验
 *
 * - XSD 预检良构性;XML 同样预检,给出可读语法错误
 * - 校验错误按行号列出,支持跳转提示
 * - wasm 校验异步执行,输入防抖 + 竞态保护
 */

import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { getXmlParseError, validateXmlAgainstXsd, type XsdValidationResult } from './xml-xsd-utils';
import type { ToolProps } from './registry';

// 校验防抖:每次校验都要实例化 wasm Worker,逐键触发开销大
const VALIDATE_DEBOUNCE_MS = 400;

type Verdict =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'invalid-syntax'; file: 'xml' | 'xsd'; message: string }
  | { kind: 'ok' }
  | { kind: 'failed'; result: XsdValidationResult };

export function XmlXsdTester(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [xsd, setXsd] = useState('');
  const [xml, setXml] = useState('');
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const xmlTrim = xml.trim();
      const xsdTrim = xsd.trim();
      if (!xmlTrim && !xsdTrim) {
        setVerdict({ kind: 'idle' });
        return;
      }
      // 单侧为空:只做良构性检查
      if (!xmlTrim || !xsdTrim) {
        if (xmlTrim) {
          const err = getXmlParseError(xml);
          setVerdict(
            err ? { kind: 'invalid-syntax', file: 'xml', message: err } : { kind: 'idle' },
          );
        } else {
          const err = getXmlParseError(xsd);
          setVerdict(
            err ? { kind: 'invalid-syntax', file: 'xsd', message: err } : { kind: 'idle' },
          );
        }
        return;
      }
      setVerdict({ kind: 'running' });
      void validateXmlAgainstXsd(xml, xsd).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setVerdict({ kind: 'ok' });
        } else if (result.wellFormedError) {
          // wasm 层面的 XSD 编译错误;区分 XML 语法错(上面已拦截)与 XSD 错
          const isXmlSide = result.wellFormedError.includes('input.xml');
          setVerdict({
            kind: 'invalid-syntax',
            file: isXmlSide ? 'xml' : 'xsd',
            message: result.wellFormedError,
          });
        } else {
          setVerdict({ kind: 'failed', result });
        }
      });
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [xml, xsd]);

  return (
    // 外层 shell 卡片:校验结论扁平区 + 双栏编辑器收进同一卡片
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="xml-xsd-tester"
    >
      {/* 校验结论 */}
      <div
        data-testid="xsd-verdict"
        data-search-anchor="xml_xsd_tester:verdict"
        className="flex items-start gap-2 border-b border-border px-4 py-3"
      >
        {verdict.kind === 'idle' ? (
          <p className="text-xs text-muted-foreground">{t('tools.xml_xsd_tester.idle_hint')}</p>
        ) : verdict.kind === 'running' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            {t('tools.xml_xsd_tester.validating')}
          </p>
        ) : verdict.kind === 'invalid-syntax' ? (
          <>
            <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 break-all text-body-sm">
              <span className="font-medium text-destructive">
                {verdict.file === 'xml'
                  ? t('tools.xml_xsd_tester.xml_invalid', { error: '' })
                  : t('tools.xml_xsd_tester.xsd_invalid', { error: '' })}
              </span>{' '}
              {verdict.message}
            </p>
          </>
        ) : verdict.kind === 'ok' ? (
          <>
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-diff-add-fg" />
            <p className="text-body-sm">{t('tools.xml_xsd_tester.structure_ok')}</p>
          </>
        ) : (
          <>
            <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <ul className="min-w-0 flex-1 space-y-0.5 text-body-sm" data-testid="xsd-issues">
              {verdict.result.issues.map((issue) => (
                <li key={issue.raw} className="break-all">
                  {issue.lineNumber !== null && (
                    <span
                      className="mr-1.5 rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-xs text-destructive"
                      data-testid="xsd-issue-line"
                    >
                      L{issue.lineNumber}
                    </span>
                  )}
                  {issue.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="XSD"
            language="xml"
            value={xsd}
            onChange={setXsd}
            placeholder={'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">…'}
            data-testid="xsd-input"
            className="h-full rounded-none border-0 border-r"
            searchAnchor="xml_xsd_tester:xsd"
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
          <CodeEditor
            title="XML"
            language="xml"
            value={xml}
            onChange={setXml}
            data-testid="xml-input"
            className="h-full rounded-none border-0 border-l"
            searchAnchor="xml_xsd_tester:xml"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
