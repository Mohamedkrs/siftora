import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { applyEngineList } from '../../shared/engines'
import App from './App'
import { DialogProvider } from './components/Dialog'
import ErrorBoundary from './components/ErrorBoundary'
import { JobsProvider } from './state/jobs'
import { ModelsProvider } from './state/models'
import { SettingsProvider } from './state/settings'
import './fonts.css'
import './styles.css'

window.addEventListener('error', (event) => {
  window.api.log('error', `window error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`)
})

window.addEventListener('unhandledrejection', (event) => {
  window.api.log('error', `unhandled rejection: ${String(event.reason)}`)
})

// The renderer has its own copy of the engine catalog; keep it in step with the main process.
window.api.onEngineList(applyEngineList)
void window.api
  .getEngineList()
  .then(applyEngineList)
  .catch((err: unknown) => window.api.log('warn', `getEngineList failed: ${String(err)}`))
  .finally(render)

function render(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <DialogProvider>
          <SettingsProvider>
            <ModelsProvider>
              <JobsProvider>
                <App />
              </JobsProvider>
            </ModelsProvider>
          </SettingsProvider>
          </DialogProvider>
        </HashRouter>
      </ErrorBoundary>
    </StrictMode>
  )
}
