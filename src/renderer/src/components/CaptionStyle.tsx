import { useRef, useState, type PointerEvent, type SyntheticEvent } from 'react'
import { mediaUrl } from '../../../shared/jobs'
import {
  CAPTION_FONTS,
  MAX_SPEAKER_COLORS,
  SPEAKER_COLOR_SUGGESTIONS,
  type Layout,
  type SubtitleStyle
} from '../../../shared/types'
import { useSettings } from '../state/settings'

// Checkbox and color picker are siblings, not inside one <label>: a label forwards
// every click to its first control, which made the picker impossible to open.
function ToggleColor(props: {
  label: string
  checked: boolean
  color: string
  onToggle: (checked: boolean) => void
  onColor: (color: string) => void
}) {
  return (
    <div className="field">
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onToggle(event.target.checked)}
        />{' '}
        {props.label}
      </label>
      <input
        type="color"
        aria-label={`${props.label} color`}
        disabled={!props.checked}
        value={props.color}
        onChange={(event) => props.onColor(event.target.value)}
      />
    </div>
  )
}

const PREVIEW_HEIGHT = 420
// Bottom sits above where Reels/TikTok/Shorts put their buttons and captions.
const POSITION_PRESETS = [
  { label: 'Top', y: 15 },
  { label: 'Middle', y: 50 },
  { label: 'Bottom', y: 72 }
]

const layoutOptions: Array<{ value: Layout; title: string; description: string }> = [
  { value: 'blurred', title: 'Blurred background', description: 'Full frame, blurred sides' },
  { value: 'focused', title: 'Focused (crop)', description: 'Fill the 9:16 frame' }
]

/** A paused frame of the source video, used as the preview background. */
function Frame({ video, atMs, className }: { video: string; atMs: number; className: string }) {
  const seek = (event: SyntheticEvent<HTMLVideoElement>): void => {
    event.currentTarget.currentTime = atMs / 1000
  }
  return <video className={className} src={mediaUrl(video)} muted preload="auto" onLoadedMetadata={seek} />
}

/**
 * Layout + caption style controls with a live 9:16 preview. With a sample, the preview shows a
 * real frame and real words from a clip; speakerCount 0 hides the per-speaker colors.
 */
