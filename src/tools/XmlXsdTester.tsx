/**
 * XML / XSD 测试器
 *
 * 浏览器环境无完整 XSD 校验器,本工具提供:
 * - XML / XSD 双输入的良构性检查(DOMParser)
 * - 基于 XSD 顶层 element/attribute 声明的轻量结构校验:
 *   根元素名匹配、已声明元素集合对照(未声明元素给出警告)
 */

import { useDeferredValue, useMemo, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { t as translate } from '@/i18n';
import { CodeEditor } from '@/components/ui/code-editor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useState } from 'react';
import type { ToolProps } from './registry';

interface ParseOutcome {
  doc: Document | null;
  error: string | null;
}

function parseXml(text: string): ParseOutcome {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    return {
      doc: null,
      error:
        err.textContent?.trim().split('\n')[0] ?? translate('tools.xml_xsd_tester.parse_error'),
    };
  }
  return { doc, error: null };
}

/** 从 XSD 收集声明的元素名(含嵌套 xs:element) */
function collectDeclaredElements(xsd: Document): Set<string> {
  const names = new Set<string>();
  const all = xsd.getElementsByTagNameNS('http://www.w3.org/2001/XMLSchema', 'element');
  for (const el of Array.from(all)) {
    const name = el.getAttribute('name') ?? el.getAttribute('ref');
    if (name) names.add(name.replace(/^.*:/, ''));
  }
  return names;
}

/** i18n 翻译函数签名(组件内传 react-i18next 的 t,保证语言切换后重算) */
type TranslateFn = typeof translate;

export function validateXmlAgainstXsd(
  xmlText: string,
  xsdText: string,
  tr: TranslateFn = translate,
): {
  ok: boolean;
  messages: string[];
} {
  const messages: string[] = [];
  const xml = parseXml(xmlText);
  if (xml.error)
    return { ok: false, messages: [tr('tools.xml_xsd_tester.xml_invalid', { error: xml.error })] };
  const xsd = parseXml(xsdText);
  if (xsd.error)
    return { ok: false, messages: [tr('tools.xml_xsd_tester.xsd_invalid', { error: xsd.error })] };

  const declared = collectDeclaredElements(xsd.doc!);
  if (declared.size === 0) {
    return { ok: false, messages: [tr('tools.xml_xsd_tester.no_declarations')] };
  }

  const root = xml.doc!.documentElement;
  const rootName = root.localName;
  if (!declared.has(rootName)) {
    messages.push(tr('tools.xml_xsd_tester.root_not_declared', { name: rootName }));
  }

  // 遍历 XML 全部元素,统计未声明的元素名
  const undeclared = new Set<string>();
  const walker = xml.doc!.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const name = (node as Element).localName;
    if (!declared.has(name)) undeclared.add(name);
    node = walker.nextNode();
  }
  for (const name of undeclared) {
    messages.push(tr('tools.xml_xsd_tester.element_not_declared', { name }));
  }

  if (messages.length === 0) {
    return { ok: true, messages: [tr('tools.xml_xsd_tester.structure_ok')] };
  }
  return { ok: false, messages };
}

export function XmlXsdTester(_props: ToolProps): JSX.Element {
  const { t } = useTranslation();
  const [xsd, setXsd] = useState('');
  const [xml, setXml] = useState('');
  // 校验需 DOM 解析 + 全树遍历:defer xml 输入,校验低优先级追赶
  const deferredXml = useDeferredValue(xml);

  const verdict = useMemo(() => {
    if (!deferredXml.trim() || !xsd.trim()) return null;
    return validateXmlAgainstXsd(deferredXml, xsd, t);
  }, [deferredXml, xsd, t]);

  return (
    // 外层 shell 卡片(对齐 JsonFormatter 基准):校验结论扁平区 + 双栏编辑器收进同一卡片
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
        {verdict === null ? (
          <p className="text-xs text-muted-foreground">{t('tools.xml_xsd_tester.idle_hint')}</p>
        ) : verdict.ok ? (
          <>
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-diff-add-fg" />
            <p className="text-body-sm">{verdict.messages[0]}</p>
          </>
        ) : (
          <>
            <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <ul className="min-w-0 flex-1 space-y-0.5 text-body-sm">
              {verdict.messages.map((m) => (
                <li key={m}>{m}</li>
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
