/**
 * JSON 查询引擎(JSONPath / JMESPath,纯前端)
 *
 * 对照 Json Assistant 的双查询(JSONPath + JMESPath):查询视图此前只有
 * JSONPath(jsonpath-plus),本模块补上 JMESPath(jmespath 包)并收敛两个
 * 引擎的调用口径,供 JsonFormatter 查询视图与单测共用。
 */

import { search as jmespathSearch } from 'jmespath';
import { JSONPath } from 'jsonpath-plus';

/** 查询引擎:jsonpath(JSONPath 表达式,如 `$.store.book[*].author`) */
export type QueryEngine = 'jsonpath' | 'jmespath';

/**
 * 在已解析的 JSON 数据上执行查询表达式。
 * 表达式非法时抛出(调用方捕获后展示,两引擎错误形态不统一,不在此处归一)。
 */
export function runJsonQuery(data: unknown, engine: QueryEngine, expression: string): unknown {
  if (engine === 'jmespath') {
    return jmespathSearch(data, expression) as unknown;
  }
  return JSONPath({ path: expression, json: data as object, wrap: true });
}
