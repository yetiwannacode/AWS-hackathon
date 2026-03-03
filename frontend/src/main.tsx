import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App.tsx'
import './styles/tailwind.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
const LEGACY_API_PREFIXES = ['http://localhost:8000', 'http://127.0.0.1:8000']

const originalFetch = window.fetch.bind(window)
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
        let nextInput = input
        LEGACY_API_PREFIXES.forEach((prefix) => {
            if (nextInput.startsWith(prefix)) {
                nextInput = nextInput.replace(prefix, API_BASE_URL)
            }
        })
        return originalFetch(nextInput, init)
    }
    return originalFetch(input, init)
}) as typeof window.fetch

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
