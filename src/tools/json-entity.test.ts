/**
 * json-entity 单元测试 —— 多语言实体类生成
 */
import { describe, expect, it } from 'vitest';
import { ENTITY_LANGUAGE_ITEMS, generateEntityCode } from './json-entity';

const SAMPLE = {
  id: 42,
  name: 'qraft',
  active: true,
  score: 3.14,
  tags: ['a', 'b'],
  owner: { userId: 7, nickname: 'n' },
  orders: [{ orderId: 1, total: 9.5 }],
  remark: null,
};

describe('generateEntityCode', () => {
  it('exposes the six supported languages for the convert menu', () => {
    expect(ENTITY_LANGUAGE_ITEMS.map((l) => l.id)).toEqual([
      'typescript',
      'java',
      'go',
      'rust',
      'python',
      'csharp',
    ]);
  });

  it('generates a TypeScript interface tree', () => {
    const code = generateEntityCode(SAMPLE, 'typescript');
    expect(code).toContain('export interface Root {');
    expect(code).toContain('export interface Owner {');
    // orders 数组元素类型按单数命名(Order)
    expect(code).toContain('orders: Order[]');
    expect(code).toContain('orderId: number;');
    // null 字段输出可空类型
    expect(code).toContain('remark: null;');
  });

  it('generates a Java class with getters and setters', () => {
    const code = generateEntityCode(SAMPLE, 'java');
    expect(code).toContain('import java.util.List;');
    expect(code).toMatch(/public class Root \{/);
    expect(code).toContain('private int id;');
    expect(code).toContain('private double score;');
    expect(code).toContain('private List<Order> orders;');
    expect(code).toContain('public int getId() { return id; }');
    expect(code).toContain('public void setId(int id) { this.id = id; }');
    expect(code).toContain('public class Owner {');
  });

  it('generates Go structs with json tags', () => {
    const code = generateEntityCode(SAMPLE, 'go');
    expect(code).toMatch(/type Root struct \{/);
    expect(code).toContain('`json:"name"`');
    expect(code).toContain('`json:"userId"`');
    expect(code).toContain('Orders []Order `json:"orders"`');
    expect(code).toContain('Remark any `json:"remark"`');
    // 嵌套结构体独立定义
    expect(code).toMatch(/type Owner struct \{/);
    expect(code).toMatch(/type Order struct \{/);
  });

  it('generates Rust structs with serde derives and renames', () => {
    const code = generateEntityCode(SAMPLE, 'rust');
    expect(code).toContain('use serde::{Deserialize, Serialize};');
    expect(code).toMatch(/#\[derive\(Debug, Clone, Default, Serialize, Deserialize\)\]/);
    expect(code).toMatch(/pub struct Root \{/);
    // camelCase 键转 snake_case 并补 serde rename
    expect(code).toContain('#[serde(rename = "userId")]');
    expect(code).toContain('pub user_id: i64,');
    expect(code).toContain('#[serde(rename = "orderId")]');
    expect(code).toContain('pub order_id: i64,');
    // null 字段 → Option
    expect(code).toContain('pub remark: Option<serde_json::Value>,');
  });

  it('generates Python dataclasses with defaults', () => {
    const code = generateEntityCode(SAMPLE, 'python');
    expect(code).toContain('from dataclasses import dataclass, field');
    expect(code).toContain('from typing import Any, List, Optional');
    expect(code).toMatch(/@dataclass\s*\nclass Root:/);
    expect(code).toContain('id: int = 0');
    expect(code).toContain('score: float = 0');
    // null → Optional + None 默认值
    expect(code).toContain('remark: Optional[Any] = None');
    // 数组字段 default_factory
    expect(code).toContain('tags: List[str] = field(default_factory=list)');
    expect(code).toContain('orders: List[Order] = field(default_factory=list)');
  });

  it('generates C# classes with JsonPropertyName when casing differs', () => {
    const code = generateEntityCode(SAMPLE, 'csharp');
    expect(code).toMatch(/public class Root\s*\n\{/);
    expect(code).toContain('public int Id { get; set; }');
    expect(code).toContain('[System.Text.Json.Serialization.JsonPropertyName("userId")]');
    expect(code).toContain('public List<Order> Orders { get; set; }');
    // null 字段 → 可空引用类型标注
    expect(code).toContain('public object? Remark { get; set; }');
  });

  it('handles non-object roots with a comment instead of crashing', () => {
    for (const lang of ['java', 'go', 'rust', 'python', 'csharp'] as const) {
      const code = generateEntityCode([1, 2], lang);
      expect(code).toContain('根节点不是 JSON 对象');
    }
    const ts = generateEntityCode([1, 2], 'typescript');
    expect(ts).toContain('export type Root = number[];');
  });

  it('dedupes nested type names with numeric suffixes', () => {
    const value = { a: { x: 1 }, b: { y: 2 } };
    const code = generateEntityCode(value, 'go');
    expect(code).toContain('type A struct');
    expect(code).toContain('type B struct');
  });
});
