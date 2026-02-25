'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Mic, Search, BarChart3, Settings } from 'lucide-react'
import { AnimatedBackground } from '@/components/ui/animated-background'
import { Tabs } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/toast'
import { RecordTab } from '@/components/record-tab'
import { SearchTab } from '@/components/search-tab'
import { VisualizeTab } from '@/components/visualize-tab'
import { ConfigTab } from '@/components/config-tab'

const tabs = [
  { id: 'record', label: 'Record', icon: <Mic className="w-4 h-4" /> },
  { id: 'search', label: 'Search', icon: <Search className="w-4 h-4" /> },
  { id: 'visualize', label: 'Visualize', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'config', label: 'Config', icon: <Settings className="w-4 h-4" /> },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState('record')

  return (
    <>
      <AnimatedBackground />
      <Toaster />
      
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Header */}
          <motion.header
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <motion.div
              className="inline-flex items-center justify-center mb-4"
              animate={{ 
                filter: [
                  'drop-shadow(0 0 10px hsl(187 100% 50% / 0.3))',
                  'drop-shadow(0 0 20px hsl(187 100% 50% / 0.5))',
                  'drop-shadow(0 0 10px hsl(187 100% 50% / 0.3))',
                ]
              }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Brain className="w-12 h-12 text-[hsl(187,100%,50%)]" />
            </motion.div>
            
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
              <span className="gradient-text">SECOND BRAIN</span>
            </h1>
            
            <p className="text-sm uppercase tracking-[0.3em] text-[hsl(240,5%,45%)]">
              Neural Memory System
            </p>
          </motion.header>

          {/* Tabs */}
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === 'record' && <RecordTab />}
              {activeTab === 'search' && <SearchTab />}
              {activeTab === 'visualize' && <VisualizeTab />}
              {activeTab === 'config' && <ConfigTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
