import { beforeEach, describe, expect, it } from 'vitest';
import { consumeHandoff, peekHandoff, requestHandoff, useHandoffStore } from './handoffStore';

describe('handoffStore', () => {
  beforeEach(() => {
    useHandoffStore.setState({ pending: null });
  });

  it('request 后 peek/consume 可取到文本,consume 清除待处理载荷', () => {
    requestHandoff('hash_calculator', 'hello');
    expect(peekHandoff('hash_calculator')).toBe('hello');
    expect(consumeHandoff('hash_calculator')).toBe('hello');
    expect(consumeHandoff('hash_calculator')).toBeNull();
  });

  it('toolId 不匹配时不命中(只投递给目标工具)', () => {
    requestHandoff('base64_codec', 'aGVsbG8=');
    expect(peekHandoff('json_formatter')).toBeNull();
    expect(consumeHandoff('json_formatter')).toBeNull();
    // 原载荷不受误取影响
    expect(peekHandoff('base64_codec')).toBe('aGVsbG8=');
  });

  it('新的 request 覆盖旧的未消费载荷', () => {
    requestHandoff('hash_calculator', 'first');
    requestHandoff('hash_calculator', 'second');
    expect(consumeHandoff('hash_calculator')).toBe('second');
  });
});
