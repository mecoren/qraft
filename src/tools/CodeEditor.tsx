/**
 * 文本编辑器工具 —— 入口
 *
 * 实际实现位于 code-editor-workspace/EditorWorkbench(VSCode 风格多文件工作区)。
 * 此处仅做 re-export,保持 `CodeEditorTool` 导出名与注册表契约不变,
 * 避免 registry.ts 与 tool-catalog.ts 的既有引用被破坏。
 */
export { EditorWorkbench as CodeEditorTool } from './code-editor-workspace/EditorWorkbench';
