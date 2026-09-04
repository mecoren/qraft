/**
 * XML / XSD 校验核心:xmllint-wasm(libxml2 WebAssembly)提供真实 XSD 校验。
 *
 * - validateXmlAgainstXsd:xml + xsd → 校验结论(错误行号 + 消息)
 * - 内部对输入做 DOMParser 良构性预检:解析错误时直接返回语法错误
 *   (比 wasm 里的报错信息更可控、可本地化)
 * - wasm 加载与执行均在浏览器 Worker 中,不阻塞 UI;
 *   jsdom 测试环境下该模块被 mock(见 XmlXsdTester.test.tsx)
 */

export interface XsdValidationIssue {
  /** 错误消息(英文,来自 libxml2) */
  message: string;
  /** 源文件名(xml / xsd)与行号;解析失败时为 null */
  fileName: string | null;
  lineNumber: number | null;
  /** 原始单行输出 */
  raw: string;
}

export interface XsdValidationResult {
  ok: boolean;
  /** ok=false 时的错误清单(结构化) */
  issues: XsdValidationIssue[];
  /** 良构性错误(XML 或 XSD 本身不是合法 XML)时的消息,结构化 issues 之外的兜底 */
  wellFormedError: string | null;
}

/** DOMParser 良构性检查:返回首个 parsererror 的首行消息,合法返回 null */
export function getXmlParseError(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    return err.textContent?.trim().split('\n')[0] ?? 'XML parse error';
  }
  return null;
}

interface XmllintIssue {
  rawMessage: string;
  message: string;
  loc: { fileName: string; lineNumber: number } | null;
}

/** 校验引擎签名(与 xmllint-wasm validateXML 结果形状一致;errors 只读) */
export type XsdEngine = (opts: {
  xml: string;
  xsd: string;
}) => Promise<{ valid: boolean; errors: readonly XmllintIssue[] }>;

/**
 * 执行真实 XSD 校验。
 * @param xmlText 待校验 XML
 * @param xsdText XSD 模式文档
 * @param engine 校验执行器(注入以便测试替身);缺省用 xmllint-wasm 浏览器版
 */
export async function validateXmlAgainstXsd(
  xmlText: string,
  xsdText: string,
  engine?: XsdEngine,
): Promise<XsdValidationResult> {
  // 良构性预检:分别检查 XML 与 XSD,给出可控的本地化入口
  const xmlErr = getXmlParseError(xmlText);
  if (xmlErr) {
    return { ok: false, issues: [], wellFormedError: xmlErr };
  }
  const xsdErr = getXmlParseError(xsdText);
  if (xsdErr) {
    return { ok: false, issues: [], wellFormedError: xsdErr };
  }

  const run =
    engine ??
    (async (opts: { xml: string; xsd: string }) => {
      const { validateXML } = await import('xmllint-wasm/index-browser.mjs');
      return validateXML({
        xml: [{ fileName: 'input.xml', contents: opts.xml }],
        schema: [{ fileName: 'schema.xsd', contents: opts.xsd }],
      });
    });

  try {
    const result = await run({ xml: xmlText, xsd: xsdText });
    if (result.valid) {
      return { ok: true, issues: [], wellFormedError: null };
    }
    return {
      ok: false,
      wellFormedError: null,
      issues: result.errors.map((e: XmllintIssue) => ({
        message: e.message,
        fileName: e.loc?.fileName ?? null,
        lineNumber: e.loc?.lineNumber ?? null,
        raw: e.rawMessage,
      })),
    };
  } catch (e) {
    // wasm 内部错误(schema 语法问题等)
    return {
      ok: false,
      issues: [],
      wellFormedError: e instanceof Error ? e.message : String(e),
    };
  }
}
