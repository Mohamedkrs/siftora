import { useId, useState } from 'react'

const clean = (text: string): string => text.trim().toLowerCase().slice(0, 50)

/**
 * Tags as removable chips plus a box to type more. Typing shows the matching tags already in use
 * (↑/↓ to move, Enter or click to add); Enter or a comma also adds what was typed as a new tag.
 */
export default function TagInput(props: {
  value: string[]
  /** Tags in use elsewhere, offered while typing. */
  suggestions: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  label: string
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const typed = clean(text)
  const matches = props.suggestions
    .filter((tag) => !props.value.includes(tag) && (typed === '' || tag.includes(typed)))
    // Tags that start with what was typed first.
    .sort((a, b) => Number(b.startsWith(typed)) - Number(a.startsWith(typed)) || a.localeCompare(b))
    .slice(0, 8)
  const showList = open && matches.length > 0

  const add = (tag: string): void => {
    const next = clean(tag)
    if (next && !props.value.includes(next)) props.onChange([...props.value, next])
    setText('')
    setActive(0)
  }

  return (
    <div
      className="tag-input"
      onBlur={(event) => {
        // Leaving the field keeps a half-typed tag.
        if (event.currentTarget.contains(event.relatedTarget)) return
        add(text)
        setOpen(false)
      }}
    >
      {props.value.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => props.onChange(props.value.filter((item) => item !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={text}
        role="combobox"
        aria-label={props.label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        placeholder={props.value.length === 0 ? props.placeholder : ''}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          // A comma (typed or pasted) ends a tag.
          const parts = event.target.value.split(',')
          if (parts.length > 1) {
            const tags = parts.slice(0, -1).map(clean).filter((tag) => tag && !props.value.includes(tag))
            if (tags.length > 0) props.onChange([...new Set([...props.value, ...tags])])
          }
          setText(parts[parts.length - 1])
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && showList) setActive((active + 1) % matches.length)
          else if (event.key === 'ArrowUp' && showList) setActive((active - 1 + matches.length) % matches.length)
          else if (event.key === 'Enter') add(showList && (typed === '' || matches[active]?.startsWith(typed)) ? matches[active] : text)
          else if (event.key === 'Escape') setOpen(false)
          else if (event.key === 'Backspace' && text === '' && props.value.length > 0) props.onChange(props.value.slice(0, -1))
          else return
          event.preventDefault()
        }}
      />
      {showList ? (
        <ul id={listId} role="listbox" className="tag-list">
          {matches.map((tag, index) => (
            <li
              key={tag}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              // Before the input's blur, so the click lands.
              onMouseDown={(event) => {
                event.preventDefault()
                add(tag)
              }}
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