export default function CaptionStyle(props: {
  sample?: { video: string; atMs: number; words: string[] }
  speakerCount: number
  /** Speakers are found per clip when rendering, so the count is not known yet. */
  speakersPerClip?: boolean
}) {
  const { settings, update } = useSettings()
  const [previewSpeaker, setPreviewSpeaker] = useState(0)
  const [dragY, setDragY] = useState<number | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const subtitle = settings.subtitle
  const speakersAvailable = props.speakerCount > 0 || props.speakersPerClip === true
  const speakerColorsOn = subtitle.speakerColors && speakersAvailable

  const setSubtitle = (patch: Partial<SubtitleStyle>): void => {
    update({ subtitle: { ...subtitle, ...patch } })
  }

  const sampleWords =
    props.sample && props.sample.words.length > 0
      ? props.sample.words
      : ['This', 'is', 'how', 'your', 'captions', 'look']
  const words = subtitle.uppercase ? sampleWords.map((word) => word.toUpperCase()) : sampleWords
  const captionSize = Math.round((subtitle.sizePx * PREVIEW_HEIGHT * 10) / 1920) / 10
  // Stroke is painted under the fill (paint-order), so only the outer half shows; double it.
  const outlineSize = Math.max(1, Math.round(captionSize * 0.16 * 10) / 10)
  const fontWeight = CAPTION_FONTS.find((f) => f.family === subtitle.font)?.weight ?? 800
  // Caption height while dragging (not saved until release), else the saved one.
  const captionY = dragY ?? subtitle.positionY
  const yFromPointer = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return subtitle.positionY
    const y = Math.min(95, Math.max(5, ((event.clientY - rect.top) / rect.height) * 100))
    return Math.abs(y - 50) < 2.5 ? 50 : Math.round(y) // snap to the middle
  }

  return (
    <div className="create-grid">
      <div className="create-main">
        <section>
          <h3>Layout</h3>
          <div className="layout-grid">
            {layoutOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={settings.layout === option.value ? 'layout-card selected' : 'layout-card'}
                aria-pressed={settings.layout === option.value}
                onClick={() => update({ layout: option.value })}
              >
                <span className={`mock-frame ${option.value}`} aria-hidden="true">
                  {option.value === 'blurred' ? (
                    <>
                      <span className="mock-bg" />
                      <span className="mock-inner" />
                    </>
                  ) : (
                    <span className="mock-fill" />
                  )}
                </span>
                <span className="layout-text">
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="captions-head">
            <h3>Captions</h3>
            <label className="captions-switch">
              <input
                type="checkbox"
                role="switch"
                checked={subtitle.enabled}
                onChange={(event) => setSubtitle({ enabled: event.target.checked })}
              />
              {subtitle.enabled ? 'On' : 'Off'}
            </label>
          </div>
          <div className={subtitle.enabled ? 'field-grid' : 'field-grid captions-off'}>
            <label className="field">
              Font
              <select value={subtitle.font} onChange={(event) => setSubtitle({ font: event.target.value })}>
                {CAPTION_FONTS.map((f) => (
                  <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                    {f.family}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Size — {subtitle.sizePx}px
              <input
                type="range"
                min={32}
                max={120}
                value={subtitle.sizePx}
                onChange={(event) => setSubtitle({ sizePx: Number(event.target.value) })}
              />
            </label>

            {speakersAvailable ? (
              <label className="field checkbox full">
                <input
                  type="checkbox"
                  checked={subtitle.speakerColors}
                  onChange={(event) => setSubtitle({ speakerColors: event.target.checked })}
                />
                Color by speaker ({props.speakersPerClip ? 'found per clip when rendering' : `${props.speakerCount} found`})
              </label>
            ) : null}

            <div className={speakerColorsOn ? 'field full' : 'field'}>
              <span>{speakerColorsOn ? 'Speaker colors (1 = talks most)' : 'Text color'}</span>
              {speakerColorsOn ? (
                <>
                  <div className="speaker-swatches">
                    {subtitle.speakerPalette.map((c, i) => (
                      <div key={i} className="speaker-swatch">
                        <span className="muted">{i + 1}</span>
                        <input
                          type="color"
                          title={`Speaker ${i + 1}`}
                          aria-label={`Speaker ${i + 1} color`}
                          value={c}
                          onFocus={() => setPreviewSpeaker(i)}
                          onChange={(event) => {
                            setPreviewSpeaker(i)
                            setSubtitle({
                              speakerPalette: subtitle.speakerPalette.map((old, j) =>
                                j === i ? event.target.value : old
                              )
                            })
                          }}
                        />
                        {subtitle.speakerPalette.length > 1 ? (
                          <button
                            type="button"
                            className="swatch-remove"
                            aria-label={`Remove speaker ${i + 1}`}
                            title="Remove"
                            onClick={() => {
                              setPreviewSpeaker(0)
                              setSubtitle({
                                speakerPalette: subtitle.speakerPalette.filter((_, j) => j !== i)
                              })
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {subtitle.speakerPalette.length < MAX_SPEAKER_COLORS ? (
                      <button
                        type="button"
                        className="button small"
                        onClick={() => {
                          const next = subtitle.speakerPalette.length
                          setPreviewSpeaker(next)
                          setSubtitle({
                            speakerPalette: [
                              ...subtitle.speakerPalette,
                              SPEAKER_COLOR_SUGGESTIONS[next] ?? '#FFFFFF'
                            ]
                          })
                        }}
                      >
                        + Add speaker
                      </button>
                    ) : null}
                  </div>
                  <label className="speaker-other">
                    <input
                      type="color"
                      aria-label="Everyone else color"
                      value={subtitle.otherSpeakersColor}
                      onFocus={() => setPreviewSpeaker(-1)}
                      onChange={(event) => {
                        setPreviewSpeaker(-1)
                        setSubtitle({ otherSpeakersColor: event.target.value })
                      }}
                    />
                    Everyone else (speakers beyond {subtitle.speakerPalette.length})
                  </label>
                </>
              ) : (
                <input
                  type="color"
                  aria-label="Text color"
                  value={subtitle.color}
                  onChange={(event) => setSubtitle({ color: event.target.value })}
                />
              )}
            </div>

            <ToggleColor
              label="Highlight active word"
              checked={subtitle.highlight}
              color={subtitle.highlightColor}
              onToggle={(highlight) => setSubtitle({ highlight })}
              onColor={(highlightColor) => setSubtitle({ highlightColor })}
            />

            <ToggleColor
              label="Outline"
              checked={subtitle.outline}
              color={subtitle.outlineColor}
              onToggle={(outline) => setSubtitle({ outline })}
              onColor={(outlineColor) => setSubtitle({ outlineColor })}
            />

            <div className="field">
              Position — {captionY}% from the top
              <div className="position-presets">
                {POSITION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={subtitle.positionY === preset.y ? 'button small selected' : 'button small'}
                    onClick={() => setSubtitle({ positionY: preset.y })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <span className="muted">Or drag the caption in the preview.</span>
            </div>

            <label className="field checkbox">
              <input
                type="checkbox"
                checked={subtitle.uppercase}
                onChange={(event) => setSubtitle({ uppercase: event.target.checked })}
              />
              Uppercase
            </label>
          </div>
        </section>
      </div>

      <aside className="create-side">
        {speakerColorsOn ? (
          <div className="speaker-preview-tabs" role="tablist" aria-label="Preview speaker">
            {[
              ...subtitle.speakerPalette.map((color, i) => ({ i, color, label: `Speaker ${i + 1}` })),
              { i: -1, color: subtitle.otherSpeakersColor, label: 'Everyone else' }
            ].map(({ i, color, label }) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={previewSpeaker === i}
                className={previewSpeaker === i ? 'button small selected' : 'button small'}
                onClick={() => setPreviewSpeaker(i)}
              >
                <span className="swatch-dot" style={{ background: color }} /> {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="preview-wrap">
          <div className={`preview-frame ${settings.layout}${props.sample ? ' has-frame' : ''}`} ref={frameRef}>
            <div className="preview-backdrop">
              {props.sample && settings.layout === 'blurred' ? (
                <Frame className="preview-video" video={props.sample.video} atMs={props.sample.atMs} />
              ) : null}
            </div>
            <div className="preview-content">
              {props.sample ? (
                <Frame className="preview-video" video={props.sample.video} atMs={props.sample.atMs} />
              ) : null}
            </div>
            {dragY !== null ? (
              <div className="preview-guides" aria-hidden="true">
                <div className="guide-zone top" />
                <div className="guide-center" />
                <div className="guide-zone bottom">May be covered by app buttons</div>
              </div>
            ) : null}
            {subtitle.enabled ? (
            <div
              className={dragY !== null ? 'preview-caption dragging' : 'preview-caption'}
              style={{ top: `${captionY}%` }}
              role="slider"
              tabIndex={0}
              aria-label="Caption position"
              aria-valuemin={5}
              aria-valuemax={95}
              aria-valuenow={captionY}
              title="Drag to move the captions"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setDragY(yFromPointer(event))
              }}
              onPointerMove={(event) => {
                if (dragY !== null) setDragY(yFromPointer(event))
              }}
              onPointerUp={() => {
                if (dragY !== null) setSubtitle({ positionY: dragY })
                setDragY(null)
              }}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                if (step === 0) return
                event.preventDefault()
                setSubtitle({ positionY: Math.min(95, Math.max(5, subtitle.positionY + step)) })
              }}
            >
              <div
                className="caption-text"
                style={{
                  fontFamily: `"${subtitle.font}", "Arial Black", Arial, sans-serif`,
                  fontWeight,
                  fontSize: captionSize,
                  color: speakerColorsOn
                    ? (subtitle.speakerPalette[previewSpeaker] ?? subtitle.otherSpeakersColor)
                    : subtitle.color,
                  WebkitTextStroke: subtitle.outline ? `${outlineSize}px ${subtitle.outlineColor}` : undefined,
                  paintOrder: 'stroke fill',
                  textShadow: '0 2px 8px rgba(0, 0, 0, 0.45)'
                }}
              >
                {words.map((word, index) => (
                  <span
                    key={`${word}-${index}`}
                    style={subtitle.highlight && index === 1 ? { color: subtitle.highlightColor } : undefined}
                  >
                    {word}
                    {index < words.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </div>
            </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  )
}
