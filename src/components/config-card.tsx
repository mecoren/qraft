/**
 * 配置卡片 —— DevToys 风格「配置」区共享组件
 *
 * 用法:
 * <ConfigSection>
 *   <ConfigRow icon={ArrowLeftRight} label="转换" hint="选择转换方向">...控件...</ConfigRow>
 * </ConfigSection>
 */

import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ConfigSection({
  title,
  headerHint,
  children,
  className,
  searchAnchor,
  headerAction,
  headerTestId,
}: {
  /** 卡片标题;缺省用「配置」;传入空字符串时不渲染标题文字(仅保留无障碍名称) */
  title?: string;
  /** 紧凑标题行内的说明文字(标题右侧、动作区左侧,truncate 单行);收拢各配置行重复的 hint */
  headerHint?: string;
  children: ReactNode;
  className?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
  /** 标题行右侧动作(如折叠/展开切换按钮);传入时标题恒渲染(独立紧凑标题行) */
  headerAction?: ReactNode;
  /** 标题行的 data-testid(配合 headerAction 断言) */
  headerTestId?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('chrome.config_card.title');
  if (headerAction) {
    // 紧凑标题行变体:标题(+可选说明)居左 + 动作居右,整行 h-7 低于配置行
    // (py-2.5),带下边线与后续行分隔;适合「配置 + 展开/收起」这类顶栏
    return (
      <section
        aria-label={resolvedTitle || t('chrome.config_card.title')}
        className={className}
        data-search-anchor={searchAnchor}
      >
        <div
          className="flex h-7 items-center justify-between gap-x-2 border-b border-border px-3"
          data-testid={headerTestId}
        >
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-xs font-semibold text-foreground">{resolvedTitle}</h2>
            {headerHint ? (
              <span className="truncate text-xs text-muted-foreground">{headerHint}</span>
            ) : null}
          </div>
          {headerAction}
        </div>
        <div className="divide-y divide-border border-b border-border">{children}</div>
      </section>
    );
  }
  return (
    <section
      aria-label={resolvedTitle || t('chrome.config_card.title')}
      className={className}
      data-search-anchor={searchAnchor}
    >
      {resolvedTitle ? (
        <h2 className="mb-1.5 text-body-sm font-semibold">{resolvedTitle}</h2>
      ) : null}
      {/* 扁平配置区:作为工具 shell 卡片内的顶部区块,不再自带独立卡片外观
          (圆角/边框/阴影由外层 shell 提供,这里只用 border-b 与主内容区分隔) */}
      <div className="divide-y divide-border border-b border-border">{children}</div>
    </section>
  );
}

export function ConfigRow({
  icon: Icon,
  label,
  hint,
  caption,
  captionHint,
  children,
  className,
  labelClassName,
  searchAnchor,
  testId,
}: {
  icon?: LucideIcon;
  /** 行小标题(左侧提示);缺省时控件列占满整行 */
  label?: string;
  hint?: string;
  /** 微标签模式:仅传入 caption(不传 label)时,左侧渲染 96px 定宽小标签列 */
  caption?: string;
  /**
   * caption 微标签的悬浮说明(title 悬浮提示,样式由全局 title 接管层统一渲染):
   * caption 模式标签列只有 96px,放不下完整描述,悬浮标签时展示该行说明。
   */
  captionHint?: string;
  children?: ReactNode;
  className?: string;
  /**
   * 追加到 label 列的类,用于同一工具内多行 label 定宽对齐(如 w-64)。
   * 传入时默认的 `flex-1` 会被去掉(flex-1 的简写 `flex:1 1 0%` 在 utilities
   * 顺序上压过 shrink-0 / flex-none,无法靠叠类覆盖),宽度语义由所传类接管。
   */
  labelClassName?: string;
  /** 全局搜索锚点(完整值 `${toolId}:${key}`),用于搜索跳转定位高亮 */
  searchAnchor?: string;
  /** 行根节点 data-testid(布局断言用) */
  testId?: string;
}): JSX.Element {
  // 左右布局的弹性契约(参照 ListComparer 的「左描述右控件」形态):
  // - label 列默认 flex-1(吃剩余宽度,描述消息完整显示、自动换行),min-w-56(224px)
  //   是防压零宽下限——控件再多也压不瘪左侧描述(曾被压成 0 宽逐字竖排);
  // - labelClassName 提供时去掉 flex-1:label 列宽随控件量浮动(满宽按钮行被
  //   压到下限、稀疏控件行反而更宽),要五行左侧等宽对齐就传定宽类(如 w-64);
  // - 控件列 basis-auto + 允许收缩:空间不足时先向 label 借宽,借到下限后
  //   改由控件列内部 flex-wrap 换行,行高自然增高,divide-y 照常分隔;
  // - 控件列 justify-end:窄控件(Select / Switch)沿右缘对齐,与 label 之间
  //   由弹性空隙自然隔开;宽按钮组占满列后从左缘起铺,换行后排首对齐。
  // - caption 微标签模式(仅传 caption 不传 label):定宽 w-24 小标签列,
  //   控件列改 justify-start 占满剩余宽度——适合「一排多组按钮」的密集场景,
  //   描述性 hint 交给 Section 标题行,行内只留分组名。
  const labelNode =
    label !== undefined ? (
      <div
        className={cn(
          labelClassName
            ? 'flex min-w-0 items-center gap-2'
            : 'flex min-w-56 flex-1 items-center gap-2',
          labelClassName,
        )}
      >
        {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
        <div className="min-w-0">
          <div className="text-body-sm">{label}</div>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      </div>
    ) : caption !== undefined ? (
      <div className="flex w-24 shrink-0 items-center gap-1.5">
        {Icon ? <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        {/* 悬浮说明挂在可见文本上(title 由全局接管层渲染成统一样式浮层),
            而不是外层容器——避免悬停整块空白区域也弹提示 */}
        <span className="truncate text-xs font-medium text-muted-foreground" title={captionHint}>
          {caption}
        </span>
      </div>
    ) : null;
  return (
    <div
      className={cn('flex items-center gap-x-4 gap-y-2 px-4 py-2.5', className)}
      data-search-anchor={searchAnchor}
      data-testid={testId}
    >
      {labelNode}
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2',
          caption !== undefined && label === undefined ? 'justify-start' : 'justify-end',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 标题栏内动作按钮,与 CodeEditor 工具栏风格一致。
 * 用途:编辑器工具栏中的「执行 / 生成 / 测试」等主操作按钮
 * (参考 Base64Codec / JsonFormatter 的同名本地实现,收敛于此共享)。
 */
export function HeaderAction({
  onClick,
  disabled,
  testId,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[26px] items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
