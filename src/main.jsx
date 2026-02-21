import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

function updateAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${h}px`)
}
window.visualViewport?.addEventListener('resize', updateAppHeight)
window.addEventListener('resize', updateAppHeight)
updateAppHeight()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
