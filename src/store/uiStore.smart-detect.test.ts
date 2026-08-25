import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore Smart Detection 状态', () => {
  beforeEach(() => {
    useUiStore.setState({ smartDetectionEnabled: false, detectedTools: [] });
  });

  it('开关默认关闭(安全不变量:默认零剪贴板读取)', () => {
    expect(useUiStore.getState().smartDetectionEnabled).toBe(false);
    expect(useUiStore.getState().detectedTools).toEqual([]);
  });

  it('toggleSmartDetection 翻转开关', () => {
    useUiStore.getState().toggleSmartDetection();
    expect(useUiStore.getState().smartDetectionEnabled).toBe(true);
    useUiStore.getState().toggleSmartDetection();
    expect(useUiStore.getState().smartDetectionEnabled).toBe(false);
  });

  it('setDetectedTools 写入探测结果', () => {
    const results = [{ toolId: 'jwt_parser', reason: 'JWT 结构' }];
    useUiStore.getState().setDetectedTools(results);
    expect(useUiStore.getState().detectedTools).toEqual(results);
  });
});
