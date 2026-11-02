import { useEffect, useId, useState, type ReactNode } from 'react'

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

  // Changed elsewhere ("Use the settings for all", another screen): show the new value.
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== '' ? current : String(value)))
  }, [value])

  const number = Number(text)
  const error =
    text.trim() === ''
      ? 'Enter a number.'
      : number < min
        ? (props.tooSmall ?? `At least ${min}.`)
        : number > max
          ? (props.tooBig ?? `At most ${max}.`)
          : null

  // Also re-checked when the bounds move, so 33 saves as soon as the longest becomes 33 or more.
  useEffect(() => {
    if (!error && number !== value) onCommit(number)
  }, [error, number, value, onCommit])

  return (
    <label className="field">
      {props.label}
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          if (/^\d{0,6}$/.test(event.target.value)) setText(event.target.value)
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
