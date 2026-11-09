// Share kit: ready-to-paste post texts per platform, built from what the AI wrote for a clip.
import type { Clip } from './jobs'

export type SharePlatform = 'youtube' | 'tiktok' | 'instagram'

export const SHARE_PLATFORMS: { id: SharePlatform; name: string; uploadUrl: string }[] = [
  { id: 'youtube', name: 'YouTube Shorts', uploadUrl: 'https://www.youtube.com/upload' },
  { id: 'tiktok', name: 'TikTok', uploadUrl: 'https://www.tiktok.com/upload' },
  { id: 'instagram', name: 'Instagram Reels', uploadUrl: 'https://www.instagram.com/' }
]

/** Clips found before the AI wrote hashtags get one from their category. */
const CATEGORY_TAGS: Record<string, string[]> = {
  funny: ['funny', 'comedy'],
  educational: ['learn', 'facts'],
  controversial: ['debate', 'hottake'],
  emotional: ['emotional', 'story'],
  surprising: ['unexpected', 'wow'],
  conversation: ['podcast', 'conversation']
}

const YOUTUBE_TITLE_MAX = 100
const CAPTION_MAX = 2200 // TikTok and Instagram caption limit
const INSTAGRAM_TAGS_MAX = 30

/** Lowercase hashtag words without '#', spaces or punctuation; deduplicated. */
export function cleanHashtags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const words = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ''))
    .filter((tag) => tag.length > 1 && tag.length <= 40)
  return [...new Set(words)]
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

const hashtags = (words: string[]): string => [...new Set(words)].map((word) => `#${word}`).join(' ')

/** Post texts for one platform. `title` only where the platform has a separate title field. */
export function shareText(clip: Clip, platform: SharePlatform): { title?: string; text: string } {
  const tags = clip.hashtags?.length ? clip.hashtags : (CATEGORY_TAGS[clip.category] ?? [])
  // Never the hook: it is a raw transcript quote, not something to post.
  const caption = clip.caption?.trim() || clip.title
  const description = clip.description?.trim()
  const credit = clip.credit ? `🎥 ${clip.credit}` : undefined
  const body = (lines: (string | undefined)[]): string => lines.filter(Boolean).join('\n\n')
  if (platform === 'youtube') {
    return {
      title: cut(clip.title, YOUTUBE_TITLE_MAX),
      text: body([description ?? caption, credit, hashtags([...tags, 'shorts'])])
    }
  }
  if (platform === 'tiktok') {
    // TikTok shows the first line in the feed: lead with the caption.
    return { text: cut(`${caption}${credit ? ` ${credit}` : ''} ${hashtags([...tags, 'fyp'])}`, CAPTION_MAX) }
  }
  return { text: cut(body([caption, description, credit, hashtags([...tags, 'reels'].slice(0, INSTAGRAM_TAGS_MAX))]), CAPTION_MAX) }
}
