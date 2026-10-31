import NotImplemented from '../components/NotImplemented'

export default function Queue() {
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Queue</h1>
        <p>Watch processing jobs and the stage each one is on.</p>
      </div>
      <NotImplemented phase={3} />
    </div>
  )
}
