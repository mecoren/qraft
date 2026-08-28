import { describe, expect, it } from 'vitest';
import { detectClipboardTools } from './clipboard-detect';

const idsOf = (s: string) => detectClipboardTools(s).map((r) => r.toolId);

describe('detectClipboardTools', () => {
  it('空串与超长输入返回空数组', () => {
    expect(idsOf('   ')).toEqual([]);
    expect(idsOf('x'.repeat(65_537))).toEqual([]);
    expect(detectClipboardTools(undefined as never)).toEqual([]);
  });

  it('识别 JSON 对象与数组', () => {
    expect(idsOf('{"a":1}')).toContain('json_formatter');
    expect(idsOf('[1,2,3]')).toContain('json_formatter');
    expect(idsOf('{not json}')).not.toContain('json_formatter');
  });

  it('识别 JWT 三段结构', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.' + '2bX9ZQ'.repeat(6);
    expect(idsOf(jwt)).toContain('jwt_parser');
    // 缺签名段(两段式)不识别
    expect(idsOf('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0=')).not.toContain('jwt_parser');
  });

  it('识别单行 Base64(长度为 4 的倍数且可解码)', () => {
    expect(idsOf('aGVsbG8gd29ybGQhIQ==')).toContain('base64_codec');
    expect(idsOf('这是普通中文句子!!')).not.toContain('base64_codec');
    expect(idsOf('aGVsbG8g')).not.toContain('base64_codec'); // 长度不足
  });

  it('识别 PEM 证书并置于首位', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const r = detectClipboardTools(pem);
    expect(r[0]!.toolId).toBe('certificate_decoder');
  });

  it('识别 URL 编码片段', () => {
    // url_codec 已移除,URL 编解码能力并入文本处理工具(toolId: json_minifier)
    expect(idsOf('hello%20world%21')).toContain('json_minifier');
    expect(idsOf('100% 正常中文')).not.toContain('json_minifier');
  });

  it('结果去重且不超过 3 条', () => {
    const mixed = '%41%42%43%44%45%46%47%48%49%4A%4B%4C%4D%4E%4F%50' + 'QQ=='.repeat(40);
    expect(detectClipboardTools(mixed).length).toBeLessThanOrEqual(3);
    const ids = idsOf(mixed);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
