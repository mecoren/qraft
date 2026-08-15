/**
 * Breadcrumb —— shadcn 新纽约风格面包屑
 *
 * 语义结构(无障碍):
 * - Breadcrumb 用 <nav aria-label="breadcrumb"> 包裹
 * - BreadcrumbList 用 <ol> 作为有序列表
 * - BreadcrumbItem 用 <li>
 * - BreadcrumbLink 用 <a>(原生链接 / 客户端路由均可,通过 asChild 或 href)
 * - BreadcrumbPage 用 <span aria-current="page"> 标识当前项
 * - BreadcrumbSeparator 默认 <ChevronRight>(/ 默认 lucide 斜杠图标)
 *
 * 样式约定:
 * - 整体使用 text-muted-foreground,父容器可覆盖(参照 shadcn 文档默认)
 * - 链接 hover:text-foreground,当前页 text-foreground
 * - 各项 13px 紧凑、sm:gap 间距;分隔符 size-3.5 图标
 * - 与现有 dropdown-menu.tsx 风格一致:不依赖 tw-animate,仅 CSS token
 *
 * 注:shadcn Breadcrumb 不依赖 @radix-ui/react-breadcrumb(无对应 Radix 原语),
 * 由原生 nav/ol/li/a/span 构成,行为与 HTML 标准一致。
 */
import * as React from "react"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    /**
     * 根节点分隔符;用于二级面包屑路径的「面包屑 vs 当前页」分隔语义。
     * 默认为空字符串(与 shadcn 文档默认行为一致)。
     */
    separator?: React.ReactNode
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />)
Breadcrumb.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<"ol">
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center gap-1.5", className)}
    {...props}
  />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    /**
     * 是否以「当前页」语义渲染(给末项使用,无需 href);
     * 设 true 时变为不可点击的 span + aria-current="page"。
     */
    asChild?: boolean
  }
>(({ asChild, className, ...props }, ref) => {
  // 当前项 vs 链接:本组件不内置 asChild 切换,
  // 由调用方选用 BreadcrumbLink(可点击)或 BreadcrumbPage(不可点击)
  // —— 此处保留 asChild 字段以兼容 shadcn API 命名,但不消费它
  void asChild
  return (
    <a
      ref={ref}
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn("font-normal text-foreground", className)}
    {...props}
  />
))
BreadcrumbPage.displayName = "BreadcrumbPage"

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn("[&>svg]:size-3.5", className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    aria-hidden="true"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
  </span>
)
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis"

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}