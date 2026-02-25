'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Save, Sparkles, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { saveMemory, transcribeAudio } from '@/lib/api'
import { getConfig, addLocalMemory } from '@/lib/store'

const memoryTypes = [
  { value: 'note', label: '📝 General Note' },
  { value: 'person', label: '👤 Person Info' },
  { value: 'task', label: '✅ Task / Todo' },
  { value: 'idea', label: '💡 Idea' },
  { value: 'product', label: '🛍️ Product / Item' },
  { value: 'reference', label: '📚 Reference' },
  { value: 'conversation', label: '💬 Conversation' },
]

export function RecordTab() {
  const [type, setType] = useState('note')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const handleSave = async () => {
    if (!content.trim()) {
      toast('Please enter memory content', 'error')
      return
    }

    setSaving(true)
    try {
      const memory = {
        id: Date.now().toString(),
        type,
        content: content.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        timestamp: new Date().toISOString(),
      }

      const saved = await saveMemory(memory)
      addLocalMemory(saved)
      
      toast('Memory saved successfully!', 'success')
      setContent('')
      setTags('')
    } catch {
      // Fallback to local only
      const memory = {
        id: Date.now().toString(),
        type,
        content: content.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        timestamp: new Date().toISOString(),
      }
      addLocalMemory(memory)
      toast('Saved locally (backend unavailable)', 'info')
      setContent('')
      setTags('')
    } finally {
      setSaving(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach(track => track.stop())
        
        setTranscribing(true)
        try {
          const config = getConfig()
          if (!config.openaiKey) {
            toast('OpenAI API key not configured', 'error')
            return
          }
          const text = await transcribeAudio(audioBlob, config.openaiKey)
          setTranscript(text)
          toast('Transcription complete!', 'success')
        } catch {
          toast('Transcription failed', 'error')
        } finally {
          setTranscribing(false)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      toast('Recording started...', 'info')
    } catch {
      toast('Microphone access denied', 'error')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const useTranscript = () => {
    setContent(transcript)
    setTranscript('')
    toast('Transcript added to content', 'success')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Log Memory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)]">
              Memory Type
            </label>
            <Select
              options={memoryTypes}
              value={type}
              onChange={(e) => setType(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)]">
              Content
            </label>
            <Textarea
              placeholder="What do you want to remember?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[150px]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)]">
              Tags (comma separated)
            </label>
            <Input
              placeholder="e.g., shopping, important, work"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          <Button onClick={handleSave} loading={saving} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            Save Memory
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Voice Recording
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex gap-3">
            <Button
              variant={isRecording ? 'destructive' : 'secondary'}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={transcribing}
              className="flex-1"
            >
              {isRecording ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-white recording-indicator mr-2" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </>
              )}
            </Button>
          </div>

          <AnimatePresence>
            {transcribing && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center justify-center gap-3 py-4 text-[hsl(240,5%,65%)]"
              >
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Transcribing...</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {transcript && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <label className="text-xs uppercase tracking-wider text-[hsl(240,5%,65%)]">
                  Transcription
                </label>
                <div className="p-4 rounded-lg bg-[hsl(240,5%,8%)] border border-[hsl(240,5%,15%)] text-[hsl(0,0%,90%)]">
                  {transcript}
                </div>
                <Button onClick={useTranscript} className="w-full">
                  <Save className="w-4 h-4 mr-2" />
                  Use as Memory Content
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}
