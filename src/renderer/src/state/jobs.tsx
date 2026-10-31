import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Job } from '../../../shared/jobs'

interface JobsContextValue {
  /** Newest first. */
  jobs: Job[]
  add: (sources: string[]) => Promise<void>
  cancel: (id: string) => void
  remove: (id: string) => void
  retry: (id: string) => void
  findAgain: (id: string) => void
  render: (jobId: string, clipIds: string[]) => void
  deleteReel: (jobId: string, clipId: string) => void
  /** Removes a video with its reels and data. */
  deleteJob: (id: string) => void
}

const JobsContext = createContext<JobsContextValue | null>(null)

const sorted = (list: Job[]): Job[] => [...list].sort((a, b) => b.createdAt - a.createdAt)

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    window.api.listJobs().then(setJobs).catch((err: unknown) => window.api.log('error', `listJobs failed: ${String(err)}`))
    return window.api.onJobUpdate((job) => {
      setJobs((current) => sorted([...current.filter((item) => item.id !== job.id), job]))
    })
  }, [])

  const value: JobsContextValue = {
    jobs,
    add: async (sources) => {
      await window.api.addJobs(sources)
    },
    cancel: (id) => void window.api.cancelJob(id),
    remove: (id) => {
      setJobs((current) => current.filter((job) => job.id !== id))
      void window.api.removeJob(id)
    },
    retry: (id) => void window.api.retryJob(id),
    findAgain: (id) => void window.api.findAgain(id),
    render: (jobId, clipIds) => void window.api.renderClips(jobId, clipIds),
    deleteReel: (jobId, clipId) => void window.api.deleteReel(jobId, clipId),
    deleteJob: (id) => {
      setJobs((current) => current.filter((job) => job.id !== id))
      void window.api.deleteJob(id)
    }
  }

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs(): JobsContextValue {
  const context = useContext(JobsContext)
  if (!context) throw new Error('useJobs must be used inside JobsProvider')
  return context
}

export const isActive = (job: Job): boolean => !['queued', 'done', 'error', 'cancelled'].includes(job.stage)
