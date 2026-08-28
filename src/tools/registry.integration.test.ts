import { describe, it, expect } from 'vitest';
import { getToolComponent } from './registry';

// import registry 模块即完成全部工具的懒加载登记(React.lazy 只登记 loader,
// 不真正执行模块 import),因此这里只需 import 一次即可断言各 toolId 均有组件。
import './registry';

const P0_TOOL_IDS = [
  'json_formatter',
  'json_minifier',
  'base64_codec',
  'jwt_parser',
  'uuid_generator',
  'hash_calculator',
  'timestamp_converter',
  'color_converter',
  'regex_tester',
] as const;

describe('P0 工具 UI 注册集成测试', () => {
  it('registers all P0 tool components', () => {
    for (const id of P0_TOOL_IDS) {
      const Comp = getToolComponent(id);
      expect(Comp, `tool UI not registered: ${id}`).not.toBeNull();
    }
  });

  it('registers distinct components', () => {
    const seen = new Set();
    for (const id of P0_TOOL_IDS) {
      const Comp = getToolComponent(id);
      // 每个 id 对应不同组件(以函数引用区分)
      seen.add(Comp);
    }
    expect(seen.size).toBe(P0_TOOL_IDS.length);
  });
});
