import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * A whole-number field that lets you type freely (clear it, type 33 over 1) and saves only once the
 * text is valid; until then it says what is wrong under the field.
 */
export default function NumberField(props: {
  label: ReactNode
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  /** Messages for out-of-range values, e.g. when `max` is another field's value. */
  tooSmall?: string
  tooBig?: string
}) {
  const { value, min, max, onCommit } = props
  const [text, setText] = useState(String(value))
  const errorId = useId()
  const input = useRef<HTMLInputElement>(null)

  // Changed elsewhere ("Use the settings for all", another screen): show the new value. Not while
  // typing: an older save coming back would overwrite what is being typed.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(String(value))
  }, [value])

  const problem = (draft: string): string | null =>
    draft.trim() === ''
      ? 'Enter a number.'
      : Number(draft) < min
        ? (props.tooSmall ?? `At least ${min}.`)
        : Number(draft) > max
          ? (props.tooBig ?? `At most ${max}.`)
          : null
  const error = problem(text)

  // Saves only on typing, and when the bounds move (33 saves once the longest becomes 33 or
  // more); saving on every render ping-pongs with the settings round trip.
  useEffect(() => {
    if (!problem(text) && Number(text) !== value) onCommit(Number(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max])

  return (
    <label className="field">
      {props.label}
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          const draft = event.target.value
          if (!/^\d{0,6}$/.test(draft)) return
          setText(draft)
          if (!problem(draft) && Number(draft) !== value) onCommit(Number(draft))
        }}
      />
      {error ? (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
