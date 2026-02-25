'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Loader2, Brain } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MemoryCard } from '@/components/memory-card'
import { toast } from '@/components/ui/toast'
import { searchMemories, deleteMemory, type Memory } from '@/lib/api'
import { getLocalMemories } from '@/lib/store'

export function SearchTab() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Memory[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return

    setSearching(true)
    setHasSearched(true)
    
    try {
      const data = await searchMemories(query.trim())
      setResults(data)
    } catch {
      // Fallback to local search
      const local = getLocalMemories()
      const filtered = local.filter(m =>
        m.content.toLowerCase().includes(query.toLowerCase()) ||
        m.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
      )
      setResults(filtered)
      toast('Searched locally (backend unavailable)', 'info')
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMemory(id)
      setResults(prev => prev.filter(m => m.id !== id))
      toast('Memory deleted', 'success')
    } catch {
      toast('Failed to delete memory', 'error')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <div className="relative">
        <Input
          type="text"
          placeholder="Search your memories... (semantic search)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-12 h-14 text-base"
        />
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(240,5%,45%)]" />
        
        {searching && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(187,100%,50%)] animate-spin" />
        )}
      </div>

      <AnimatePresence mode="wait">
        {searching ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-[hsl(240,5%,45%)]"
          >
            <div className="relative">
              <Brain className="w-16 h-16 text-[hsl(187,100%,50%)]" />
              <motion.div
                className="absolute inset-0"
                animate={{ 
                  boxShadow: [
                    '0 0 20px hsl(187 100% 50% / 0.3)',
                    '0 0 40px hsl(187 100% 50% / 0.5)',
                    '0 0 20px hsl(187 100% 50% / 0.3)',
                  ]
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ borderRadius: '50%' }}
              />
            </div>
            <p className="mt-4 text-sm">Searching neural pathways...</p>
          </motion.div>
        ) : hasSearched && results.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-[hsl(240,5%,45%)]"
          >
            <Search className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">No memories found</p>
            <p className="text-sm mt-1">Try a different search term</p>
          </motion.div>
        ) : results.length > 0 ? (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <p className="text-sm text-[hsl(240,5%,65%)]">
              Found {results.length} memor{results.length === 1 ? 'y' : 'ies'}
            </p>
            {results.map((memory, index) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onDelete={handleDelete}
                index={index}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="initial"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-[hsl(240,5%,45%)]"
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Brain className="w-20 h-20 text-[hsl(187,100%,50%)/0.5]" />
            </motion.div>
            <p className="text-lg mt-4">Enter a query to search your memories</p>
            <p className="text-sm mt-1 text-[hsl(240,5%,35%)]">
              Semantic search understands meaning, not just keywords
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
