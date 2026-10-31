import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import Create from './screens/Create'
import Models from './screens/Models'
import Queue from './screens/Queue'
import Results from './screens/Results'
import SettingsScreen from './screens/Settings'

const navItems = [
  { to: '/create', label: 'Create' },
  { to: '/queue', label: 'Queue' },
  { to: '/results', label: 'Results' },
  { to: '/models', label: 'Models' },
  { to: '/settings', label: 'Settings' }
]

export default function App() {
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
          <span className="queue-dot" aria-hidden="true" />
          Queue empty
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
