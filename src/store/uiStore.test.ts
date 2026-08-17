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
