interface Props {
  phase: number
  note?: string
}

export default function NotImplemented({ phase, note }: Props) {
  return (
    <div className="not-implemented" role="status">
      <strong>Not implemented yet — coming in Phase {phase}</strong>
      {note ? <span className="not-implemented-note">— {note}</span> : null}
    </div>
  )
}
