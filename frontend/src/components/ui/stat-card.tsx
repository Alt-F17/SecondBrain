'use client'

import { motion } from 'framer-motion'

interface StatCardProps {
  value: string | number
  label: string
  icon?: React.ReactNode
  delay?: number
}

export function StatCard({ value, label, icon, delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="relative group"
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[hsl(187,100%,50%)/0.2] to-[hsl(270,100%,50%)/0.2] opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
      <div className="relative rounded-xl border border-[hsl(240,5%,15%)] bg-[hsl(0,0%,5%)] p-6 text-center transition-all duration-300 hover:border-[hsl(187,100%,50%)/0.5]">
        {icon && (
          <div className="mb-3 flex justify-center text-[hsl(240,5%,65%)]">
            {icon}
          </div>
        )}
        <motion.div
          className="text-4xl font-bold gradient-text mb-2"
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', bounce: 0.4, delay: delay + 0.2 }}
        >
          {value}
        </motion.div>
        <div className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)]">
          {label}
        </div>
      </div>
    </motion.div>
  )
}
