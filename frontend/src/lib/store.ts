'use client'

import type { Memory } from './api'

interface Config {
  apiUrl: string
  openaiKey: string
}

// Simple store without zustand for now (avoiding extra dep)
export function getConfig(): Config {
  if (typeof window === 'undefined') {
    return { apiUrl: 'http://localhost:3000', openaiKey: '' }
  }
  const stored = localStorage.getItem('config')
  if (stored) {
    return JSON.parse(stored)
  }
  return { apiUrl: 'http://localhost:3000', openaiKey: '' }
}

export function setConfig(config: Config): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('config', JSON.stringify(config))
  }
}

export function getLocalMemories(): Memory[] {
  if (typeof window === 'undefined') return []
  const stored = localStorage.getItem('memories')
  if (stored) {
    return JSON.parse(stored)
  }
  return []
}

export function setLocalMemories(memories: Memory[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('memories', JSON.stringify(memories))
  }
}

export function addLocalMemory(memory: Memory): void {
  const memories = getLocalMemories()
  memories.push(memory)
  setLocalMemories(memories)
}
