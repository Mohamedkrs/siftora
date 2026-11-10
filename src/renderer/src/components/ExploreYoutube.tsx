import type { FormEvent } from 'react'
import { channelKey, isBlocked, TITLE_LANGUAGES, TITLE_SCRIPTS, type ExploredChannel, type TitleLanguage, type TitleScript } from '../../../shared/types'
import NumberField from './NumberField'
import TagInput from './TagInput'
import { useKept } from '../lib/kept'
import { useBlockChannel } from '../lib/blockChannel'
import { useSettings } from '../state/settings'

type Mode = 'channels' | 'videos'
type Order = 'relevance' | 'views'
interface FoundChannel extends ExploredChannel {
  /** The topics it was found under, saved as its tags. */
  topics: string[]
}

const VIEWS = new Intl.NumberFormat('en', { notation: 'compact' })

/** Words that often mark videos in a language the title's alphabet doesn't give away. */
const SKIP_SUGGESTIONS = ['hindi', 'tamil', 'telugu', 'bangla', 'urdu', 'malayalam', 'kannada', 'punjabi', 'marathi', 'india', 'bhai', 'aap']

/** Electron wraps errors from the main process; keep only their own words. */
function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Comma-separated topics, trimmed, empty ones dropped and case-insensitive duplicates merged. */
function topicsOf(value: string): string[] {
  const topics: string[] = []
  for (const part of value.split(',')) {
    const topic = part.trim()
    if (topic && !topics.some((kept) => kept.toLowerCase() === topic.toLowerCase())) topics.push(topic)
  }
  return topics
}

