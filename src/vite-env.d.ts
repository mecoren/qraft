/// <reference types="vite/client" />

/**
 * 应用版本号 —— 构建时由 Vite 从 package.json 的 version 字段注入。
 * 唯一数据源: package.json(经 scripts/bump-version.sh 同步后端配置)。
 */
declare const __APP_VERSION__: string;
