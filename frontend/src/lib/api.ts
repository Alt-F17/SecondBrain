export interface Memory {
  id: string
  type: string
  content: string
  tags: string[]
  timestamp: string
  embedding?: number[] | null
  score?: number
}

export interface Stats {
  total: number
  thisWeek: number
  typeCounts: Record<string, number>
  chromaVectors?: number
  oldestMemory?: number | null
}

export interface HealthCheck {
  status: string
  chroma: boolean
  openai: boolean
  timestamp: string
}

const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('config')
    if (stored) {
      const config = JSON.parse(stored)
      return config.apiUrl || 'http://localhost:3000'
    }
  }
  return 'http://localhost:3000'
}

export async function checkHealth(): Promise<HealthCheck> {
  const response = await fetch(`${getApiUrl()}/api/health`)
  if (!response.ok) throw new Error('Health check failed')
  return response.json()
}

export async function saveMemory(memory: Omit<Memory, 'embedding'>): Promise<Memory> {
  const response = await fetch(`${getApiUrl()}/api/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory)
  })
  if (!response.ok) throw new Error('Failed to save memory')
  return response.json()
}

export async function searchMemories(query: string, limit = 10): Promise<Memory[]> {
  const response = await fetch(`${getApiUrl()}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit })
  })
  if (!response.ok) throw new Error('Search failed')
  return response.json()
}

export async function getMemories(limit = 100, offset = 0): Promise<{ total: number; results: Memory[] }> {
  const response = await fetch(`${getApiUrl()}/api/memories?limit=${limit}&offset=${offset}`)
  if (!response.ok) throw new Error('Failed to get memories')
  return response.json()
}

export async function deleteMemory(id: string): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/memories/${id}`, {
    method: 'DELETE'
  })
  if (!response.ok) throw new Error('Failed to delete memory')
}

export async function getStats(): Promise<Stats> {
  const response = await fetch(`${getApiUrl()}/api/stats`)
  if (!response.ok) throw new Error('Failed to get stats')
  return response.json()
}

export async function exportData(): Promise<{ memories: Memory[] }> {
  const response = await fetch(`${getApiUrl()}/api/export`)
  if (!response.ok) throw new Error('Export failed')
  return response.json()
}

export async function transcribeAudio(audioBlob: Blob, apiKey: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('model', 'whisper-1')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  })

  if (!response.ok) throw new Error('Transcription failed')
  const data = await response.json()
  return data.text
}
