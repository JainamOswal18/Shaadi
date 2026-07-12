"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-3 select-none">
        <SliderPrimitive.Track className="relative h-2 w-full grow rounded-full bg-secondary">
          <SliderPrimitive.Indicator className="absolute rounded-full bg-marigold" />
          <SliderPrimitive.Thumb className="block size-5 rounded-full border-2 border-marigold bg-card shadow-sm transition-transform focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-110" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
