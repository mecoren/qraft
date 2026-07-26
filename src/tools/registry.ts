import type { ComponentType } from 'react';
import type { ToolMetadata } from '@/types/tool';

/**
 * 工具 UI 组件的 props 契约。
 * 由 ToolPanel 在挂载工具组件时注入。
 */
export interface ToolProps {
  toolId: string;
  metadata: ToolMetadata;
}

type ToolComponent = ComponentType<ToolProps>;

// 全局 UI 工具注册表:toolId → React 组件。
// 与 Rust 端的 ToolRegistry 不同,这里只负责 UI 组件查找。
const REGISTRY = new Map<string, ToolComponent>();

/**
 * 注册工具 UI 组件。每个工具模块在文件末尾调用一次。
 * @param toolId 与 Rust 端 ToolMetadata.id 严格一致
 * @param component 渲染该工具界面的 React 组件
 */
export function registerTool(toolId: string, component: ToolComponent): void {
  REGISTRY.set(toolId, component);
}

/**
 * 按 toolId 查找已注册的 UI 组件。
 * @returns 找不到时返回 null,由 ToolPanel 回退到默认提示
 */
export function getToolComponent(toolId: string): ToolComponent | null {
  return REGISTRY.get(toolId) ?? null;
}

/**
 * 清空注册表(仅测试用,避免用例间污染)。
 */
export function clearRegistry(): void {
  REGISTRY.clear();
}

// —— 工具注册(每个工具模块在此 register)——
import { JsonFormatter } from './JsonFormatter';
import { JsonMinifier } from './JsonMinifier';
import { Base64Codec } from './Base64Codec';
import { UrlCodec } from './UrlCodec';
import { JwtParser } from './JwtParser';
import { UuidGenerator } from './UuidGenerator';
import { HashCalculator } from './HashCalculator';
import { TimestampConverter } from './TimestampConverter';
import { ColorConverter } from './ColorConverter';
import { RegexTester } from './RegexTester';

registerTool('json_formatter', JsonFormatter);
registerTool('json_minifier', JsonMinifier);
registerTool('base64_codec', Base64Codec);
registerTool('url_codec', UrlCodec);
registerTool('jwt_parser', JwtParser);
registerTool('uuid_generator', UuidGenerator);
registerTool('hash_calculator', HashCalculator);
registerTool('timestamp_converter', TimestampConverter);
registerTool('color_converter', ColorConverter);
registerTool('regex_tester', RegexTester);
