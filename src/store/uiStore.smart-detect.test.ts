import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore Smart Detection 状态', () => {
  beforeEach(() => {
    useUiStore.setState({
      smartDetectionEnabled: false,
      detectedTools: [],
      detectedText: '',
      detectDismissed: false,
    });
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

  it('setDetectedTools 写入探测结果与剪贴板原文', () => {
    const results = [{ toolId: 'jwt_parser', reason: 'chrome.detect.reason_jwt' }];
    useUiStore.getState().setDetectedTools(results, 'eyJhbGciOiJ9.eyJzdWIiOiIxIn0.sig');
    expect(useUiStore.getState().detectedTools).toEqual(results);
    expect(useUiStore.getState().detectedText).toBe('eyJhbGciOiJ9.eyJzdWIiOiIxIn0.sig');
  });

  it('setDetectedTools 不带原文时清空 detectedText', () => {
    useUiStore.setState({ detectedText: 'old' });
    useUiStore.getState().setDetectedTools([{ toolId: 'json_formatter', reason: 'x' }]);
    expect(useUiStore.getState().detectedText).toBe('');
  });

  it('新探测重置关闭态(下次聚焦重新提示)', () => {
    useUiStore.setState({ detectDismissed: true });
    useUiStore.getState().setDetectedTools([{ toolId: 'json_formatter', reason: 'x' }]);
    expect(useUiStore.getState().detectDismissed).toBe(false);
  });

  it('dismissDetect 置关闭态', () => {
    useUiStore.setState({ detectDismissed: false });
    useUiStore.getState().dismissDetect();
    expect(useUiStore.getState().detectDismissed).toBe(true);
  });
});
