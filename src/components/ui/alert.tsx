import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  // grid 双列布局:左图标,右文本;与 shadcn Alert 风格一致
  'relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border p-4 [&>svg]:col-start-1 [&>svg]:row-span-2 [&>svg]:mt-0.5 [&>svg]:text-foreground [&_[data-slot=alert-title]]:col-start-2 [&_[data-slot=alert-title]]:row-start-1 [&_[data-slot=alert-title]]:font-medium [&_[data-slot=alert-title]]:leading-none [&_[data-slot=alert-title]]:tracking-tight [&_[data-slot=alert-description]]:col-start-2 [&_[data-slot=alert-description]]:row-start-2 [&_[data-slot=alert-description]]:text-sm [&_[data-slot=alert-description]]:text-muted-foreground [&_[data-slot=alert-description]]:[&_p]:leading-relaxed',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'border-destructive/50 text-destructive [&>svg]:text-destructive dark:border-destructive',
        info: 'border-primary/40 text-foreground [&>svg]:text-primary bg-primary/5',
        success:
          'border-success/50 text-foreground [&>svg]:text-success bg-success/5',
        warning:
          'border-warning/50 text-foreground [&>svg]:text-warning bg-warning/5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    data-slot="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} data-slot="alert-title" className={cn(className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="alert-description" className={cn(className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };