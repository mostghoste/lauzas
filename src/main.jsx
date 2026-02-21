import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import './index.css'
import App from './App.jsx'

inject()

function updateAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${h}px`)
  const list = document.querySelector('.message-list')
  if (list) list.scrollTop = list.scrollHeight
}
window.visualViewport?.addEventListener('resize', updateAppHeight)
window.addEventListener('resize', updateAppHeight)
updateAppHeight()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
