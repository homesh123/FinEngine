import React from 'react'
import ReactDOM from 'react-dom/client'
import InvestPage from './InvestPage.jsx'
import DayTrader from './pages/DayTrader.jsx'
import './index.css'

const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase()
const isDayTrader = hash === 'daytrader'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isDayTrader ? <DayTrader /> : <InvestPage />}
  </React.StrictMode>,
)
