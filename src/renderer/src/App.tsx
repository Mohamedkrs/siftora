import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { CATALOG } from '../../shared/catalog'
import Create from './screens/Create'
import Models from './screens/Models'
import Onboarding from './screens/Onboarding'
import Queue from './screens/Queue'
import Results from './screens/Results'
import SettingsScreen from './screens/Settings'
import { useModels } from './state/models'
import { useSettings } from './state/settings'

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

  if (!settings.onboarded) return <Onboarding />

  const downloading = Object.values(models).find((state) => state.status === 'downloading')
  const entry = downloading ? CATALOG.find((model) => model.id === downloading.id) : undefined
  const percent =
    downloading && entry
      ? Math.min(100, Math.round((downloading.receivedBytes / entry.bytes) * 100))
      : 0

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Viral Clip <span>Finder</span>
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="queue-strip">
          <span className={downloading ? 'queue-dot active' : 'queue-dot'} aria-hidden="true" />
          {downloading
            ? `Downloading ${entry?.name ?? downloading.id} — ${percent}%`
            : 'Queue empty'}
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
