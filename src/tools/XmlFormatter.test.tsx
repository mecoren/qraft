import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { XmlFormatter } from './XmlFormatter';
import { formatXml } from './xml-format-utils';

vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div data-testid={props['data-testid']}>
      <span data-testid={`${props['data-testid']}-text`}>{props.value}</span>
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

describe('formatXml 纯逻辑', () => {
  it('基本缩进格式化', () => {
    const out = formatXml('<root><a><b>text</b></a></root>', '2', false);
    expect(out).toBe('<root>\n  <a>\n    <b>text</b>\n  </a>\n</root>');
  });

  it('minify 单行输出', () => {
    const out = formatXml('<root>  <a> x </a>  <b>y</b> </root>', 'minify', false);
    expect(out).toBe('<root><a>x</a><b>y</b></root>');
  });

  it('Tab 缩进', () => {
    const out = formatXml('<r><a/></r>', 'tab', false);
    expect(out).toContain('\t<a />');
  });

  it('保留 XML 声明原文(encoding 不硬编码)', () => {
    const out = formatXml('<?xml version="1.0" encoding="GBK"?><r><a/></r>', '2', false);
    expect(out).toContain('<?xml version="1.0" encoding="GBK"?>');
  });

  it('保留 DOCTYPE', () => {
    const out = formatXml('<!DOCTYPE note><note><a/></note>', '2', false);
    expect(out).toContain('<!DOCTYPE note>');
    expect(out).toContain('<note>');
  });

  it('保留处理指令与注释', () => {
    const out = formatXml(
      '<?xml-stylesheet href="a.xsl" type="text/xsl"?><r><!-- hi --><a/></r>',
      '2',
      false,
    );
    expect(out).toContain('<?xml-stylesheet href="a.xsl" type="text/xsl"?>');
    expect(out).toContain('<!-- hi -->');
  });

  it('保留 CDATA', () => {
    const out = formatXml('<r><a><![CDATA[x < y]]></a></r>', '2', false);
    expect(out).toContain('<![CDATA[x < y]]>');
  });

  it('属性换行开关', () => {
    const out = formatXml('<r a="1" b="2"><x/></r>', '2', true);
    expect(out).toContain('\n  a="1"');
    expect(out).toContain('\n  b="2"');
  });

  it('非法 XML 抛错', () => {
    expect(() => formatXml('<a><b></a>', '2', false)).toThrow();
  });

  it('特殊字符转义 roundtrip', () => {
    const src = '<r a="&quot;q&quot;"><t>&amp; &lt;tag&gt;</t></r>';
    const out = formatXml(src, '2', false);
    expect(out).toContain('a="&quot;q&quot;"');
    expect(out).toContain('&amp; &lt;tag&gt;');
  });
});

describe('XmlFormatter 组件', () => {
  it('输入即格式化', async () => {
    render(<XmlFormatter toolId="xml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xmlfmt-input-textarea'), {
      target: { value: '<root><a/></root>' },
    });
    expect(await screen.findByTestId('xmlfmt-output-text')).toHaveTextContent(/<root>\s*<a \/>/);
  });

  it('非法输入显示错误', async () => {
    render(<XmlFormatter toolId="xml_formatter" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('xmlfmt-input-textarea'), {
      target: { value: '<a><b></a>' },
    });
    expect(await screen.findByTestId('xmlfmt-output-text')).toHaveTextContent(/格式化失败/);
  });
});
