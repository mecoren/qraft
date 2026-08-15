import type { JSX } from 'react';

interface LogoProps {
  className?: string;
}

/**
 * 应用品牌 Logo —— IDE 窗口+代码符号(与 assets/app-icon.svg 同一设计语言)
 *
 * 设计:圆角矩形外框(描边) + 内容区 `</>` 代码符号。
 * 完整版(含标题栏、标签、圆点)仅在主图标 1024×1024 下保留;
 * 标题栏 size-4 ≈ 16px 下细节会糊,因此应用内 Logo 简化为「窗口+代码」核心语义。
 *
 * 圆角比例与项目 UI 卡片一致(`--radius-lg=8px` 在 120 viewBox 下约 11px)。
 * `stroke="currentColor"` 跟随调用方文字颜色,适配亮/暗主题。
 */
export function Logo({ className }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="9" y="9" width="102" height="102" rx="11" ry="11" strokeWidth="9" />
      <g strokeWidth="8">
        <path d="M 39 38 L 25 60 L 39 82" />
        <path d="M 70 36 L 50 84" />
        <path d="M 81 38 L 95 60 L 81 82" />
      </g>
    </svg>
  );
}