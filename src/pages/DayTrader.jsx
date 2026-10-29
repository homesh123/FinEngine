import React, { useState, useEffect } from 'react';
import { ArrowRight, AlertCircle, CheckCircle, Clock, Scanner, Newspaper, Target, RefreshCw, DollarSign, ShieldAlert, Send, Bell, FileText, Users, Smartphone, Play, StopWatch } from 'lucide-react';

const ROUTE_LINKS = {
  scanner: '/trader-scanner',
  news: '/trader-news',
  entry: '/trader-entry',
  exit: '/trader-exit',
  timemachine: '/trader-timemachine',
  budget: '/trader-budget',
  risk: '/trader-risk',
  broker: '/trader-broker',
  alerts: '/trader-alerts',
  analyst: '/trader-analyst',
  congress: '/trader-pelosi',
};

const SKILLS = [
  {
    key: 'scanner',
    icon: <Scanner size={20} strokeWidth={2} />,
    title: 'Scanner',
    desc: 'Sweeps the market for breakouts, flags and oversold bounces.',
    action: 'Scan for opening-range breakouts in NVDA, TSLA, AAPL, MSFT, META, AMD',
    docs: '/trader-scanner',
  },
  {
    key: 'news',
    icon: <Newspaper size={20} strokeWidth={2} />,
    title: 'News Desk',
    desc: 'Headlines and SEC filings for the stocks you are watching.',
    action: 'Any news on NVDA today?',
    docs: '/trader-news',
  },
  {
    key: 'entry',
    icon: <Clock size={20} strokeWidth={2} />,
    title: 'Entry Timer',
    desc: 'Watches a setup candle by candle and calls the moment to buy.',
    action: 'Watch NVDA and tell me when it triggers',
    docs: '/trader-entry',
  },
  {
    key: 'exit',
    icon: <Target size={20} strokeWidth={2} />,
    title: 'Exit Planner',
    desc: 'Sets your stop-loss and profit target before you are in.',
    action: 'Set my stop and target for NVDA breakout',
    docs: '/trader-exit',
  },
  {
    key: 'timemachine',
    icon: <StopWatch size={20} strokeWidth={2} />,
    title: 'Time Machine',
    desc: 'Replays the rest of the day 10,000 times and gives you the odds.',
    action: 'Replay this trade. What are the odds?',
    docs: '/trader-timemachine',
  },
  {
    key: 'budget',
    icon: <DollarSign size={20} strokeWidth={2} />,
    title: 'Position Sizer',
    desc: 'How many shares fit your account and your max loss.',
    action: 'I have $5,000 and want to risk $50 max. How many shares?',
    docs: '/trader-budget',
  },
  {
    key: 'risk',
    icon: <ShieldAlert size={20} strokeWidth={2} />,
    title: 'Risk Manager',
    desc: 'Blocks any trade that breaks your limits.',
    action: 'Risk check this setup before I buy',
    docs: '/trader-risk',
  },
  {
    key: 'broker',
    icon: <Send size={20} strokeWidth={2} />,
    title: 'Order Desk',
    desc: 'Sends approved orders to your broker, paper by default.',
    action: 'Send this trade to paper account',
    docs: '/trader-broker',
  },
  {
    key: 'alerts',
    icon: <Bell size={20} strokeWidth={2} />,
    title: 'Alerts',
    desc: 'Pings you at your stop, your target, and before the close.',
    action: 'Alert me when NVDA hits stop or target',
    docs: '/trader-alerts',
  },
  {
    key: 'analyst',
    icon: <FileText size={20} strokeWidth={2} />,
    title: 'Earnings Analyst',
    desc: 'Reads a company\u2019s latest reported numbers from SEC filings.',
    action: 'Read NVDA latest SEC earnings report',
    docs: '/trader-analyst',
  },
  {
    key: 'congress',
    icon: <Users size={20} strokeWidth={2} />,
    title: 'Congress Tracker',
    desc: 'New stock-trade disclosures filed by members of Congress.',
    action: 'Recent congress stock trades',
    docs: '/trader-pelosi',
  },
];

function SkillCard({ skill }) {
  return (
    <div className="border border-slate-700 dark:border-borderdark rounded-xl p-4 flex flex-col justify-between hover:bg-darkbg dark:hover:bg-surfacebg transition-colors h-full group">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-emerald-400">
          {skill.icon}
        </div>
        <span className="font-semibold text-slate-200 dark:text-white">{skill.title}</span>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-1">{skill.desc}</p>
      <button
        className="w-full text-left py-2 px-3 rounded-lg border border-slate-800 dark:border-borderdark bg-slate-900/50 text-slate-300 text-sm font-medium hover:text-emerald-400 hover:border-emerald-500 transition-colors flex items-center justify-between"
        onClick={() => window.open(skill.action.startsWith('http') ? skill.action : `https://claude.ai/new?message=${encodeURIComponent(skill.action)}`, '_blank')}
      >
        <span>{skill.action.length > 45 ? skill.action.slice(0, 45) + '…' : skill.action}</span>
        <ArrowRight size={14} strokeWidth={2} />
      </button>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-500">
        Open in Claude Code: <span className="text-emerald-400">{skill.docs}</span>
      </div>
    </div>
  );
}

