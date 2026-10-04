import * as React from "react"
import { cn } from "cn"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

/**
 * The browser's own <select>, in the colours of the theme (5.2). One element
 * and no wrapper, so it lays out exactly where the bare one did; the browser
 * draws the list and the arrow, in the theme's `color-scheme`. shadcn's
 * native-select wraps the element in a `w-fit` box with its own arrow — that
 * would shrink every select that stretches in a column today.
 */
function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <select
      data-slot="native-select"
      data-size={size}
      className={cn(
        "h-9 rounded-md border border-input bg-background px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-8",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
