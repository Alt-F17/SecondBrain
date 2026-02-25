'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Settings, Wifi, WifiOff, Download, Trash2, Server, Key } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { checkHealth, exportData } from '@/lib/api'
import { getConfig, setConfig, getLocalMemories, setLocalMemories } from '@/lib/store'

export function ConfigTab() {
  const [apiUrl, setApiUrl] = useState('http://localhost:3000')
  const [openaiKey, setOpenaiKey] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const config = getConfig()
    setApiUrl(config.apiUrl)
    setOpenaiKey(config.openaiKey)
    testConnection()
  }, [])

  const saveConfiguration = () => {
    setConfig({ apiUrl, openaiKey })
    toast('Configuration saved!', 'success')
    testConnection()
  }

  const testConnection = async () => {
    setChecking(true)
    try {
      await checkHealth()
      setIsConnected(true)
      toast('Connected to backend!', 'success')
    } catch {
      setIsConnected(false)
    } finally {
      setChecking(false)
    }
  }

  const handleExport = async () => {
    try {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `second-brain-export-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Data exported successfully!', 'success')
    } catch {
      // Fallback to local
      const memories = getLocalMemories()
      const blob = new Blob([JSON.stringify({ memories }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `second-brain-export-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Local data exported!', 'info')
    }
  }

  const handleClearData = () => {
    if (confirm('Are you sure? This will delete ALL local memories permanently!')) {
      setLocalMemories([])
      toast('All local data cleared', 'success')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            API Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)] flex items-center gap-2">
              <Server className="w-3 h-3" />
              Backend API URL
            </label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)] flex items-center gap-2">
              <Key className="w-3 h-3" />
              OpenAI API Key (for voice transcription)
            </label>
            <Input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <Button onClick={saveConfiguration} className="w-full">
            Save Configuration
          </Button>
        </CardContent>
      </Card>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isConnected ? (
              <Wifi className="w-5 h-5 text-[hsl(145,80%,50%)]" />
            ) : (
              <WifiOff className="w-5 h-5 text-[hsl(0,80%,60%)]" />
            )}
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-[hsl(240,5%,8%)] border border-[hsl(240,5%,15%)]">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-[hsl(145,80%,50%)]' : 'bg-[hsl(0,80%,60%)]'} ${isConnected ? 'animate-pulse' : ''}`} />
              <span className="text-sm">
                Backend API: {' '}
                <span className={isConnected ? 'text-[hsl(145,80%,50%)]' : 'text-[hsl(0,80%,60%)]'}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={testConnection}
              loading={checking}
            >
              Test
            </Button>
          </div>

          {!isConnected && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-[hsl(240,5%,45%)]"
            >
              Make sure the backend server is running: <code className="text-[hsl(187,100%,50%)]">npm start</code>
            </motion.p>
          )}
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Data Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleExport} className="flex-1">
              <Download className="w-4 h-4 mr-2" />
              Export All Data
            </Button>
            <Button variant="destructive" onClick={handleClearData} className="flex-1">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All Data
            </Button>
          </div>
          
          <p className="text-xs text-[hsl(240,5%,45%)] text-center">
            Export creates a JSON backup of all your memories
          </p>
        </CardContent>
      </Card>

      {/* Info */}
      <Card hover={false}>
        <CardContent className="py-6">
          <div className="text-center space-y-2">
            <h3 className="gradient-text text-lg font-semibold">Second Brain</h3>
            <p className="text-xs text-[hsl(240,5%,45%)]">
              Neural Memory System • Powered by Chroma DB
            </p>
            <p className="text-xs text-[hsl(240,5%,35%)]">
              Your memories are stored locally with vector embeddings for semantic search
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
