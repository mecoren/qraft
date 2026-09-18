/**
 * editorModelRegistry 单元测试 —— 池化 model 的释放边界
 *
 * 用注入的假 monaco 验证:disposePooledModels 只清 `inmemory://tab/*`
 * 的池化 model,其它来源(diff 视图、临时 buffer 等)的 model 不受误伤。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMonacoInstance, disposePooledModels } from './editorModelRegistry';

function fakeModel(uriStr: string) {
  return { uri: { toString: () => uriStr }, dispose: vi.fn() };
}

function makeMonaco(models: ReturnType<typeof fakeModel>[]) {
  return {
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    editor: {
      getModels: () => models,
      getModel: (uri: { toString(): string }) =>
        models.find((m) => m.uri.toString() === uri.toString()) ?? null,
    },
  } as unknown as typeof import('monaco-editor');
}

describe('disposePooledModels', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('monaco 未注入时静默 no-op', () => {
    expect(() => disposePooledModels()).not.toThrow();
  });

  it('释放全部池化 model,保留其它来源的 model', async () => {
    const pooledA = fakeModel('inmemory://tab/tab-a');
    const pooledB = fakeModel('inmemory://tab/tab-b');
    const other = fakeModel('inmemory://model/1');
    const diff = fakeModel('file:///some/file.ts');
    registerMonacoInstance(makeMonaco([pooledA, pooledB, other, diff]));

    disposePooledModels();

    expect(pooledA.dispose).toHaveBeenCalled();
    expect(pooledB.dispose).toHaveBeenCalled();
    expect(other.dispose).not.toHaveBeenCalled();
    expect(diff.dispose).not.toHaveBeenCalled();
  });
});
