import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { SavedChannel } from '../../../shared/types'
import TagInput from '../components/TagInput'
import { useSettings } from '../state/settings'
import { isChannelUrl } from './Create'

/** "@KSI" from https://www.youtube.com/@KSI/videos, for when no name is given. */
function nameFromUrl(link: string): string {
  try {
    // /@name/… or /channel|c|user/<id>/…
    const parts = new URL(link).pathname.split('/').filter(Boolean)
    return decodeURIComponent(parts[0].startsWith('@') ? parts[0] : (parts[1] ?? link))
  } catch {
    return link
  }
}

/** The IPC error without Electron's "Error invoking remote method …" prefix. */
function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function Channels() {
  const { settings, update } = useSettings()
  const channels = settings.savedChannels
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState('')
  const [shownTag, setShownTag] = useState<string | null>(null)
  /** Name and tags last filled in from YouTube; replaced on the next lookup unless the user edited them. */
  const [auto, setAuto] = useState<{ name: string; tags: string[] }>({ name: '', tags: [] })
  const [lookingUp, setLookingUp] = useState(false)
  const [subs, setSubs] = useState<{ url: string; name: string }[] | null>(null)
  const [subsPicked, setSubsPicked] = useState<Set<string>>(new Set())
  const [subsTags, setSubsTags] = useState<string[]>([])
  const [subsState, setSubsState] = useState<'idle' | 'loading' | string>('idle')

  // Fill in the name and tags a moment after a channel link is pasted or typed.
  useEffect(() => {
    const link = url.trim()
    if (!isChannelUrl(link)) return
    let live = true
    const timer = setTimeout(() => {
      setLookingUp(true)
      window.api
        .channelDetails(link)
        .then((details) => {
          if (!live) return
          setName((current) => (current === '' || current === auto.name ? details.name : current))
          setTags((current) =>
            current.length === 0 || current.join() === auto.tags.join() ? details.tags : current
          )
          setAuto({ name: details.name, tags: details.tags })
        })
        .catch((err: unknown) => window.api.log('warn', `channelDetails failed: ${String(err)}`))
        .finally(() => live && setLookingUp(false))
    }, 500)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // Only a new link starts a lookup; `auto` is read as it was then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const isSaved = (sub: { url: string; name: string }): boolean =>
    channels.some((channel) => channel.url === sub.url || channel.name.toLowerCase() === sub.name.toLowerCase())
  const loadSubs = (): void => {
    setSubsState('loading')
    window.api
      .subscribedChannels()
      .then((list) => {
        setSubs(list)
        setSubsPicked(new Set())
        setSubsState(list.length === 0 ? 'No subscriptions found for this sign-in.' : 'idle')
      })
      .catch((err: unknown) => {
        window.api.log('warn', `subscribedChannels failed: ${String(err)}`)
        setSubsState(reason(err))
      })
  }
  const importSubs = (): void => {
    const picked = (subs ?? []).filter((sub) => subsPicked.has(sub.url) && !isSaved(sub))
    save([...channels, ...picked.map((sub) => ({ url: sub.url, name: sub.name, tags: subsTags }))])
    setSubs(null)
    setSubsTags([])
  }
  const allTags = [...new Set(channels.flatMap((channel) => channel.tags))].sort()
  const shown = shownTag === null ? channels : channels.filter((channel) => channel.tags.includes(shownTag))

  const save = (list: SavedChannel[]): void => update({ savedChannels: list })
  const change = (link: string, patch: Partial<SavedChannel>): void =>
    save(channels.map((channel) => (channel.url === link ? { ...channel, ...patch } : channel)))

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const link = url.trim()
    if (!isChannelUrl(link)) return setError('Paste a YouTube channel link, like https://www.youtube.com/@name.')
    if (channels.some((channel) => channel.url === link)) return setError('That channel is already saved.')
    save([...channels, { url: link, name: name.trim() || nameFromUrl(link), tags }])
    setUrl('')
    setName('')
    setTags([])
    setAuto({ name: '', tags: [] })
    setError('')
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Channels</h1>
        <p>
          Your favourite YouTube channels, grouped by tags. On <Link to="/create">Create</Link>, pick a tag or a channel
          to add their newest videos; ones Siftora already has are skipped.
        </p>
      </div>

      <form className="card channel-add" onSubmit={add}>
        <h2>Add a channel</h2>
        <div className="channel-fields">
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/@name"
            aria-label="Channel link"
          />
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name (optional)" aria-label="Name" />
          <TagInput
            value={tags}
            suggestions={allTags}
            onChange={setTags}
            placeholder="Tags: gaming, podcasts…"
            label="Tags"
          />
          <button type="submit" className="button primary">
            Save channel
          </button>
        </div>
        {lookingUp ? <p className="muted">Looking up the channel’s name and tags…</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </form>

      <section className="card">
        <h2>From your YouTube subscriptions</h2>
        {subs === null ? (
          <div className="channel-fields">
            <button type="button" className="button" disabled={subsState === 'loading'} onClick={loadSubs}>
              {subsState === 'loading' ? 'Listing your subscriptions…' : 'List my subscriptions'}
            </button>
            <span className="muted">
              Uses the YouTube sign-in chosen in <Link to="/settings">Settings</Link>.
            </span>
          </div>
        ) : (
          <>
            <div className="channel-fields">
              <label className="bulk-all">
                <input
                  type="checkbox"
                  checked={subs.filter((sub) => !isSaved(sub)).every((sub) => subsPicked.has(sub.url))}
                  onChange={(event) =>
                    setSubsPicked(
                      new Set(event.target.checked ? subs.filter((sub) => !isSaved(sub)).map((sub) => sub.url) : [])
                    )
                  }
                />
                Select all
              </label>
              <TagInput
                value={subsTags}
                suggestions={allTags}
                onChange={setSubsTags}
                placeholder="Tags for the ones you save (optional)"
                label="Tags for the imported channels"
              />
              <button type="button" className="button primary" disabled={subsPicked.size === 0} onClick={importSubs}>
                Save {subsPicked.size} {subsPicked.size === 1 ? 'channel' : 'channels'}
              </button>
              <button type="button" className="link-button" onClick={() => setSubs(null)}>
                Cancel
              </button>
            </div>
            <ul className="subs-list">
              {subs.map((sub) => (
                <li key={sub.url}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={isSaved(sub)}
                      checked={isSaved(sub) || subsPicked.has(sub.url)}
                      onChange={() => {
                        const next = new Set(subsPicked)
                        if (!next.delete(sub.url)) next.add(sub.url)
                        setSubsPicked(next)
                      }}
                    />
                    {sub.name}
                    {isSaved(sub) ? <span className="muted"> · already saved</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {subsState !== 'idle' && subsState !== 'loading' ? <p className="error">{subsState}</p> : null}
      </section>

      {channels.length === 0 ? (
        <p className="muted">No channels saved yet.</p>
      ) : (
        <section className="card">
          {allTags.length > 0 ? (
            <div className="model-chips topic-filter" role="radiogroup" aria-label="Show channels by tag">
              <span className="chips-label">Show</span>
              {[null, ...allTags].map((tag) => (
                <button
                  key={tag ?? 'all'}
                  type="button"
                  role="radio"
                  aria-checked={shownTag === tag}
                  className={shownTag === tag ? 'chip selected' : 'chip'}
                  onClick={() => setShownTag(tag)}
                >
                  {tag === null
                    ? `All (${channels.length})`
                    : `${tag} (${channels.filter((channel) => channel.tags.includes(tag)).length})`}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="channel-list">
            {shown.map((channel) => (
              // Keyed on the name too, so the name box resets when it is saved.
              <li key={`${channel.url}|${channel.name}`} className="channel-row">
                <input
                  type="text"
                  defaultValue={channel.name}
                  aria-label={`Name of ${channel.url}`}
                  onBlur={(event) => event.target.value.trim() && change(channel.url, { name: event.target.value.trim() })}
                />
                <span className="muted channel-url" title={channel.url}>
                  {channel.url}
                </span>
                <TagInput
                  value={channel.tags}
                  suggestions={allTags}
                  onChange={(next) => change(channel.url, { tags: next })}
                  placeholder="Add tags"
                  label={`Tags of ${channel.name}`}
                />
                <button
                  type="button"
                  className="button small"
                  onClick={() => save(channels.filter((item) => item.url !== channel.url))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
