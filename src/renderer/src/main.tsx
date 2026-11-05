import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Overlay } from './Overlay'
import './styles.css'

// the PS button menu window loads this page with #overlay
const page = window.location.hash === '#overlay' ? <Overlay /> : <App />
createRoot(document.getElementById('root')!).render(page)
