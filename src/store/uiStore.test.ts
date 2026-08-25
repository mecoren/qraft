import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './uiStore';

beforeEach(() => {
  useUiStore.setState({
    view: 'tool',
    sidebarCollapsed: false,
    favorites: [],
    recents: [],
    expandedCategories: [],
  });
});

describe('uiStore.moveFavorite', () => {
  it('将已收藏工具上移一位', () => {
    useUiStore.setState({ favorites: ['a', 'b', 'c'] });
    useUiStore.getState().moveFavorite('b', 'up');
    expect(useUiStore.getState().favorites).toEqual(['b', 'a', 'c']);
  });

  it('将已收藏工具下移一位', () => {
    useUiStore.setState({ favorites: ['a', 'b', 'c'] });
    useUiStore.getState().moveFavorite('b', 'down');
    expect(useUiStore.getState().favorites).toEqual(['a', 'c', 'b']);
  });

  it('首项上移保持原顺序(越界安全)', () => {
    useUiStore.setState({ favorites: ['a', 'b'] });
    useUiStore.getState().moveFavorite('a', 'up');
    expect(useUiStore.getState().favorites).toEqual(['a', 'b']);
  });

  it('末项下移保持原顺序(越界安全)', () => {
    useUiStore.setState({ favorites: ['a', 'b'] });
    useUiStore.getState().moveFavorite('b', 'down');
    expect(useUiStore.getState().favorites).toEqual(['a', 'b']);
  });

  it('对未收藏工具调用不改变顺序', () => {
    useUiStore.setState({ favorites: ['a', 'b'] });
    useUiStore.getState().moveFavorite('x', 'up');
    expect(useUiStore.getState().favorites).toEqual(['a', 'b']);
  });
});

describe('uiStore.toggleFavorite', () => {
  it('收藏普通工具与取消收藏', () => {
    useUiStore.getState().toggleFavorite('base64_codec');
    expect(useUiStore.getState().favorites).toEqual(['base64_codec']);
    useUiStore.getState().toggleFavorite('base64_codec');
    expect(useUiStore.getState().favorites).toEqual([]);
  });

  it('固定的文本编辑器不可收藏', () => {
    useUiStore.getState().toggleFavorite('text_editor');
    expect(useUiStore.getState().favorites).toEqual([]);
    // 已在收藏列表中(旧数据)时同样可被移除
    useUiStore.setState({ favorites: ['text_editor'] });
    useUiStore.getState().toggleFavorite('text_editor');
    expect(useUiStore.getState().favorites).toEqual([]);
  });
});
