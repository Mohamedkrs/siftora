import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { CATALOG } from '../../shared/catalog'
import { ENGINES, engineBytes, engineLabel } from '../../shared/engines'
import { STAGE_LABELS } from '../../shared/jobs'
import Create from './screens/Create'
import Models from './screens/Models'
import Onboarding from './screens/Onboarding'
import Queue from './screens/Queue'
import Results from './screens/Results'
import SettingsScreen from './screens/Settings'
import { isActive, useJobs } from './state/jobs'
import { useModels } from './state/models'
import { useSettings } from './state/settings'
import logo from '../../../resources/brand/siftora-horizontal-small-on-dark.svg'

const navItems = [
  { to: '/create', label: 'Create' },
  { to: '/queue', label: 'Queue' },
  { to: '/results', label: 'Results' },
  { to: '/models', label: 'Models' },
  { to: '/settings', label: 'Settings' }
]

export default function App() {
  const { settings } = useSettings()
  const { models } = useModels()
  const { jobs } = useJobs()
  const navigate = useNavigate()

  if (!settings.onboarded) return <Onboarding />

  const downloading = Object.values(models).find((state) => state.status === 'downloading')
  const model = downloading ? CATALOG.find((entry) => entry.id === downloading.id) : undefined
  const engine =
    downloading && !model ? ENGINES.find((entry) => entry.id === downloading.id) : undefined
  const totalBytes = model ? model.bytes : engine ? engineBytes(engine) : 0
  const name = model ? model.name : engine ? engineLabel(engine) : downloading?.id
  const percent =
    downloading && totalBytes > 0
      ? Math.min(100, Math.round((downloading.receivedBytes / totalBytes) * 100))
      : 0

  const activeJob = jobs.find(isActive)
  const waiting = jobs.filter((job) => job.stage === 'queued').length
  const toDo = waiting + jobs.filter(isActive).length

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="Siftora" />
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
              {item.to === '/queue' && toDo > 0 ? (
                <span className="nav-count" title={`${toDo} to do`}>
                  {toDo}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="queue-strip" onClick={() => navigate('/queue')} title="Open the queue">
          <span className={downloading || activeJob ? 'queue-dot active' : 'queue-dot'} aria-hidden="true" />
          {activeJob
            ? `${activeJob.title} — ${STAGE_LABELS[activeJob.stage]} ${Math.round(activeJob.progress * 100)}%${waiting > 0 ? ` · ${waiting} waiting` : ''}`
            : downloading
              ? `Downloading ${name} — ${percent}%`
              : waiting > 0
                ? `${waiting} waiting`
                : 'Queue empty'}
          {activeJob ? (
            <span className="strip-progress">
              <span style={{ width: `${Math.round(activeJob.progress * 100)}%` }} />
            </span>
          ) : null}
        </header>

        <main className="content">
          <Routes>
            <Route path="/create" element={<Create />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/results" element={<Results />} />
            <Route path="/models" element={<Models />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/create" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
