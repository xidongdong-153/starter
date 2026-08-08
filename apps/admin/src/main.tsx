import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './assets/styles/index.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('找不到 #root，检查 index.html 是否包含应用挂载节点')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