export default function DayTrader() {
  const [active, setActive] = useState(null);
  const [results, setResults] = useState('');

  const runSkill = (skill) => {
    setActive(skill.key);
    setResults(`Running ${skill.title}…\n\nType: "${skill.action}" in Claude Code.\n\nDocumentation: ${skill.docs}\n\nThis skill reads free public data (Yahoo Finance, Nasdaq, NYSE, SEC). No API key or signup required. Paper trading is the default — nothing executes without your typed yes.`);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-darkbg text-slate-900 dark:text-slate-200 font-sans">
      <header className="border-b border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-bold">D</div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">FinEngine Day Trader</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Claude's free day-trading desk — eleven open-source skills</p>
            </div>
          </div>
          <div className="hidden md:flex gap-2 px-6 py-2 border border-slate-200 dark:border-borderdark rounded-full bg-white dark:bg-cardbg">
            <button onClick={() => setActive(null)} className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${active === null ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-emerald-500'}`}>All Skills</button>
            {SKILLS.map((s) => (
              <button key={s.key} onClick={() => setActive(s.key)} className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${active === s.key ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-emerald-500'}`}>{s.title}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {!active ? (
          <>
            <div className="bg-slate-100 dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-borderdark">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                  <Play size={24} strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-white">The Desk</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Eleven skills. Eleven jobs. $0. Each skill passes its work to the next — run top to bottom.</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {SKILLS.map((s) => (
                  <div key={s.key} className="border border-slate-200 dark:border-borderdark rounded-xl p-4 flex flex-col justify-between hover:border-emerald-500 hover:bg-white dark:hover:bg-slate-900/50 transition-colors group">
                    <div className="flex items-center gap-3 mb-3">
                      {s.icon}
                      <span className="font-semibold text-slate-800 dark:text-white">{s.title}</span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex-1">{s.desc}</p>
                    <button
                      onClick={() => runSkill(s)}
                      className="w-full text-left py-2 px-3 rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center justify-between"
                    >
                      <span>{s.action}</span>
                      <ArrowRight size={14} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-slate-200 dark:border-borderdark pt-4 bg-white dark:bg-cardbg rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-2">How to run the desk</h3>
                <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside">
                  <li><strong>Find a setup.</strong> "Scan for opening-range breakouts in NVDA, TSLA, AAPL, MSFT, META, AMD."</li>
                  <li><strong>Check the news</strong> on the one you like. "Any news on NVDA today?"</li>
                  <li><strong>Time the entry.</strong> "Watch NVDA and tell me when it triggers."</li>
                  <li><strong>Plan the exit before you buy.</strong> "Set my stop and target."</li>
                  <li><strong>Run the Time Machine.</strong> "Replay this trade. What are the odds?"</li>
                  <li><strong>Size it.</strong> "I have $5,000 and want to risk $50 max. How many shares?"</li>
                  <li><strong>Risk check, then you decide.</strong> If it passes, the order desk sends it to paper. You type yes. Nothing executes without you.</li>
                </ol>
              </div>
            </div>

            <div className="rounded-xl p-6 border border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4">About Day Trader Skill</h2>
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <p>The <strong>day-trader-skill</strong> pack (by Jake Schincariol, MIT licence) is plain Python that reads free public data (Yahoo Finance prices, Nasdaq symbol lists, SEC filings). No API key, no signup, nothing to pay. It never trades on its own — every order needs your yes, and paper trading is the default.</p>
                <h4 className="font-bold text-slate-800 dark:text-white mt-4 mb-1">The Time Machine</h4>
                <p>You give it a trade: entry, stop-loss and target. It rebuilds the rest of that trading day <strong>10,000 times</strong>, stitching together real 5-minute moves the stock made at that time of day over the last ~60 sessions. Every replay ends one of three ways: target (win), stop (small planned loss), or neither (close at close decides).</p>
                <p><strong>Key rule:</strong> With a 2R target, you need to win about 1 in 3 to break even. With a 1R target, about 1 in 2. The verdict line does that maths for you.</p>
                <p className="mt-2 text-sm text-slate-500 italic">Educational only — nothing here is financial advice. Day trading is risky and most day traders lose money. Start on paper for a few weeks before a real dollar goes in.</p>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white dark:bg-cardbg rounded-xl border border-slate-200 dark:border-borderdark p-6">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setActive(null)} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hover:text-emerald-500">
                <ArrowLeft size={16} /> Back to desk
              </button>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Active</span>
              </div>
            </div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{SKILLS.find(s => s.key === active)?.title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{SKILLS.find(s => s.key === active)?.desc}</p>
            <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">{results}</div>
            <div className="mt-4">
              <button
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2"
                onClick={() => window.open(`https://claude.ai/new?message=${encodeURIComponent(SKILLS.find(s => s.key === active)?.action)}`, '_blank')}
              >
                <ArrowRight size={16} strokeWidth={2} />
                Open skill in Claude Code
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            FinEngine Day Trader Desk · Day trader skill by Jake Schincariol · MIT licensed · Educational only — nothing here is financial advice
          </p>
        </div>
      </footer>
    </div>
  );
}
