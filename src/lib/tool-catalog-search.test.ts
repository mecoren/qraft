/**
 * searchCatalog 单元测试 —— 目录模糊过滤(PRD 18 P1,三处消费方同口径)。
 */
import { describe, it, expect } from 'vitest';
import { searchCatalog, TOOL_CATALOG, type CatalogEntry } from './tool-catalog';

const idsOf = (entries: readonly CatalogEntry[]): string[] => entries.map((e) => e.id);

describe('searchCatalog', () => {
  it('空查询返回全量且保持目录原顺序', () => {
    expect(idsOf(searchCatalog(''))).toEqual(TOOL_CATALOG.map((e) => e.id));
  });

  it('完整子串命中(cron 搜出 Cron 表达式解析器)', () => {
    expect(idsOf(searchCatalog('cron'))).toContain('cron_parser');
  });

  it('中文关键词命中(二维码)', () => {
    expect(idsOf(searchCatalog('二维码'))).toContain('qrcode_tool');
  });

  it('缩写子序列命中:jsf 搜出 JSON 格式化器', () => {
    expect(idsOf(searchCatalog('jsf'))).toContain('json_formatter');
  });

  it('相关度排序:json_formatter 在 json 查询的头部(前 3)', () => {
    const ranked = idsOf(searchCatalog('json'));
    expect(ranked).toContain('json_formatter');
    expect(ranked.indexOf('json_formatter')).toBeLessThan(3);
  });

  it('乱序缩写不命中无关工具(sjf 至少不命中 Base64)', () => {
    // sjf 对 json 描述是合法子序列(排序→JSON→…),会命中 JSON 系工具;
    // 但绝不应把与 s/j/f 无关的工具带出来
    expect(idsOf(searchCatalog('sjf'))).not.toContain('base64_codec');
  });

  it('全部不命中返回空数组', () => {
    expect(searchCatalog('zzzz不存在q')).toEqual([]);
  });
});
