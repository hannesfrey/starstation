import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Overlay } from './Overlay'
import { IconSheet } from './IconSheet'
import './styles.css'

// the PS button menu window loads this page with #overlay; #icons is the design check page (all icons and glyphs)
const pageFor = (hash: string) => (hash === '#overlay' ? <Overlay /> : hash === '#icons' ? <IconSheet /> : <App />)
const root = createRoot(document.getElementById('root')!)
root.render(pageFor(window.location.hash))
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#icons') root.render(<IconSheet />)
})