export default function ExploreYoutube(props: { onAdd: (links: string[]) => { added: number; skipped: number } }) {
  const { settings, update } = useSettings()
  const blockChannel = useBlockChannel()
  const [topics, setTopics] = useKept('exploreTopics', '')
  const [mode, setMode] = useKept<Mode>('exploreMode', 'channels')
  const [channelCount, setChannelCount] = useKept('exploreChannelCount', 5)
  const [videosPerChannel, setVideosPerChannel] = useKept('exploreVideosPerChannel', 3)
  const [activeWithin, setActiveWithin] = useKept('exploreActiveWithin', 30)
  const [videoCount, setVideoCount] = useKept('exploreVideoCount', 10)
  const [order, setOrder] = useKept<Order>('exploreOrder', 'relevance')
  const [uploadedWithin, setUploadedWithin] = useKept('exploreUploadedWithin', 0)
  const [busy, setBusy] = useKept('exploreBusy', false)
  const [adding, setAdding] = useKept('exploreAdding', false)
  const [status, setStatus] = useKept('exploreStatus', '')
  const [found, setFound] = useKept<FoundChannel[]>('exploreFound', [])
  const [ticked, setTicked] = useKept<string[]>('exploreTicked', [])
  const [saved, setSaved] = useKept<string[]>('exploreSaved', [])

  const explore = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const wanted = topicsOf(topics)
    if (wanted.length === 0) return
    setBusy(true)
    setStatus(`Searching YouTube for ${wanted.join(', ')}…`)
    try {
      if (mode === 'videos') {
        const links: string[] = []
        const failed: string[] = []
        let blocked = 0
        // One after another: several searches at once trip YouTube's limits.
        for (const topic of wanted) {
          try {
            const result = await window.api.searchVideos(topic, videoCount, uploadedWithin, order)
            links.push(...result.links)
            blocked += result.blocked
          } catch (err) {
            window.api.log('warn', `searchVideos ${topic} failed: ${reason(err)}`)
            failed.push(topic)
          }
        }
        const message = addedMessage(links, failed, `No videos of 4 minutes or more found for ${wanted.join(', ')}`, 'search')
        setStatus(
          blocked > 0
            ? `${message.slice(0, -1)}; skipped ${blocked} from channels you blocked.`
            : message
        )
        return
      }

      const merged = new Map<string, FoundChannel>()
      const failed: string[] = []
      for (const topic of wanted) {
        try {
          for (const channel of await window.api.exploreChannels(topic, channelCount, activeWithin)) {
            const existing = merged.get(channel.url)
            if (existing) {
              if (!existing.topics.some((kept) => kept.toLowerCase() === topic.toLowerCase())) existing.topics.push(topic)
            } else {
              merged.set(channel.url, { ...channel, topics: [topic] })
            }
          }
        } catch (err) {
          window.api.log('warn', `exploreChannels ${topic} failed: ${reason(err)}`)
          failed.push(topic)
        }
      }
      const all = [...merged.values()]
      const savedUrls = new Set(settings.savedChannels.map((channel) => channelKey(channel.url)))
      const notSaved = all.filter(
        (channel) => !savedUrls.has(channelKey(channel.url)) && !(channel.handleUrl && savedUrls.has(channelKey(channel.handleUrl)))
      )
      const shown = notSaved.filter((channel) => !isBlocked(settings.blockedChannels, channel.url, channel.handleUrl))
      const hidden = all.length - notSaved.length
      const blocked = notSaved.length - shown.length
      setFound(shown)
      setTicked(shown.map((channel) => channel.url))
      setSaved([])
      setStatus(
        [
          shown.length === 0
            ? `No channels found for ${wanted.join(', ')}`
            : `Found ${shown.length} ${shown.length === 1 ? 'channel' : 'channels'} for ${wanted.join(', ')}`,
          hidden > 0 ? `${hidden} you already saved ${hidden === 1 ? 'is' : 'are'} hidden` : null,
          blocked > 0 ? `${blocked} you blocked ${blocked === 1 ? 'is' : 'are'} hidden` : null,
          failed.length > 0 ? `could not search ${failed.join(', ')}` : null
        ]
          .filter(Boolean)
          .join('; ') + '.'
      )
    } finally {
      setBusy(false)
    }
  }

  const addChannels = async (): Promise<void> => {
    const picked = found.filter((channel) => ticked.includes(channel.url))
    if (picked.length === 0) return
    setBusy(true)
    setAdding(true)
    const links: string[] = []
    const failed: string[] = []
    try {
      // One after another: each listing is its own yt-dlp run and too many at once trip YouTube's limits.
      for (const [index, channel] of picked.entries()) {
        setStatus(`Listing ${channel.name} (${index + 1} of ${picked.length})…`)
        try {
          links.push(...(await window.api.channelVideos(channel.url, videosPerChannel, activeWithin)))
        } catch (err) {
          window.api.log('warn', `channelVideos ${channel.url} failed: ${reason(err)}`)
          failed.push(channel.name)
        }
      }
      setStatus(addedMessage(links, failed, 'No videos found for the ticked channels', 'list'))
    } finally {
      setBusy(false)
      setAdding(false)
    }
  }

  /** Adds the links and says what happened, including when every one was skipped. */
  const addedMessage = (links: string[], failed: string[], none: string, verb: string): string => {
    const result = props.onAdd(links)
    const total = result.added + result.skipped
    return (
      [
        links.length === 0 && failed.length === 0
          ? none
          : result.added === 0 && result.skipped > 0
            ? `Nothing new: ${total === 1 ? 'the video found is' : `all ${total} videos found are`} already in Siftora or in your list`
            : `Added ${result.added} new ${result.added === 1 ? 'video' : 'videos'}`,
        result.added > 0 && result.skipped > 0 ? `skipped ${result.skipped} already in Siftora or in your list` : null,
        failed.length > 0 ? `could not ${verb} ${failed.join(', ')}` : null
      ]
        .filter(Boolean)
        .join('; ') + '.'
    )
  }

  const save = (channel: FoundChannel): void => {
    update({ savedChannels: [...settings.savedChannels, { url: channel.url, name: channel.name, tags: channel.topics }] })
    setSaved((current) => [...current, channel.url])
  }

  const block = async (channel: FoundChannel): Promise<void> => {
    if (!(await blockChannel({ url: channel.url, handleUrl: channel.handleUrl ?? undefined, name: channel.name }))) return
    setFound((current) => current.filter((item) => item.url !== channel.url))
    setTicked((current) => current.filter((url) => url !== channel.url))
  }

  return (
    <>
      <h2>Explore YouTube</h2>
      <p className="muted">Find channels or top videos by topic. Separate topics with commas, for example: gaming, funny.</p>
      <form className="url-row" onSubmit={(event) => void explore(event)}>
        <input
          type="text"
          value={topics}
          onChange={(event) => setTopics(event.target.value)}
          placeholder="Topics, for example: gaming, funny"
          aria-label="Topics to explore"
        />
        <button type="submit" className="button" disabled={busy}>
          {busy && !adding ? <span className="spinner" aria-hidden="true" /> : null}
          {mode === 'channels' ? (busy && !adding ? 'Exploring…' : 'Explore') : busy ? 'Finding…' : 'Find videos'}
        </button>
      </form>
      <div className="saved-pick">
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value === 'videos' ? 'videos' : 'channels')}
          aria-label="What to find"
        >
          <option value="channels">Channels</option>
          <option value="videos">Top videos</option>
        </select>
        {mode === 'channels' ? (
          <>
            <NumberField label="Channels" value={channelCount} min={1} max={10} onCommit={setChannelCount} />
            <NumberField
              label="Videos per channel"
              value={videosPerChannel}
              min={1}
              max={10}
              onCommit={setVideosPerChannel}
            />
            <select
              value={activeWithin}
              onChange={(event) => setActiveWithin(Number(event.target.value))}
              aria-label="Active within"
            >
              <option value={7}>Active in the last week</option>
              <option value={30}>Active in the last month</option>
              <option value={365}>Active in the last year</option>
            </select>
          </>
        ) : (
          <>
            <NumberField label="Videos per topic" value={videoCount} min={1} max={50} onCommit={setVideoCount} />
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value === 'views' ? 'views' : 'relevance')}
              aria-label="Order"
            >
              <option value="relevance">Most relevant</option>
              <option value="views">Most viewed</option>
            </select>
            <select
              value={uploadedWithin}
              onChange={(event) => setUploadedWithin(Number(event.target.value))}
              aria-label="Uploaded within"
            >
              <option value={0}>Uploaded any time</option>
              <option value={1}>Uploaded in the last 24 hours</option>
              <option value={7}>Uploaded in the last week</option>
              <option value={30}>Uploaded in the last month</option>
            </select>
          </>
        )}
      </div>
      <div className="saved-pick explore-filters">
        <select
          value={settings.exploreScript}
          onChange={(event) => update({ exploreScript: event.target.value as TitleScript })}
          aria-label="Title alphabet"
          title="Keep only videos whose titles are mostly in this alphabet"
        >
          {Object.entries(TITLE_SCRIPTS).map(([value, script]) => (
            <option key={value} value={value}>
              {value === 'any' ? 'Titles in any alphabet' : `Titles in ${script.label}`}
            </option>
          ))}
        </select>
        <select
          value={settings.exploreLanguage}
          onChange={(event) => update({ exploreLanguage: event.target.value as TitleLanguage })}
          aria-label="Title language"
          title="Skip videos whose title and description look written in another language (titles with no clue are kept)"
        >
          {Object.entries(TITLE_LANGUAGES).map(([value, language]) => (
            <option key={value} value={value}>
              {value === 'any' ? 'Any language' : language.label}
            </option>
          ))}
        </select>
        <TagInput
          label="Skip videos whose title, channel or description has these words"
          placeholder="Skip words, for example: hindi"
          value={settings.exploreSkipWords}
          suggestions={SKIP_SUGGESTIONS}
          onChange={(words) => update({ exploreSkipWords: words })}
        />
        <label className="toggle" title={settings.cookiesBrowser ? 'Search as your YouTube account, so results follow its history' : 'Choose how Siftora signs in to YouTube in Settings first'}>
          <input
            type="checkbox"
            checked={settings.explorePersonalized && !!settings.cookiesBrowser}
            disabled={!settings.cookiesBrowser}
            onChange={(event) => update({ explorePersonalized: event.target.checked })}
          />
          Personalized results
        </label>
      </div>
      {status ? <p className="muted">{status}</p> : null}
      {mode === 'channels' && found.length > 0 ? (
        <>
          <ul className="explore-channels">
            {found.map((channel) => {
              const isSaved = saved.includes(channel.url)
              return (
                <li key={channel.url} className="explore-channel">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={ticked.includes(channel.url)}
                      onChange={(event) =>
                        setTicked((current) =>
                          event.target.checked ? [...current, channel.url] : current.filter((url) => url !== channel.url)
                        )
                      }
                    />
                    <span>
                      <strong>{channel.name}</strong>
                      <span className="muted">
                        {channel.hits} of the top videos · {VIEWS.format(channel.views)} views
                      </span>
                      {channel.sampleTitles.length > 0 ? (
                        <span className="muted small">
                          {channel.sampleTitles.map((title) => `“${title}”`).join(' ')}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <button type="button" className="button small" disabled={isSaved} onClick={() => save(channel)}>
                    {isSaved ? 'Saved' : 'Save to my channels'}
                  </button>
                  <button
                    type="button"
                    className="button small"
                    title="Never suggest this channel or its videos again (undo on Channels)"
                    onClick={() => void block(channel)}
                  >
                    Block
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="explore-actions">
            <button type="button" className="button" disabled={busy || ticked.length === 0} onClick={() => void addChannels()}>
              {adding ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Adding videos…
                </>
              ) : (
                `Add videos from ${ticked.length} ticked ${ticked.length === 1 ? 'channel' : 'channels'}`
              )}
            </button>
          </div>
        </>
      ) : null}
    </>
  )
}
