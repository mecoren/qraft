/**
 * Word(docx/docm)渲染器 —— 封装 docx-preview
 *
 * docx-preview 把 OOXML Word 文档渲染为 HTML + 内联样式,挂载到给定容器。
 * 本模块只做参数与生命周期封装,保持与渲染库的依赖隔离(便于测试 mock):
 * - `renderDocx`:一次性渲染到容器,返回清理函数(清空容器)。
 * - 字体:忽略 options.injection 深度定制,使用默认样式注入;渲染产生的
 *   <style> 与 <img> 均来自 ZIP 内资源,不经 DOMPurify(库自身转义文本
 *   节点;容器内不执行脚本 —— docx-preview 输出无 script 节点)。
 */
import type { Options } from 'docx-preview';

/** docx-preview 的渲染选项(镜像库默认 + 固定适用项) */
const DOCX_OPTIONS: Partial<Options> = {
  className: 'office-docx',
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  useBase64URL: true,
  experimental: false,
};

/**
 * 渲染 docx 字节到容器;返回清理函数(卸载时清空容器)。
 * 渲染失败(文件损坏 / 非法 ZIP)抛出 Error,由调用方展示错误态。
 */
export async function renderDocx(container: HTMLElement, bytes: Uint8Array): Promise<() => void> {
  const { renderAsync } = await import('docx-preview');
  await renderAsync(new Blob([new Uint8Array(bytes)]), container, undefined, DOCX_OPTIONS);
  return () => {
    container.innerHTML = '';
  };
}
