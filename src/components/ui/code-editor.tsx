/**
 * Monaco 编辑器封装组件
 *
 * 职责:
 * - 封装 @monaco-editor/react 的 Editor 组件,提供统一的 API
 * - 监听 data-palette 属性变化,自动切换 Monaco 主题(vs / vs-dark)
 * - 提供 placeholder 占位符(Monaco 原生不支持,通过 overlay 实现)
 *
 * 主题映射:
 * - daylight(亮色)→ vs
 * - obsidian/deep-sea/twilight/emerald-night/custom(深色)→ vs-dark
 *
 * 设计说明:
 * - Monaco 通过 CDN 加载,避免 vite 打包体积膨胀
 * - 自动布局(automaticLayout)适配父容器尺寸变化
 * - 字体大小固定 13px,与 VS Code 默认一致
 */

import { useEffect, useState, type CSSProperties } from 'react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';

export interface CodeEditorProps {
  /** 当前文本值 */
  value: string;
  /** 文本变化回调 */
  onChange?: (value: string) => void;
  /** 语言模式,默认 plaintext */
  language?: 'json' | 'plaintext' | 'html' | 'css' | 'javascript' | 'typescript';
  /** 是否只读 */
  readOnly?: boolean;
  /** 占位符文本(空值时显示) */
  placeholder?: string;
  /** 自定义容器类名 */
  className?: string;
  /** 测试用 data-testid */
  'data-testid'?: string;
}

/** 深色调色板集合,其余视为亮色 */
const DARK_PALETTES = new Set([
  'obsidian',
  'deep-sea',
  'twilight',
  'emerald-night',
  'custom',
]);

/** 根据当前 data-palette 返回 Monaco 主题名 */
function getMonacoTheme(): string {
  const palette = document.documentElement.dataset.palette ?? 'daylight';
  return DARK_PALETTES.has(palette) ? 'vs-dark' : 'vs';
}

export function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  readOnly = false,
  placeholder,
  className,
  'data-testid': dataTestId,
}: CodeEditorProps) {
  // monacoTheme state:监听 data-palette 变化时更新,触发 Editor 重新渲染
  const [monacoTheme, setMonacoTheme] = useState<string>(() => getMonacoTheme());

  // 监听 <html> 的 data-palette 属性变化,同步 Monaco 主题
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMonacoTheme(getMonacoTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
    return () => observer.disconnect();
  }, []);

  // placeholder overlay 定位:Monaco 默认 lineNumbers 占据左侧约 50px
  const placeholderStyle: CSSProperties = {
    top: 4,
    left: 54,
    pointerEvents: 'none',
  };

  return (
    <div
      data-testid={dataTestId}
      data-slot="code-editor"
      className={cn(
        'relative min-h-[200px] h-full w-full overflow-hidden rounded-md border border-input',
        className,
      )}
    >
      <Editor
        value={value}
        language={language}
        theme={monacoTheme}
        onChange={(v) => onChange?.(v ?? '')}
        loading={
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            加载编辑器…
          </div>
        }
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: 2,
          renderWhitespace: 'selection',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          padding: { top: 8, bottom: 8 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
      {/* Placeholder overlay:空值时显示提示文本 */}
      {placeholder && !value && (
        <div
          aria-hidden
          className="absolute pointer-events-none text-muted-foreground text-[13px] font-mono opacity-70"
          style={placeholderStyle}
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}
