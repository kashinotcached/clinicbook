import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { finishSignIn } from './sync/drive'

// Google sign-in returns to the app with the token in the address; take it out before the app reads the address
finishSignIn()
  .catch((e) => String(e))
  .then((signInError) => {
    if (signInError) sessionStorage.setItem('signInError', signInError)
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
