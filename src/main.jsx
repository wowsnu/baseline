import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import './styles.css'
import './review.css'

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

