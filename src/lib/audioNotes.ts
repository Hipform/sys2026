import type { AudioCue } from '../types/document'
import { getNotebookAudio, putNotebookAudio } from './db'

export async function startNotebookRecording(
  notebookId: string,
): Promise<{
  stop: () => Promise<void>
  addCue: (pageIndex: number, strokeId?: string) => void
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType: mime })
  const chunks: BlobPart[] = []
  const cues: AudioCue[] = []
  const startedAt = Date.now()
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(250)

  return {
    addCue(pageIndex, strokeId) {
      cues.push({
        tMs: Date.now() - startedAt,
        pageIndex,
        strokeId,
      })
    },
    async stop() {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: mime })
      const data = await blob.arrayBuffer()
      const prev = await getNotebookAudio(notebookId)
      await putNotebookAudio({
        notebookId,
        mime,
        data,
        cues: [...(prev?.cues ?? []), ...cues],
        updatedAt: Date.now(),
      })
    },
  }
}

export async function playNotebookAudio(
  notebookId: string,
  onCue?: (cue: AudioCue) => void,
): Promise<HTMLAudioElement | null> {
  const row = await getNotebookAudio(notebookId)
  if (!row) return null
  const blob = new Blob([row.data], { type: row.mime })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  const cues = [...row.cues].sort((a, b) => a.tMs - b.tMs)
  let i = 0
  audio.ontimeupdate = () => {
    const t = audio.currentTime * 1000
    while (i < cues.length && cues[i]!.tMs <= t) {
      onCue?.(cues[i]!)
      i += 1
    }
  }
  audio.onended = () => URL.revokeObjectURL(url)
  await audio.play()
  return audio
}
