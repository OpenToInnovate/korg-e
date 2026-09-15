/* eslint-disable react-refresh/only-export-components -- buttonVariants is intentionally exported for reuse */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent text-sm font-semibold transition-[transform,background-color,border-color,box-shadow,color] duration-[var(--dur-short2)] ease-[var(--ease-standard)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-[4px] focus-visible:ring-ring/20 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[var(--shadow-1)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-[var(--shadow-1)] hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border/70 bg-background/60 hover:border-primary/35 hover:bg-accent/70 hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "border-border/60 bg-secondary/85 text-secondary-foreground hover:bg-secondary",
        ghost: "border-transparent text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-8 gap-1 rounded-full px-2.5 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 rounded-full gap-1.5 px-4 sm:h-9 sm:px-3.5 has-[>svg]:px-3",
        lg: "h-12 rounded-full px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-8 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11 sm:size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
