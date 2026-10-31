import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { SettingsProvider } from './state/settings'
import './fonts.css'
import './styles.css'

window.addEventListener('error', (event) => {
  window.api.log(
    'error',
    `window error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`
  )
})

window.addEventListener('unhandledrejection', (event) => {
  window.api.log('error', `unhandled rejection: ${String(event.reason)}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>
)
