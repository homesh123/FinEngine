import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import InvestPage from './InvestPage.jsx'
import DayTrader from './pages/DayTrader.jsx'
import './index.css'

// Hash routing works on GitHub Pages without a server: ./#daytrader is the desk,
// anything else (including the screener's own #top5) is the screener.
const isDayTrader = () => window.location.hash.replace(/^#\/?/, '').toLowerCase() === 'daytrader'

function App() {
  const [dayTrader, setDayTrader] = useState(isDayTrader)
  useEffect(() => {
    const onHash = () => setDayTrader(isDayTrader())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return dayTrader ? <DayTrader /> : <InvestPage />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
