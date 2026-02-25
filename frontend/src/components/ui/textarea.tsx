'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[120px] w-full rounded-lg border border-[hsl(240,5%,20%)] bg-[hsl(240,5%,10%)] px-4 py-3 text-sm text-[hsl(0,0%,98%)] placeholder:text-[hsl(240,5%,45%)] transition-all duration-300 input-glow focus:border-[hsl(187,100%,50%)] focus:ring-2 focus:ring-[hsl(187,100%,50%)/0.2] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
