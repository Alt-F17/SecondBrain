'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', loading, children, disabled, ...props }, ref) => {
    const baseStyles = 'relative inline-flex items-center justify-center font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 btn-shine cursor-pointer'
    
    const variants = {
      default: 'bg-gradient-to-r from-[hsl(187,100%,50%)] to-[hsl(270,100%,50%)] text-black hover:shadow-lg hover:shadow-[hsl(187,100%,50%)/0.3] hover:-translate-y-0.5',
      secondary: 'bg-[hsl(240,5%,15%)] border border-[hsl(240,5%,20%)] text-[hsl(0,0%,98%)] hover:border-[hsl(187,100%,50%)] hover:shadow-lg hover:shadow-[hsl(187,100%,50%)/0.2]',
      destructive: 'bg-[hsl(0,80%,60%)] text-white hover:bg-[hsl(0,80%,50%)]',
      ghost: 'hover:bg-[hsl(240,5%,15%)] text-[hsl(240,5%,65%)] hover:text-[hsl(0,0%,98%)]',
      outline: 'border border-[hsl(240,5%,20%)] bg-transparent hover:border-[hsl(187,100%,50%)] text-[hsl(0,0%,98%)]',
    }
    
    const sizes = {
      default: 'h-11 px-6 py-2 text-sm rounded-lg',
      sm: 'h-9 px-4 text-xs rounded-md',
      lg: 'h-12 px-8 text-base rounded-lg',
      icon: 'h-10 w-10 rounded-lg',
    }

    return (
      <motion.button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        whileTap={{ scale: 0.98 }}
        type="button"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...(props as any)}
      >
        {loading ? (
          <motion.div
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        ) : (
          children
        )}
      </motion.button>
    )
  }
)
Button.displayName = 'Button'

export { Button }
