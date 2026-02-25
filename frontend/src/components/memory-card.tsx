'use client'

import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import type { Memory } from '@/lib/api'

interface MemoryCardProps {
  memory: Memory
  onDelete?: (id: string) => void
  index?: number
}

const typeColors: Record<string, string> = {
  note: 'from-blue-500 to-cyan-500',
  person: 'from-pink-500 to-rose-500',
  task: 'from-amber-500 to-orange-500',
  idea: 'from-violet-500 to-purple-500',
  product: 'from-emerald-500 to-green-500',
  reference: 'from-slate-400 to-gray-500',
  conversation: 'from-indigo-500 to-blue-500',
}

export function MemoryCard({ memory, onDelete, index = 0 }: MemoryCardProps) {
  const gradientClass = typeColors[memory.type] || typeColors.note

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="memory-card group relative rounded-xl border border-[hsl(240,5%,15%)] bg-[hsl(0,0%,5%)] p-5 transition-all duration-300 hover:border-[hsl(187,100%,50%)/0.5] hover:translate-x-1"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <span className={`inline-block px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white rounded-full bg-gradient-to-r ${gradientClass}`}>
              {memory.type}
            </span>
            <span className="text-xs text-[hsl(240,5%,45%)]">
              {formatRelativeTime(memory.timestamp)}
            </span>
            {memory.score !== undefined && (
              <span className="text-xs text-[hsl(187,100%,50%)] font-mono">
                {Math.round(memory.score * 100)}% match
              </span>
            )}
          </div>
          
          <p className="text-[hsl(0,0%,90%)] leading-relaxed">
            {memory.content}
          </p>
          
          {memory.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-xs rounded-md bg-[hsl(240,5%,12%)] text-[hsl(240,5%,65%)] border border-[hsl(240,5%,20%)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        
        {onDelete && (
          <button
            onClick={() => onDelete(memory.id)}
            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-[hsl(240,5%,45%)] hover:text-[hsl(0,80%,60%)] hover:bg-[hsl(0,80%,60%)/0.1] transition-all duration-200"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}
