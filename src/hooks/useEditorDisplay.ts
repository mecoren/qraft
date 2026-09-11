import { useMemo } from 'react';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_EDITOR_DISPLAY, type EditorDisplayConfig } from '@/types/config';

/**
 * 归一化编辑器展示配置:合并持久化值与默认值。
 *
 * 旧版本 config.json 的 editor.display 可能缺失或部分字段缺失(用户只改过
 * 其中一项时,setConfig 按路径写入的仍是完整对象,但早期数据/手写数据不保证),
 * 统一回填 `DEFAULT_EDITOR_DISPLAY`,保证消费方拿到的每个字段都是有效值,
 * 不需要再逐处写 `?? 默认值` 兜底。
 */
export function normalizeEditorDisplay(
  raw: EditorDisplayConfig | undefined,
): Required<EditorDisplayConfig> {
  return {
    bracketPairColorization:
      raw?.bracketPairColorization ?? DEFAULT_EDITOR_DISPLAY.bracketPairColorization,
    stickyScroll: raw?.stickyScroll ?? DEFAULT_EDITOR_DISPLAY.stickyScroll,
    indentationGuides: raw?.indentationGuides ?? DEFAULT_EDITOR_DISPLAY.indentationGuides,
    wordWrap: raw?.wordWrap ?? DEFAULT_EDITOR_DISPLAY.wordWrap,
    minimap: raw?.minimap ?? DEFAULT_EDITOR_DISPLAY.minimap,
    fontSize: raw?.fontSize ?? DEFAULT_EDITOR_DISPLAY.fontSize,
    tabSize: raw?.tabSize ?? DEFAULT_EDITOR_DISPLAY.tabSize,
  };
}

/**
 * 订阅设置中的编辑器展示配置(括号着色 / 吸顶滚动 / 缩进参考线 /
 * 自动换行默认 / 缩略图 / 字号 / 缩进宽度),供 CodeEditor 的 Monaco options
 * 与工作台的新建 Tab 默认值消费。切换设置项即触发消费方重渲染,
 * 已挂载编辑器实例由 @monaco-editor/react 检测 options 变化热更新。
 */
export function useEditorDisplay(): Required<EditorDisplayConfig> {
  const display = useConfigStore((s) => s.config?.editor?.display);
  // normalize 纯字面量合并,开销可忽略;useMemo 避免每次渲染产生新引用
  return useMemo(() => normalizeEditorDisplay(display), [display]);
}
