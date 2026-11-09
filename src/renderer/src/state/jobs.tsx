import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Job } from '../../../shared/jobs'
import type { ClipLimits, YoutubeChoice } from '../../../shared/types'

interface JobsContextValue {
  /** Newest first. */
  jobs: Job[]
  add: (sources: string[], links?: Record<string, YoutubeChoice>, limits?: Record<string, ClipLimits>) => Promise<void>
  cancel: (id: string) => void
  remove: (id: string) => void
  retry: (id: string) => void
  /** Pause or resume a video that has not started. */
  hold: (id: string, held: boolean) => void
  findAgain: (id: string) => void
  rewritePosts: (id: string) => void
  render: (jobId: string, clipIds: string[]) => void
  deleteReel: (jobId: string, clipId: string) => void
  setClipRange: (jobId: string, clipId: string, start: number, end: number) => void
  setClipHeart: (jobId: string, clipId: string, hearted: boolean) => void
  setClipPosted: (jobId: string, clipId: string, posted: boolean) => void
  deleteClips: (jobId: string, clipIds: string[]) => void
  /** Removes a video with its reels and data. */
  deleteJob: (id: string) => void
  /** A finished video whose results have not been opened yet. */
  isUnopened: (job: Job) => boolean
  markOpened: (id: string) => void
}

const JobsContext = createContext<JobsContextValue | null>(null)

const sorted = (list: Job[]): Job[] => [...list].sort((a, b) => b.createdAt - a.createdAt)

const OPENED_KEY = 'openedJobs'

/** Ids of videos whose results were opened; null the first time, before anything was saved. */
function loadOpened(): Set<string> | null {
  try {
    const raw = localStorage.getItem(OPENED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [opened, setOpened] = useState<Set<string> | null>(loadOpened)

  useEffect(() => {
    if (!opened) return
    try {
      localStorage.setItem(OPENED_KEY, JSON.stringify([...opened]))
    } catch {
      // Not saved: the dots come back next start, nothing is lost.
    }
  }, [opened])

  useEffect(() => {
    window.api
      .listJobs()
      .then((list) => {
        setJobs(list)
        // First run with this feature: videos finished before it count as opened, not as new.
        setOpened((current) => current ?? new Set(list.filter((job) => job.stage === 'done').map((job) => job.id)))
      })
      .catch((err: unknown) => window.api.log('error', `listJobs failed: ${String(err)}`))
    return window.api.onJobUpdate((job) => {
      setJobs((current) => sorted([...current.filter((item) => item.id !== job.id), job]))
    })
  }, [])

  const value: JobsContextValue = {
    jobs,
    add: async (sources, links, limits) => {
      await window.api.addJobs(sources, links, limits)
    },
    cancel: (id) => void window.api.cancelJob(id),
    remove: (id) => {
      // A finished video stays (hidden from the Queue); its update arrives from main.
      setJobs((current) => current.filter((job) => job.id !== id || job.stage === 'done'))
      void window.api.removeJob(id)
    },
    retry: (id) => void window.api.retryJob(id),
    hold: (id, held) => void window.api.holdJob(id, held),
    findAgain: (id) => void window.api.findAgain(id),
    rewritePosts: (id) => void window.api.rewritePosts(id),
    render: (jobId, clipIds) => void window.api.renderClips(jobId, clipIds),
    deleteReel: (jobId, clipId) => void window.api.deleteReel(jobId, clipId),
    setClipRange: (jobId, clipId, start, end) => void window.api.setClipRange(jobId, clipId, start, end),
    setClipHeart: (jobId, clipId, hearted) => void window.api.setClipHeart(jobId, clipId, hearted),
    setClipPosted: (jobId, clipId, posted) => void window.api.setClipPosted(jobId, clipId, posted),
    deleteClips: (jobId, clipIds) => void window.api.deleteClips(jobId, clipIds),
    deleteJob: (id) => {
      setJobs((current) => current.filter((job) => job.id !== id))
      void window.api.deleteJob(id)
    },
    isUnopened: (job) => opened !== null && job.stage === 'done' && !opened.has(job.id),
    markOpened: (id) => setOpened((current) => (!current || current.has(id) ? current : new Set(current).add(id)))
  }

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs(): JobsContextValue {
  const context = useContext(JobsContext)
  if (!context) throw new Error('useJobs must be used inside JobsProvider')
  return context
}

export const isActive = (job: Job): boolean => !['queued', 'done', 'error', 'cancelled'].includes(job.stage)
