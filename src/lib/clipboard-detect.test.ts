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

  it('识别完整 http/https URL(跳二维码工具)', () => {
    expect(idsOf('https://github.com/mecoren/qraft')).toContain('qrcode_tool');
    expect(idsOf('http://localhost:14200')).toContain('qrcode_tool');
    // 无协议裸域名不误判
    expect(idsOf('github.com/mecoren/qraft')).not.toContain('qrcode_tool');
    // 含空白的多行文本不判 URL
    expect(idsOf('https://a.com/b c')).not.toContain('qrcode_tool');
  });

  it('识别 10/13 位纯数字时间戳', () => {
    expect(idsOf('1726219200')).toContain('timestamp_converter');
    expect(idsOf('1726219200000')).toContain('timestamp_converter');
    // 9 位/14 位/非纯数字不判
    expect(idsOf('172621920')).not.toContain('timestamp_converter');
    expect(idsOf('17262192000000')).not.toContain('timestamp_converter');
    expect(idsOf('17262192ab')).not.toContain('timestamp_converter');
  });

  it('识别十六进制哈希摘要(按摘要长度)', () => {
    expect(idsOf('d41d8cd98f00b204e9800998ecf8427e')).toContain('hash_calculator'); // MD5/32
    expect(idsOf('a'.repeat(64))).toContain('hash_calculator'); // SHA256/64
    expect(idsOf('A'.repeat(40))).toContain('hash_calculator'); // SHA1/40 大写也认
    // 31 位截断、非 hex 字符不判
    expect(idsOf('d41d8cd98f00b204e9800998ecf8427')).not.toContain('hash_calculator');
    expect(idsOf('g'.repeat(64))).not.toContain('hash_calculator');
  });

  it('高置信格式(时间戳/哈希)排在标准格式前', () => {
    // 64 位 hex 也满足 Base64 字符集,双命中时哈希(Premium)置顶
    const r = detectClipboardTools('a'.repeat(64));
    expect(r[0]!.toolId).toBe('hash_calculator');
    expect(idsOf('a'.repeat(64))).toContain('base64_codec');
  });

  it('结果去重且不超过 3 条', () => {
    const mixed = '%41%42%43%44%45%46%47%48%49%4A%4B%4C%4D%4E%4F%50' + 'QQ=='.repeat(40);
    expect(detectClipboardTools(mixed).length).toBeLessThanOrEqual(3);
    const ids = idsOf(mixed);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
