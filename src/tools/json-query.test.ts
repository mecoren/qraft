import { describe, expect, it } from 'vitest';
import { runJsonQuery } from './json-query';

const DATA = {
  store: {
    book: [
      { category: 'fiction', price: 10 },
      { category: 'fiction', price: 20 },
    ],
  },
};

describe('runJsonQuery', () => {
  it('jsonpath:路径查询返回包装数组', () => {
    expect(runJsonQuery(DATA, 'jsonpath', '$.store.book[*].price')).toEqual([10, 20]);
  });

  it('jmespath:点路径与投影查询', () => {
    expect(runJsonQuery(DATA, 'jmespath', 'store.book[*].price')).toEqual([10, 20]);
  });

  it('jmespath:过滤与函数(jsonpath 难写的能力)', () => {
    expect(runJsonQuery(DATA, 'jmespath', 'store.book[?price > `15`].price')).toEqual([20]);
    expect(runJsonQuery(DATA, 'jmespath', 'length(store.book)')).toBe(2);
  });

  it('非法表达式:jmespath 抛出;jsonpath-plus 宽容(不抛,按结果展示)', () => {
    expect(() => runJsonQuery(DATA, 'jmespath', 'store..[')).toThrow();
    // jsonpath-plus 对畸形表达式不抛错(宽容求值),调用方直接展示返回值
    expect(Array.isArray(runJsonQuery(DATA, 'jsonpath', '$..['))).toBe(true);
  });
});
