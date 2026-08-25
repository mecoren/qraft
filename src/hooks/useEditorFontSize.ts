import { useEffect, useState } from 'react';
import { FONT_SIZE_CHANGED_EVENT, getEditorFontSize } from '@/lib/theme';

/**
 * 订阅设置中的字号档位,返回 Monaco 编辑器应使用的 fontSize/lineHeight(px)。
 *
 * 背景:Monaco 以绝对 px 布局,不跟随 root rem 缩放;设置面板切换字号档位时
 * applyFontSizeLevel 会广播 FONT_SIZE_CHANGED_EVENT,本 hook 据此重算并触发
 * 消费方重渲染(已挂载的编辑器实例由消费方经 editor.updateOptions 热更新)。
 */
export function useEditorFontSize(): { fontSize: number; lineHeight: number } {
  const [size, setSize] = useState(getEditorFontSize);
  useEffect(() => {
    const sync = () => setSize(getEditorFontSize());
    window.addEventListener(FONT_SIZE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(FONT_SIZE_CHANGED_EVENT, sync);
  }, []);
  return size;
}
