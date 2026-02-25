'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          className={cn(
            'flex h-11 w-full appearance-none rounded-lg border border-[hsl(240,5%,20%)] bg-[hsl(240,5%,10%)] px-4 py-2 pr-10 text-sm text-[hsl(0,0%,98%)] transition-all duration-300 input-glow focus:border-[hsl(187,100%,50%)] focus:ring-2 focus:ring-[hsl(187,100%,50%)/0.2] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          ref={ref}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(240,5%,45%)] pointer-events-none" />
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
