import { closeSync, openSync, readSync } from 'node:fs'

export interface GgufInfo {
  architecture?: string
  sizeLabel?: string
  name?: string
  basename?: string
  fileType?: number
}

// GGUF metadata value types (gguf spec).
const SIZES: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
const STRING = 8
const ARRAY = 9
const WANTED = ['general.architecture', 'general.size_label', 'general.name', 'general.basename', 'general.file_type']

/**
 * Reads the general.* metadata from a GGUF header. These keys come first in files written
 * by llama.cpp and Ollama, so the first few MB are enough; returns what it found.
 */
export function readGgufInfo(path: string): GgufInfo {
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(4 * 1024 * 1024)
  let len: number
  try {
    len = readSync(fd, buf, 0, buf.length, 0)
  } finally {
    closeSync(fd)
  }
  if (len < 24 || buf.toString('latin1', 0, 4) !== 'GGUF') return {}

  const info: GgufInfo = {}
  const kvCount = Number(buf.readBigUInt64LE(16))
  let pos = 24

  const need = (n: number): boolean => pos + n <= len
  const readString = (): string | null => {
    if (!need(8)) return null
    const n = Number(buf.readBigUInt64LE(pos))
    pos += 8
    if (!need(n)) return null
    const s = buf.toString('utf8', pos, pos + n)
    pos += n
    return s
  }
  const skipValue = (type: number): boolean => {
    if (type === STRING) return readString() !== null
    if (type === ARRAY) {
      if (!need(12)) return false
      const itemType = buf.readUInt32LE(pos)
      const count = Number(buf.readBigUInt64LE(pos + 4))
      pos += 12
      if (itemType !== STRING && itemType !== ARRAY && SIZES[itemType]) {
        pos += SIZES[itemType] * count
        return pos <= len
      }
      for (let i = 0; i < count; i++) if (!skipValue(itemType)) return false
      return true
    }
    const size = SIZES[type]
    if (!size || !need(size)) return false
    pos += size
    return true
  }

  for (let i = 0; i < kvCount; i++) {
    const key = readString()
    if (key === null || !need(4)) break
    const type = buf.readUInt32LE(pos)
    pos += 4

    if (key === 'general.file_type' && (type === 4 || type === 5) && need(4)) {
      info.fileType = buf.readUInt32LE(pos)
      pos += 4
    } else if (WANTED.includes(key) && type === STRING) {
      const value = readString()
      if (value === null) break
      if (key === 'general.architecture') info.architecture = value
      else if (key === 'general.size_label') info.sizeLabel = value
      else if (key === 'general.name') info.name = value
      else if (key === 'general.basename') info.basename = value
    } else if (!skipValue(type)) {
      break
    }

    if (info.architecture && info.sizeLabel && info.fileType !== undefined && info.name) break
  }

  return info
}
