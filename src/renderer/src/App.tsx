import { useState, type ReactNode } from 'react'
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
import symbol from '../../../resources/brand/siftora-symbol-small.svg'

/** 20 px line icons in the text colour. */
const icon = (paths: ReactNode): ReactNode => (
  <svg className="nav-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
)

const navItems = [
  { to: '/create', label: 'Create', icon: icon(<><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></>) },
  { to: '/queue', label: 'Queue', icon: icon(<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />) },
  { to: '/results', label: 'Results', icon: icon(<><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 9.5v5l4-2.5z" /></>) },
  { to: '/models', label: 'Models', icon: icon(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>) },
  { to: '/settings', label: 'Settings', icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>) }
]

const COLLAPSED_KEY = 'sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const { settings } = useSettings()
  const { models } = useModels()
  const { jobs } = useJobs()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleSidebar = (): void => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {
      // Only a convenience; the sidebar still toggles.
    }
  }

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
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="brand">
          <img src={collapsed ? symbol : logo} alt="Siftora" />
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              <span className="nav-label">{item.label}</span>
              {item.to === '/queue' && toDo > 0 ? (
                <span className="nav-count" title={`${toDo} to do`}>
                  {toDo}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {icon(<path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />)}
          <span className="nav-label">Collapse</span>
        </button>
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
