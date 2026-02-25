'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, Clock, Brain, TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { MemoryCard } from '@/components/memory-card'
import { getStats, getMemories, type Memory, type Stats } from '@/lib/api'
import { getLocalMemories } from '@/lib/store'

const typeColors: Record<string, string> = {
  note: 'from-blue-500 to-cyan-500',
  person: 'from-pink-500 to-rose-500',
  task: 'from-amber-500 to-orange-500',
  idea: 'from-violet-500 to-purple-500',
  product: 'from-emerald-500 to-green-500',
  reference: 'from-slate-400 to-gray-500',
  conversation: 'from-indigo-500 to-blue-500',
}

export function VisualizeTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentMemories, setRecentMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [statsData, memoriesData] = await Promise.all([
        getStats(),
        getMemories(10, 0)
      ])
      setStats(statsData)
      setRecentMemories(memoriesData.results)
    } catch {
      // Fallback to local
      const local = getLocalMemories()
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      
      const typeCounts: Record<string, number> = {}
      local.forEach(m => {
        typeCounts[m.type] = (typeCounts[m.type] || 0) + 1
      })
      
      setStats({
        total: local.length,
        thisWeek: local.filter(m => new Date(m.timestamp) > weekAgo).length,
        typeCounts,
      })
      setRecentMemories(local.slice(-10).reverse())
    } finally {
      setLoading(false)
    }
  }

  const getMostCommonType = () => {
    if (!stats?.typeCounts) return '—'
    const entries = Object.entries(stats.typeCounts)
    if (entries.length === 0) return '—'
    return entries.sort((a, b) => b[1] - a[1])[0][0]
  }

  const getMaxCount = () => {
    if (!stats?.typeCounts) return 1
    return Math.max(...Object.values(stats.typeCounts), 1)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-[hsl(187,100%,50%)] border-t-transparent rounded-full"
        />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-8"
    >
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          value={stats?.total ?? 0}
          label="Total Memories"
          icon={<Brain className="w-6 h-6" />}
          delay={0}
        />
        <StatCard
          value={stats?.thisWeek ?? 0}
          label="This Week"
          icon={<Clock className="w-6 h-6" />}
          delay={0.1}
        />
        <StatCard
          value={getMostCommonType()}
          label="Most Common Type"
          icon={<TrendingUp className="w-6 h-6" />}
          delay={0.2}
        />
      </div>

      {/* Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Memory Types Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.typeCounts && Object.keys(stats.typeCounts).length > 0 ? (
            <div className="space-y-4">
              {Object.entries(stats.typeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count], index) => (
                  <motion.div
                    key={type}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm capitalize text-[hsl(240,5%,65%)]">
                        {type}
                      </span>
                      <span className="text-sm font-medium text-[hsl(187,100%,50%)]">
                        {count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[hsl(240,5%,10%)] overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full bg-gradient-to-r ${typeColors[type] || 'from-gray-500 to-gray-600'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / getMaxCount()) * 100}%` }}
                        transition={{ duration: 0.8, delay: index * 0.1 }}
                      />
                    </div>
                  </motion.div>
                ))}
            </div>
          ) : (
            <p className="text-center text-[hsl(240,5%,45%)] py-8">
              No memories yet. Start recording!
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Memories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Recent Memories
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentMemories.length > 0 ? (
            <div className="space-y-4">
              {recentMemories.map((memory, index) => (
                <MemoryCard key={memory.id} memory={memory} index={index} />
              ))}
            </div>
          ) : (
            <p className="text-center text-[hsl(240,5%,45%)] py-8">
              No memories yet. Start recording!
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
