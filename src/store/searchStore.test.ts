/**
 * searchStore 单元测试 —— 跳转信令的写入与消费。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from './searchStore';
import type { SearchTarget } from '@/lib/search-index';

describe('searchStore', () => {
  beforeEach(() => {
    useSearchStore.setState({ target: null });
  });

  it('requestJump 写入跳转目标', () => {
    const target: SearchTarget = {
      view: 'tool',
      toolId: 'json_formatter',
      anchor: 'json_formatter:input',
    };
    useSearchStore.getState().requestJump(target);
    expect(useSearchStore.getState().target).toEqual(target);
  });

  it('consume 清除跳转目标', () => {
    useSearchStore.getState().requestJump({ view: 'welcome' });
    useSearchStore.getState().consume();
    expect(useSearchStore.getState().target).toBeNull();
  });

  it('重复 requestJump 覆盖旧目标', () => {
    useSearchStore.getState().requestJump({ view: 'welcome' });
    useSearchStore.getState().requestJump({ view: 'settings', settingsMenu: 'shortcuts' });
    expect(useSearchStore.getState().target).toEqual({
      view: 'settings',
      settingsMenu: 'shortcuts',
    });
  });
});
