const MB = 1024 ** 2
const GB = 1024 ** 3

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${(bytes / MB).toFixed(1)} MB`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return ''

  if (seconds < 60) return `${Math.ceil(seconds)} s`

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
}

/** 83000 → "1:23", 3723000 → "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
