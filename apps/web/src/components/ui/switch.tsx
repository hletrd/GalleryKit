"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

// AGG-C3-01 (cycle 3, DSGN3-MED-01): the touch-target retrofit bumped the
// Root to a 44 px box (min-h-11 / min-w-11) but left the thumb at size-5 with
// a fixed translate-x-5 travel, so the thumb never reached either edge of the
// 44 px track and every toggle read as "half-on". Fix: keep the 44 px tappable
// hit area on Root (still required by the touch-target audit) but render the
// VISIBLE switch as a normally-proportioned pill nested inside, with a thumb
// that travels the full visible track width via translate-x-[calc(100%-2px)]
// (width-relative, unlike the old fixed 20 px travel). The visible track is
// styled off Root's data-state via group-data-* (Root carries the `group`
// class and Radix sets data-state on it).
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group peer focus-visible:ring-ring/50 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-[box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* Visible track — normally-proportioned pill, centered in the 44 px hit area. */}
      <span
        data-slot="switch-track"
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative flex h-6 w-11 items-center rounded-full border border-transparent px-0.5 shadow-xs transition-colors",
          "bg-input dark:bg-input/80",
          "group-data-[state=checked]:bg-primary"
        )}
      >
        {/* Track is w-11 (44px) with px-0.5 → 40px inner; thumb is size-5
            (20px). Remaining travel = 40 − 20 = 20px = exactly 100% of the
            thumb's own width, so translate-x-full lands the thumb flush against
            the right edge (and translate-x-0 flush left). */}
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "bg-background pointer-events-none block size-5 rounded-full ring-0 shadow-lg transition-transform",
            "translate-x-0 data-[state=checked]:translate-x-full"
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
