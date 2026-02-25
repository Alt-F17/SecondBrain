'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mb-8">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'relative px-6 py-3 text-sm font-medium uppercase tracking-wider transition-all duration-300',
            'rounded-lg border border-transparent',
            activeTab === tab.id
              ? 'text-[hsl(187,100%,50%)]'
              : 'text-[hsl(240,5%,65%)] hover:text-[hsl(0,0%,98%)]'
          )}
        >
          <span className="relative z-10 flex items-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
          
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 rounded-lg border border-[hsl(187,100%,50%)] bg-[hsl(187,100%,50%)/0.1]"
              style={{ boxShadow: '0 0 20px hsl(187 100% 50% / 0.2)' }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}
