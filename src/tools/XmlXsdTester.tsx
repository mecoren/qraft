/**
 * XML / XSD 测试器
 *
 * 浏览器环境无完整 XSD 校验器,本工具提供:
 * - XML / XSD 双输入的良构性检查(DOMParser)
 * - 基于 XSD 顶层 element/attribute 声明的轻量结构校验:
 *   根元素名匹配、已声明元素集合对照(未声明元素给出警告)
 */

import { useDeferredValue, useMemo, type JSX } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
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
    return { doc: null, error: err.textContent?.trim().split('\n')[0] ?? 'XML 解析错误' };
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

export function validateXmlAgainstXsd(
  xmlText: string,
  xsdText: string,
): {
  ok: boolean;
  messages: string[];
} {
  const messages: string[] = [];
  const xml = parseXml(xmlText);
  if (xml.error) return { ok: false, messages: [`XML 格式错误:${xml.error}`] };
  const xsd = parseXml(xsdText);
  if (xsd.error) return { ok: false, messages: [`XSD 格式错误:${xsd.error}`] };

  const declared = collectDeclaredElements(xsd.doc!);
  if (declared.size === 0) {
    return { ok: false, messages: ['XSD 中未找到任何元素声明(xs:element)'] };
  }

  const root = xml.doc!.documentElement;
  const rootName = root.localName;
  if (!declared.has(rootName)) {
    messages.push(`根元素 <${rootName}> 未在 XSD 中声明`);
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
    messages.push(`元素 <${name}> 未在 XSD 中声明`);
  }

  if (messages.length === 0) {
    return { ok: true, messages: ['XML 与 XSD 声明的元素结构一致'] };
  }
  return { ok: false, messages };
}

export function XmlXsdTester(_props: ToolProps): JSX.Element {
  const [xsd, setXsd] = useState('');
  const [xml, setXml] = useState('');
  // 校验需 DOM 解析 + 全树遍历:defer xml 输入,校验低优先级追赶
  const deferredXml = useDeferredValue(xml);

  const verdict = useMemo(() => {
    if (!deferredXml.trim() || !xsd.trim()) return null;
    return validateXmlAgainstXsd(deferredXml, xsd);
  }, [deferredXml, xsd]);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="xml-xsd-tester">
      {/* 校验结论 */}
      <div
        data-testid="xsd-verdict"
        data-search-anchor="xml_xsd_tester:verdict"
        className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-card"
      >
        {verdict === null ? (
          <p className="text-xs text-muted-foreground">输入 XSD 与 XML 后自动校验</p>
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
            className="h-full"
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
            className="h-full"
            searchAnchor="xml_xsd_tester:xml"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
