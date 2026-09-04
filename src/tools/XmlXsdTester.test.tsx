import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { XmlXsdTester } from './XmlXsdTester';
import { getXmlParseError, validateXmlAgainstXsd } from './xml-xsd-utils';

// CodeEditor 内嵌 Monaco,jsdom 无法加载,替换为轻量替身
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid={props['data-testid']}>
      <span>{props.value}</span>
      <textarea
        aria-label="input"
        data-testid={`${props['data-testid']}-textarea`}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

// 组件内默认引擎动态 import xmllint-wasm 浏览器版(需要 Worker + fetch wasm),
// jsdom 下不可用:mock 为注入的假引擎(真实校验由纯逻辑用例用 Node 版验证)
const fakeEngine = vi.fn<
  (opts: { xml: string; xsd: string }) => Promise<{ valid: boolean; errors: unknown[] }>
>();
vi.mock('xmllint-wasm/index-browser.mjs', () => ({
  // 默认实现委托给 fakeEngine;由各用例按需指定返回值
  validateXML: (opts: {
    xml: Array<{ contents: string }>;
    schema: Array<{ contents: string }>;
  }) => fakeEngine({ xml: opts.xml[0].contents, xsd: opts.schema[0].contents }),
}));

const XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="note">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="to" type="xs:string"/>
        <xs:element name="from" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const GOOD_XML = `<note><to>Tove</to><from>Jani</from></note>`;
const BAD_XML = `<note><to>Tove</to><body>unexpected</body></note>`;

describe('xml-xsd-utils 纯逻辑(真实 libxml2,Node worker)', () => {
  it('良构性检查:getXmlParseError', () => {
    expect(getXmlParseError('<a><b></a>')).toBeTruthy();
    expect(getXmlParseError('<a><b/></a>')).toBeNull();
  });

  it('结构正确的 XML 通过真实 XSD 校验', async () => {
    const r = await validateXmlAgainstXsd(GOOD_XML, XSD, nodeEngine());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('结构错误的 XML 产出带行号的错误', async () => {
    const r = await validateXmlAgainstXsd(BAD_XML, XSD, nodeEngine());
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].message).toMatch(/not expected|Expected/);
    expect(r.issues[0].lineNumber).toBeGreaterThan(0);
  });

  it('XSD 语法错误返回 wellFormedError', async () => {
    const r = await validateXmlAgainstXsd(GOOD_XML, '<xs:schema oops', nodeEngine());
    expect(r.ok).toBe(false);
    expect(r.wellFormedError).toBeTruthy();
  });
});

/** 用 xmllint-wasm Node 版做真实校验(worker_threads,Node 可用) */
function nodeEngine() {
  return async (opts: { xml: string; xsd: string }) => {
    const { validateXML } = await import('xmllint-wasm/index-node.js');
    const result = await validateXML({
      xml: [{ fileName: 'input.xml', contents: opts.xml }],
      schema: [{ fileName: 'schema.xsd', contents: opts.xsd }],
    });
    // node 版 errors 为 readonly,映射为可变数组满足引擎签名
    return {
      valid: result.valid,
      errors: result.errors.map((e) => ({
        rawMessage: e.rawMessage,
        message: e.message,
        loc: e.loc,
      })),
    };
  };
}

describe('XmlXsdTester 组件', () => {
  it('初始 idle 提示', () => {
    render(<XmlXsdTester toolId="xml_xsd_tester" metadata={null as never} />);
    expect(screen.getByTestId('xsd-verdict')).toHaveTextContent(/自动/);
  });

  it('XML 语法错误即时提示(不进 wasm)', async () => {
    render(<XmlXsdTester toolId="xml_xsd_tester" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xml-input-textarea'), {
      target: { value: '<a><b></a>' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('xsd-verdict')).toHaveTextContent(/XML 格式错误/);
    });
  });

  it('XSD 语法错误即时提示', async () => {
    render(<XmlXsdTester toolId="xml_xsd_tester" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xsd-input-textarea'), {
      target: { value: '<xs:schema oops' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('xsd-verdict')).toHaveTextContent(/XSD 格式错误/);
    });
  });

  it('真实引擎 ok:显示通过结论', async () => {
    fakeEngine.mockResolvedValue({ valid: true, errors: [] });
    render(<XmlXsdTester toolId="xml_xsd_tester" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xsd-input-textarea'), { target: { value: XSD } });
    fireEvent.change(screen.getByTestId('xml-input-textarea'), { target: { value: GOOD_XML } });
    await waitFor(() => {
      expect(screen.getByTestId('xsd-verdict')).toHaveTextContent(/通过 XSD 校验/);
    });
  });

  it('引擎报错:结构化错误列表带行号徽章', async () => {
    fakeEngine.mockResolvedValue({
      valid: false,
      errors: [
        {
          rawMessage: "input.xml:1: element body: Schemas validity error : Element 'body': This element is not expected.",
          message: "Schemas validity error : Element 'body': This element is not expected.",
          loc: { fileName: 'input.xml', lineNumber: 1 },
        },
      ],
    });
    render(<XmlXsdTester toolId="xml_xsd_tester" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xsd-input-textarea'), { target: { value: XSD } });
    fireEvent.change(screen.getByTestId('xml-input-textarea'), { target: { value: BAD_XML } });
    await waitFor(() => {
      expect(screen.getByTestId('xsd-issue-line')).toHaveTextContent('L1');
      expect(screen.getByTestId('xsd-issues')).toHaveTextContent(/not expected/);
    });
  });
});
