import { isBlocked, type BlockedChannel } from '../../../shared/types'
import { useDialog } from '../components/Dialog'
import { useJobs } from '../state/jobs'
import { useSettings } from '../state/settings'

/** Blocks a channel after asking, and deletes its finished videos on Results with their clips and reels. */
export function useBlockChannel(): (channel: BlockedChannel) => Promise<boolean> {
  const { settings, update } = useSettings()
  const { jobs, deleteJob } = useJobs()
  const dialog = useDialog()
  return async (channel) => {
    const theirs = jobs.filter(
      (job) => job.stage === 'done' && isBlocked([channel], job.channelUrl, job.channelHandleUrl)
    )
    // A reel being rendered can't be deleted under it; those videos stay until it's done.
    const rendering = (job: (typeof theirs)[number]): boolean =>
      job.clips.some((clip) => clip.render.status === 'queued' || clip.render.status === 'rendering')
    const doomed = theirs.filter((job) => !rendering(job))
    const kept = theirs.length - doomed.length
    const reels = doomed.reduce((sum, job) => sum + job.clips.filter((clip) => clip.render.status === 'done').length, 0)
    const ok = await dialog.confirm({
      title: `Block ${channel.name}?`,
      message: [
        'Explore and Top videos will never suggest this channel or its videos again. You can unblock it on Channels.',
        doomed.length > 0
          ? `Its ${doomed.length} ${doomed.length === 1 ? 'video' : 'videos'} on Results ${doomed.length === 1 ? 'is' : 'are'} deleted with their clips${reels > 0 ? ` and ${reels} rendered ${reels === 1 ? 'reel' : 'reels'} (to the Recycle Bin)` : ''}.`
          : null,
        kept > 0 ? `${kept} still rendering ${kept === 1 ? 'stays' : 'stay'}; delete ${kept === 1 ? 'it' : 'them'} when done.` : null
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: doomed.length > 0 ? 'Block and delete' : 'Block',
      danger: doomed.length > 0
    })
    if (!ok) return false
    update({ blockedChannels: [...settings.blockedChannels, channel] })
    for (const job of doomed) deleteJob(job.id)
    return true
  }
}
