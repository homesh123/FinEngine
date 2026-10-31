import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import AppShell from './components/AppShell.jsx'
import InvestmentScreener from './components/InvestmentScreener.jsx'
import DayTrader from './pages/DayTrader.jsx'
import './index.css'

// Hash routing works on GitHub Pages without a server: ./#daytrader is the desk,
// anything else (including the screener's own #top5) is the screener.
const pageOf = () => (window.location.hash.replace(/^#\/?/, '').toLowerCase() === 'daytrader' ? 'daytrader' : 'screener')

const MARKET_KEY = 'fe.market'

// One market for both pages. India by default; earlier per-page choices carry over.
function initialMarket() {
  try {
    const saved = localStorage.getItem(MARKET_KEY) || localStorage.getItem('dtMarket') || localStorage.getItem('screenerMarket')
    return saved === 'US' ? 'US' : 'IN'
  } catch {
    return 'IN'
  }
}

function initialTheme() {
  try {
    return JSON.parse(localStorage.getItem('chartState') || '{}').theme === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function App() {
  const [page, setPage] = useState(pageOf)
  const [market, setMarket] = useState(initialMarket)
  const [theme, setTheme] = useState(initialTheme)
  const [source, setSource] = useState(null)

  useEffect(() => {
    const onHash = () => { setPage(pageOf()); setSource(null) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const changeMarket = (m) => {
    try { localStorage.setItem(MARKET_KEY, m) } catch { /* storage unavailable */ }
    setMarket(m)
  }
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try {
      const st = JSON.parse(localStorage.getItem('chartState') || '{}')
      localStorage.setItem('chartState', JSON.stringify({ ...st, theme: next }))
    } catch { /* storage unavailable */ }
    setTheme(next)
  }

  return (
    <AppShell page={page} market={market} onMarket={changeMarket} dark={theme === 'dark'} onTheme={toggleTheme} source={source}>
      {page === 'daytrader'
        ? <DayTrader key={market} market={market} onSource={setSource} />
        : <InvestmentScreener key={market} market={market} onSource={setSource} />}
    </AppShell>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
