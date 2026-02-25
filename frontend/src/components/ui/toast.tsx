'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

let toastId = 0
let listeners: ((toasts: Toast[]) => void)[] = []
let toasts: Toast[] = []

function emitChange() {
  listeners.forEach((listener) => listener([...toasts]))
}

export function toast(message: string, type: ToastType = 'info') {
  const id = String(++toastId)
  toasts = [...toasts, { id, message, type }]
  emitChange()
  
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emitChange()
  }, 4000)
}

export function Toaster() {
  const [currentToasts, setCurrentToasts] = useState<Toast[]>([])

  useEffect(() => {
    listeners.push(setCurrentToasts)
    return () => {
      listeners = listeners.filter((l) => l !== setCurrentToasts)
    }
  }, [])

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-[hsl(145,80%,50%)]" />,
    error: <AlertCircle className="w-5 h-5 text-[hsl(0,80%,60%)]" />,
    info: <Info className="w-5 h-5 text-[hsl(187,100%,50%)]" />,
  }

  const backgrounds = {
    success: 'border-[hsl(145,80%,50%)/0.3] bg-[hsl(145,80%,50%)/0.1]',
    error: 'border-[hsl(0,80%,60%)/0.3] bg-[hsl(0,80%,60%)/0.1]',
    info: 'border-[hsl(187,100%,50%)/0.3] bg-[hsl(187,100%,50%)/0.1]',
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      <AnimatePresence mode="popLayout">
        {currentToasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm ${backgrounds[t.type]}`}
          >
            {icons[t.type]}
            <span className="text-sm text-[hsl(0,0%,98%)]">{t.message}</span>
            <button
              onClick={() => {
                toasts = toasts.filter((toast) => toast.id !== t.id)
                emitChange()
              }}
              className="ml-2 text-[hsl(240,5%,65%)] hover:text-[hsl(0,0%,98%)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
