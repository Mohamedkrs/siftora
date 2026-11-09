import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // Video and reel stills (thumb.jpg, posters/<clip>.jpg).
  '.jpg': 'image/jpeg'
}

/**
 * Serves siftora-media://local/<encoded path> with HTTP range support, which <video> needs to seek
 * (a plain file fetch through a custom protocol does not answer Range requests).
 */
export function serveMedia(request: Request): Response {
  const path = decodeURIComponent(new URL(request.url).pathname.slice(1))
  const type = TYPES[extname(path).toLowerCase()]
  if (!type) return new Response('Not found', { status: 404 })

  let size: number
  try {
    size = statSync(path).size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const range = request.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
  if (!range) {
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  }

  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  })
}
