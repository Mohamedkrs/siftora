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
