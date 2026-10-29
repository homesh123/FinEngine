import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { MARKET_SESSION_DEFAULTS, MARKET_SESSION_SLOTS } from '../utils/marketSessions';
import { LIVERMORE_DEFAULTS } from '../utils/dataEngine';
import { MACD_HS_DEFAULTS } from '../utils/macdHs';
import { LONDON_BREAKOUT_DEFAULTS } from '../utils/londonBreakout';
import { BTC_TURTLE_DEFAULTS } from '../utils/btcTurtle';
import { WHALE_DEFAULTS } from '../utils/whalePulse';
import { ICHIMOKU_DEFAULTS } from '../utils/ichimoku';
import { maLine } from '../utils/movingAverages';
import { MARKET_PROFILE_DEFAULTS } from '../utils/marketProfile';

export default function IndicatorSettingsModal({ activeIndicator, state, setState, onClose }) {
    const [initialSettings, setInitialSettings] = useState(null);

    useEffect(() => {
        if (activeIndicator && state.indicatorSettings) {
            setInitialSettings(JSON.parse(JSON.stringify(state.indicatorSettings)));
        }
    }, [activeIndicator]);

    if (!activeIndicator) return null;

    const handleUpdate = (key, val) => {
        let finalVal = val;
        if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
            finalVal = Number(val);
        }
        
        setState(prev => ({
            ...prev,
            indicatorSettings: {
                ...prev.indicatorSettings,
                [key]: finalVal
            }
        }));
    };

    const titleMap = {
        sma: "SMA Settings",
        ema: "EMA Settings",
        rsi: "RSI Settings",
        demarker: "DeMarker Settings",
        macd: "MACD Settings",
        cvd: "Order Flow CVD Settings",
        sdPro: "Supply/Demand Pro Settings",
        qit: "QIT Strategy Settings",
        fxProfile: "FX24HR Profile Settings",
        mtfOb: "Multi-Timeframe Order Blocks",
        vbr: "Volume-Based Support & Resistance",
        goldMove: "Gold Move Settings",
        maRibbon: "MA Ribbon Settings",
        smcPro: "SMC Pro + Predictor Settings",
        lsr: "Liquidity Sweep Reversal (LSR) Settings",
        sessions: "Market Sessions Settings",
        nextProjection: "Next-Candle Projection",
        volume: "Volume Settings",
        vwap: "VWAP Settings",
        bollinger: "Bollinger Bands Settings",
        movingAvg: "Moving Average Settings",
        ichimoku: "Ichimoku Cloud Settings",
        whalePulse: "Whale Pulse Settings",
        livermore: "Livermore Gold Trend v12 PRO",
        macdHs: "MACD H&S Breakout Scanner",
        londonBreakout: "London Breakout (Big Ben)",
        btcTurtle: "BTC Turtle Breakout (H4)"
    };

    const defaultSettings = {
        sessions: MARKET_SESSION_DEFAULTS,
        maRibbon: {
            ma1Show: true, ma1Type: 'SMA', ma1Len: 20, ma1Color: '#f6c309',
            ma2Show: true, ma2Type: 'SMA', ma2Len: 50, ma2Color: '#fb9800',
            ma3Show: true, ma3Type: 'SMA', ma3Len: 100, ma3Color: '#fb6500',
            ma4Show: true, ma4Type: 'SMA', ma4Len: 200, ma4Color: '#f60c0c',
        },
        rsi: { rsiPeriod: 14, rsiOb: 70, rsiOs: 30, rsiMaLen: 14 },
        demarker: { demPeriod: 14, demOb: 0.7, demOs: 0.3 },
        volume: { volMaLen: 20, volMaType: 'SMA', volMaShow: true, volMaColor: '#007aff', volUpColor: '#26a69a', volDnColor: '#ef5350', volHighMult: 2, volDisplay: 'pane' },
        vwap: { vwapAnchor: 'Session', vwapBands: true, vwapBand1: 1, vwapBand2: 2 },
        bollinger: { bbLength: 20, bbMult: 2, bbSource: 'close', bbMaType: 'SMA', bbFill: true },
        movingAvg: { mvOn: true, mvType: 'EMA', mvLen: 20, mvSource: 'close', mvColor: '#2962ff', mvWidth: 2, mvStyle: 'solid',
            mv2On: false, mv2Type: 'SMA', mv2Len: 50, mv2Source: 'close', mv2Color: '#ff9500', mv2Width: 2, mv2Style: 'solid',
            mv3On: false, mv3Type: 'SMA', mv3Len: 200, mv3Source: 'close', mv3Color: '#af52de', mv3Width: 2, mv3Style: 'solid',
            mvRibbon: false, mvCrosses: false, mvAxisTags: true },
        ichimoku: { ...ICHIMOKU_DEFAULTS },
        whalePulse: { ...WHALE_DEFAULTS },
        livermore: { ...LIVERMORE_DEFAULTS },
        macdHs: { ...MACD_HS_DEFAULTS },
        londonBreakout: { ...LONDON_BREAKOUT_DEFAULTS },
        btcTurtle: { ...BTC_TURTLE_DEFAULTS },
        macd: { macdFast: 12, macdSlow: 26, macdSig: 9 },
        cvd: { cvdAggType: 'Session (Daily)', cvdRollLen: 20, cvdSmoothLen: 5 },
        sdPro: { sdMinB: 2, sdMaxB: 6, sdRatio: 0.5, sdAtrMult: 0.5, sdAtrPeriod: 14, sdMaxAge: 100 },
        qit: { qitImbLen: 10, qitAtrLen: 14, qitBodyMin: 0.7, qitVolMin: 2.0, qitTrend: true, qitSlAtr: 1.0, qitTp1: 1.0, qitTp2: 2.0, qitTp3: 3.0 },
        fxProfile: { ...MARKET_PROFILE_DEFAULTS },
        vbr: { vbrLookback: 200, vbrVolFactor: 2.0, vbrMinVol: 0, vbrMaxLevels: 12, vbrMergePct: 0.2 },
        goldMove: { 
            gmFactor: 11, gmSensitivity: 2.5, gmSignalType: "All Signals", 
            gmTrendRibbon: true, gmTrendCloud: true, gmChaosTrend: true, 
            gmOrderBlocks: false, gmMovingAvarg: true, gmMaValue: 200, 
            gmCandlestickColor: true, gmCandleType: "CleanScalper", 
            gmOverRsi: true, gmCBreak: false, gmSignalsShow: true, 
            gmShowDashboard: true, gmDashboardLocation: "Bottom Right", 
            gmDashboardSize: "Small", gmRiskManage: false, gmTpStrength: 1, 
            gmTp1: true, gmTp2: true, gmTp3: true 
        },
        smcPro: {
            smcShowOb: true, smcShowSd: true, smcAtrPeriod: 14, smcAtrMult: 1.5,
            smcMinScore: 1.0, smcAccBal: 10000, smcRiskCap: 1.0, smcContractSize: 100.0,
            smcProjLen: 20, smcTp1: 1.0, smcTp2: 2.0, smcTp3: 3.0, smcRsiLen: 14, smcDemLen: 14
        },
        lsr: {
            lsrUseH4: true, lsrUseH1: true, lsrFracL: 2, lsrFracR: 2,
            lsrTolMult: 0.10, lsrMinTouches: 1, lsrAtrLen: 14, lsrMaxLevels: 150,
            lsrShowSwept: false, lsrRsiLen: 14, lsrRsiWin: 3, lsrAutoProfile: true,
            lsrRsiOb: 70.0, lsrRsiOs: 30.0, lsrReqMacd: false, lsrSlBuf: 0.20,
            lsrTp1R: 1.0, lsrTp2R: 2.0, lsrTp3R: 3.0, lsrIsGold: false,
            lsrUsePdhl: true, lsrDayOffset: 0, lsrConfirm: 'rejection', lsrUseRsi: true, lsrMinRR: 0,
        }
    };

    const handleReset = () => {
        if (!defaultSettings[activeIndicator]) return;
        setState(prev => ({
            ...prev,
            indicatorSettings: {
                ...prev.indicatorSettings,
                ...defaultSettings[activeIndicator]
            }
        }));
    };

    const handleCancel = () => {
        if (initialSettings) {
            setState(prev => ({
                ...prev,
                indicatorSettings: initialSettings
            }));
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
                    <h2 className="text-slate-800 dark:text-slate-200 font-semibold text-sm">{titleMap[activeIndicator]}</h2>
                    <div className="flex items-center gap-3">
                        <button onClick={handleReset} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">
                            Reset
                        </button>
                        <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                
                <div className="p-4 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                    {/* MA Ribbon */}
                    {activeIndicator === 'maRibbon' && (
                        <div className="space-y-4">
                            {[1, 2, 3, 4].map(num => (
                                <div key={num} className="border border-slate-200 dark:border-slate-700 p-3 rounded-lg mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="font-semibold text-slate-800 dark:text-slate-200">MA #{num}</label>
                                        <input type="checkbox" checked={state.indicatorSettings[`ma${num}Show`]} 
                                            onChange={e => handleUpdate(`ma${num}Show`, e.target.checked)} 
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <label className="text-xs text-slate-700 dark:text-slate-300">Type</label>
                                            <select value={state.indicatorSettings[`ma${num}Type`]} onChange={e => handleUpdate(`ma${num}Type`, e.target.value)}
                                                className="w-full text-sm rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-2 py-1">
                                                <option value="SMA">SMA</option>
                                                <option value="EMA">EMA</option>
                                                <option value="SMMA (RMA)">SMMA (RMA)</option>
                                                <option value="WMA">WMA</option>
                                                <option value="VWMA">VWMA</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-700 dark:text-slate-300">Length</label>
                                            <input type="number" className="w-full text-sm rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-2 py-1"
                                                value={state.indicatorSettings[`ma${num}Len`]} onChange={e => handleUpdate(`ma${num}Len`, Number(e.target.value))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-700 dark:text-slate-300">Color</label>
                                            <input type="color" className="w-full h-8 p-0 border-0 rounded cursor-pointer"
                                                value={state.indicatorSettings[`ma${num}Color`]} onChange={e => handleUpdate(`ma${num}Color`, e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* SMC Pro */}
                    {activeIndicator === 'smcPro' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-center text-sm text-slate-700 dark:text-slate-300">
                                    <input type="checkbox" checked={state.indicatorSettings.smcShowOb} onChange={e => handleUpdate('smcShowOb', e.target.checked)} className="mr-2 rounded text-indigo-600" />
                                    Show Order Blocks
                                </label>
                                <label className="flex items-center text-sm text-slate-700 dark:text-slate-300">
                                    <input type="checkbox" checked={state.indicatorSettings.smcShowSd} onChange={e => handleUpdate('smcShowSd', e.target.checked)} className="mr-2 rounded text-indigo-600" />
                                    Show Supply/Demand
                                </label>
                            </div>
                            
                            <h4 className="font-semibold text-slate-800 dark:text-slate-200 mt-4 border-b border-slate-200 dark:border-slate-700 pb-1">Risk Management</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Account Balance ($)</label>
                                    <input type="number" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcAccBal} onChange={e => handleUpdate('smcAccBal', Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Max Risk Cap (%)</label>
                                    <input type="number" step="0.1" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcRiskCap} onChange={e => handleUpdate('smcRiskCap', Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300" title="Units per 1.00 lot. Left at 100 it is chosen from the symbol: gold 100, silver 5000, FX pairs 100000, crypto 1">Contract Size (100 = auto)</label>
                                    <input type="number" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcContractSize} onChange={e => handleUpdate('smcContractSize', Number(e.target.value))} />
                                </div>
                            </div>
                            
                            <h4 className="font-semibold text-slate-800 dark:text-slate-200 mt-4 border-b border-slate-200 dark:border-slate-700 pb-1">Targets (× risk)</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300">TP1 Multiplier (RR)</label>
                                    <input type="number" step="0.1" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcTp1} onChange={e => handleUpdate('smcTp1', Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300">TP2 Multiplier (RR)</label>
                                    <input type="number" step="0.1" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcTp2} onChange={e => handleUpdate('smcTp2', Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-700 dark:text-slate-300">TP3 Multiplier (RR)</label>
                                    <input type="number" step="0.1" className="w-full text-sm rounded bg-white dark:bg-slate-700 border px-2 py-1"
                                        value={state.indicatorSettings.smcTp3} onChange={e => handleUpdate('smcTp3', Number(e.target.value))} />
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Order block = last opposite candle before a strong move (≥ 1 ATR) that leaves a gap; supply/demand = small base + impulse. Signals fire only after confirmation: price returns to an untouched zone and a candle closes back out of it in the trade direction (within 5 candles). Entry at that close, SL just beyond the zone, TPs at the multiples above. Tested Oct 2026: entering at the zone edge lost money on gold and BTC; confirmed entries reached 1R first ~51% and 2R ~35% of the time (break-even at 2R is 33%). The dashboard shows this chart's own record.</p>
                        </div>
                    )}

                    {/* RSI */}
                    {activeIndicator === 'rsi' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Period Length</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.rsiPeriod ?? 14} onChange={e => handleUpdate('rsiPeriod', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Overbought level</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.rsiOb ?? 70} onChange={e => handleUpdate('rsiOb', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Oversold level</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.rsiOs ?? 30} onChange={e => handleUpdate('rsiOs', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">RSI MA length (0 = off)</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.rsiMaLen ?? 14} onChange={e => handleUpdate('rsiMaLen', e.target.value)} />
                            </div>
                        </div>
                    )}

                    {/* DeMarker */}
                    {activeIndicator === 'demarker' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Period Length</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.demPeriod ?? 14} onChange={e => handleUpdate('demPeriod', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Overbought level</label>
                                <input type="number" step="0.05" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.demOb ?? 0.7} onChange={e => handleUpdate('demOb', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Oversold level</label>
                                <input type="number" step="0.05" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.demOs ?? 0.3} onChange={e => handleUpdate('demOs', e.target.value)} />
                            </div>
                        </div>
                    )}

                    {/* MACD */}
                    {activeIndicator === 'macd' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Fast Length</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.macdFast} onChange={e => handleUpdate('macdFast', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Slow Length</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.macdSlow} onChange={e => handleUpdate('macdSlow', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Signal Smoothing</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.macdSig} onChange={e => handleUpdate('macdSig', e.target.value)} />
                            </div>
                        </>
                    )}

                    {/* Order Flow CVD */}
                    {activeIndicator === 'cvd' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Aggregation Type</label>
                                <select 
                                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.cvdAggType} 
                                    onChange={e => handleUpdate('cvdAggType', e.target.value)}
                                >
                                    <option value="Session (Daily)">Session (Daily)</option>
                                    <option value="Rolling Window">Rolling Window</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Rolling Window Length</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.cvdRollLen} onChange={e => handleUpdate('cvdRollLen', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Smoothing Length (Line)</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.cvdSmoothLen} onChange={e => handleUpdate('cvdSmoothLen', e.target.value)} />
                            </div>
                        </>
                    )}

                    {/* Supply Demand Pro */}
                    {activeIndicator === 'sdPro' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Min Base Candles</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdMinB} onChange={e => handleUpdate('sdMinB', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Max Base Candles</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdMaxB} onChange={e => handleUpdate('sdMaxB', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Body/Range Ratio</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdRatio} onChange={e => handleUpdate('sdRatio', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">ATR Multiplier</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdAtrMult} onChange={e => handleUpdate('sdAtrMult', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">ATR Period</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdAtrPeriod} onChange={e => handleUpdate('sdAtrPeriod', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Max Zone Age (Bars)</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdMaxAge} onChange={e => handleUpdate('sdMaxAge', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <input type="checkbox" className="rounded text-indigo-500 focus:ring-indigo-500 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600"
                                        checked={state.indicatorSettings.sdExtendRight} onChange={e => handleUpdate('sdExtendRight', e.target.checked)} />
                                    Extend Zones to Right
                                </label>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Min. Score (Ratio)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdMinScore} onChange={e => handleUpdate('sdMinScore', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Max. Score (Ratio)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.sdMaxScore} onChange={e => handleUpdate('sdMaxScore', e.target.value)} />
                            </div>

                        </>
                    )}
                    
                    {/* Quantum Imbalance Trap */}
                    {activeIndicator === 'qit' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Imbalance Lookback</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitImbLen} onChange={e => handleUpdate('qitImbLen', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">ATR Period</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitAtrLen} onChange={e => handleUpdate('qitAtrLen', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Candle body as a share of its range (0-1)">Min body (0-1)</label>
                                <input type="number" step="0.05" min="0.3" max="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitBodyMin ?? 0.7} onChange={e => handleUpdate('qitBodyMin', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Volume spike (× average)</label>
                                <input type="number" step="0.1" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitVolMin ?? 2.0} onChange={e => handleUpdate('qitVolMin', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Only signals in the direction of the EMA 50 / EMA 200 trend">Trend filter (EMA 50/200)</label>
                                <input type="checkbox" checked={state.indicatorSettings.qitTrend !== false} onChange={e => handleUpdate('qitTrend', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Stop Loss ATR Mult</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitSlAtr} onChange={e => handleUpdate('qitSlAtr', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Take Profit 1 (R)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitTp1} onChange={e => handleUpdate('qitTp1', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Take Profit 2 (R)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitTp2} onChange={e => handleUpdate('qitTp2', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Take Profit 3 (R)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.qitTp3} onChange={e => handleUpdate('qitTp3', e.target.value)} />
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">A strong candle (big body, volume spike, short-term momentum) is followed in its direction at the next candle's open; SL beyond that candle ± ATR × mult. Tested Oct 2026 on gold 2016-25 and BTC 2020-26: the old 55% / 1.2× settings were break-even on gold and lost on BTC; 70% / 2× with the trend filter did best on both (gold ≈ +0.09R per trade at 2R, BTC ≈ break-even). Small edge at best - the on-chart box shows this chart's own record.</p>
                        </>
                    )}
                    
                    {/* FX24HR Market Profile */}
                    {activeIndicator === 'fxProfile' && (() => {
                        const v = (k) => state.indicatorSettings[k] ?? MARKET_PROFILE_DEFAULTS[k];
                        return (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Profile per</label>
                                <select value={v('fxMode')} onChange={e => handleUpdate('fxMode', e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white">
                                    <option value="sessions">Session (Asia / London / New York)</option><option value="daily">Day (UTC)</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Days to display</label>
                                <input type="number" min="1" max="10" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={v('fxDays')} onChange={e => handleUpdate('fxDays', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Rows (price levels)</label>
                                <input type="number" min="10" max="200" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={v('fxRes')} onChange={e => handleUpdate('fxRes', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Value area (%)</label>
                                <input type="number" min="50" max="95" step="5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={v('fxVaPct')} onChange={e => handleUpdate('fxVaPct', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Histogram width</label>
                                <input type="number" step="0.1" min="0.2" max="3" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={v('fxMult')} onChange={e => handleUpdate('fxMult', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Naked POC lines</label>
                                <input type="checkbox" checked={v('fxNaked') !== false} onChange={e => handleUpdate('fxNaked', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Volume at each price for every session (Asia 21:00–07:00, London 07:00–13:00, New York 13:00–21:00 UTC) or day: bright bar + solid line = POC (most volume), stronger rows between the dashed lines = value area (VAH / VAL). Naked POC = an earlier POC price hasn't returned to, extended right. Reference levels, not signals: on gold 15m 2022–25 price revisited naked POCs about as often as any level at the same distance.</p>
                        </div>
                        );
                    })()}

                    {/* Volume */}
                    {activeIndicator === 'volume' && (() => {
                        const v = (k, d) => state.indicatorSettings[k] ?? d;
                        const row = (label, ctrl) => <div className="flex justify-between items-center gap-3"><label className="text-xs text-slate-700 dark:text-slate-300">{label}</label>{ctrl}</div>;
                        return (
                        <div className="space-y-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 pt-1">Display</p>
                            {row('Show as', <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
                                {[['pane', 'Own pane'], ['overlay', 'On the chart']].map(([k, t]) => (
                                    <button key={k} type="button" onClick={() => handleUpdate('volDisplay', k)} aria-pressed={v('volDisplay', 'pane') === k}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${v('volDisplay', 'pane') === k ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>{t}</button>
                                ))}
                            </div>)}
                            {row('Up / down colours', <div className="flex gap-2">
                                <input type="color" aria-label="Up-candle volume colour" value={v('volUpColor', '#26a69a')} onChange={e => handleUpdate('volUpColor', e.target.value)} className="w-7 h-7 p-0 border border-slate-300 dark:border-slate-600 rounded-full cursor-pointer bg-transparent overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full" />
                                <input type="color" aria-label="Down-candle volume colour" value={v('volDnColor', '#ef5350')} onChange={e => handleUpdate('volDnColor', e.target.value)} className="w-7 h-7 p-0 border border-slate-300 dark:border-slate-600 rounded-full cursor-pointer bg-transparent overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full" />
                            </div>)}
                            {row('Highlight bars ≥ × average', <input type="number" min="0" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={v('volHighMult', 2)} onChange={e => handleUpdate('volHighMult', e.target.value)} />)}
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 pt-1">Moving average</p>
                            {row('Show average', <input type="checkbox" checked={v('volMaShow', true) !== false} onChange={e => handleUpdate('volMaShow', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />)}
                            {v('volMaShow', true) !== false && <>
                                {row('Type', <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={v('volMaType', 'SMA')} onChange={e => handleUpdate('volMaType', e.target.value)}><option value="SMA">SMA</option><option value="EMA">EMA</option></select>)}
                                {row('Length', <input type="number" min="1" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={v('volMaLen', 20)} onChange={e => handleUpdate('volMaLen', e.target.value)} />)}
                                {row('Colour', <input type="color" aria-label="Volume average colour" value={v('volMaColor', '#007aff')} onChange={e => handleUpdate('volMaColor', e.target.value)} className="w-7 h-7 p-0 border border-slate-300 dark:border-slate-600 rounded-full cursor-pointer bg-transparent overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full" />)}
                            </>}
                            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">Bars take the candle's colour; bars at least the set multiple of the average (0 = off) are drawn at full strength. The header shows relative volume (RelVol = volume ÷ average). Forex / CFD feeds report tick volume (activity), not traded size.</p>
                        </div>
                        );
                    })()}

                    {/* VWAP */}
                    {activeIndicator === 'vwap' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Reset (anchor)</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white"
                                    value={state.indicatorSettings.vwapAnchor || 'Session'} onChange={e => handleUpdate('vwapAnchor', e.target.value)}>
                                    <option value="Session">Session (daily, UTC)</option>
                                    <option value="Week">Week</option>
                                    <option value="Month">Month</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show bands</label>
                                <input type="checkbox" checked={state.indicatorSettings.vwapBands !== false} onChange={e => handleUpdate('vwapBands', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Band 1 (× std dev)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vwapBand1 ?? 1} onChange={e => handleUpdate('vwapBand1', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Band 2 (× std dev)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vwapBand2 ?? 2} onChange={e => handleUpdate('vwapBand2', e.target.value)} />
                            </div>
                            <p className="text-[10px] text-slate-400">Volume-weighted average of (high + low + close) / 3 since the start of each session, week or month.</p>
                        </div>
                    )}

                    {/* Ichimoku Cloud */}
                    {activeIndicator === 'ichimoku' && (
                        <div className="space-y-2">
                            {[['ichTenkan', 'Tenkan-sen (conversion) length', 9], ['ichKijun', 'Kijun-sen (base) length', 26], ['ichSenkouB', 'Senkou Span B length', 52], ['ichDisplacement', 'Displacement (cloud ahead / Chikou back)', 26]].map(([k, label, d]) => (
                                <div key={k} className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">{label}</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                        value={state.indicatorSettings[k] ?? d} onChange={e => handleUpdate(k, e.target.value)} />
                                </div>
                            ))}
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show BUY / SELL signals</label>
                                <input type="checkbox" checked={state.indicatorSettings.ichSignals !== false} onChange={e => handleUpdate('ichSignals', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <p className="text-[10px] text-slate-400 leading-snug">Standard 9 / 26 / 52 / 26 (Hosoda). BUY only when all agree at candle close: Tenkan crosses above Kijun or price breaks above the cloud, price is above the cloud, Chikou is above the price 26 bars back and the cloud ahead is green. SELL is the mirror. Each signal shows SL = the Kijun-sen (at least 0.5 × ATR away) and TP = 2 × the risk. Blue = Tenkan, dark red = Kijun, purple = Chikou.</p>
                        </div>
                    )}

                    {/* Whale Pulse (big trades) */}
                    {activeIndicator === 'whalePulse' && (() => {
                        const v = (k, d) => state.indicatorSettings[k] ?? d;
                        return (
                        <div className="space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Big-trade bubbles</p>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show bubbles</label>
                                <input type="checkbox" checked={state.indicatorSettings['wpBubbles'] !== false} onChange={e => handleUpdate('wpBubbles', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Pressure is compared with this many previous bars">Lookback (bars)</label>
                                <input type="number" step="1" min="5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpLookback', 20)} onChange={e => handleUpdate('wpLookback', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="How unusual the pressure must be, in standard deviations">Small bubble ≥ (z)</label>
                                <input type="number" step="0.1" min="0.5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpZ1', 2)} onChange={e => handleUpdate('wpZ1', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Medium bubble ≥ (z)</label>
                                <input type="number" step="0.1" min="0.5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpZ2', 3)} onChange={e => handleUpdate('wpZ2', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Large bubble ≥ (z)</label>
                                <input type="number" step="0.1" min="0.5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpZ3', 4)} onChange={e => handleUpdate('wpZ3', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Ignore bars with less volume than this multiple of the recent average">Min volume (× average)</label>
                                <input type="number" step="0.1" min="0" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpMinRelVol', 1.2)} onChange={e => handleUpdate('wpMinRelVol', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Bubble size</label>
                                <input type="number" step="0.1" min="0.5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpScale', 1)} onChange={e => handleUpdate('wpScale', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Volume label on large bubbles</label>
                                <input type="checkbox" checked={state.indicatorSettings['wpLabels'] !== false} onChange={e => handleUpdate('wpLabels', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-1">Absorption</p>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Big pressure but price barely moved that way — the other side absorbed it">Show absorption diamonds</label>
                                <input type="checkbox" checked={state.indicatorSettings['wpAbsorption'] !== false} onChange={e => handleUpdate('wpAbsorption', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Below this net move in the pressure direction the bar counts as absorbed">Max move (× ATR)</label>
                                <input type="number" step="0.05" min="0" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpAbsBody', 0.25)} onChange={e => handleUpdate('wpAbsBody', e.target.value)} />
                            </div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-1">Deep pressure</p>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Pressure building over several bars in one direction">Show deep-pressure dots</label>
                                <input type="checkbox" checked={state.indicatorSettings['wpDeep'] !== false} onChange={e => handleUpdate('wpDeep', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Bars</label>
                                <input type="number" step="1" min="2" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpDeepBars', 5)} onChange={e => handleUpdate('wpDeepBars', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Strength ≥ (z)</label>
                                <input type="number" step="0.1" min="0.5" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpDeepZ', 2.5)} onChange={e => handleUpdate('wpDeepZ', e.target.value)} />
                            </div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-1">Record</p>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show track record box</label>
                                <input type="checkbox" checked={state.indicatorSettings['wpRecord'] !== false} onChange={e => handleUpdate('wpRecord', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Record horizon (bars)</label>
                                <input type="number" step="1" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={v('wpHorizon', 5)} onChange={e => handleUpdate('wpHorizon', e.target.value)} />
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Green / red bubble = unusually strong buying / selling on that bar (bigger = more unusual). Aqua / orange diamond = strong buying / selling that did not move price (absorbed — possible trap). Small dots = pressure building over several bars. Uses the real 1-minute buy/sell split when the chart has it, otherwise an estimate from candle shape. Context, not a stand-alone signal.</p>
                        </div>
                        );
                    })()}

                    {/* Moving Average (single EMA / SMA) */}
                    {activeIndicator === 'movingAvg' && (() => {
                        const S = state.indicatorSettings, P = ['mv', 'mv2', 'mv3'];
                        const row = (label, ctrl) => <div className="flex justify-between items-center gap-3"><label className="text-xs text-slate-700 dark:text-slate-300">{label}</label>{ctrl}</div>;
                        const both = maLine(S, 0).on && maLine(S, 1).on;
                        return (
                        <div className="space-y-2.5">
                            {[0, 1, 2].map(k => {
                                const L = maLine(S, k), p = P[k], set = (f, val) => handleUpdate(`${p}${f}`, val);
                                return (
                                    <div key={k} className={`rounded-xl border transition-colors ${L.on ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60' : 'border-dashed border-slate-200 dark:border-slate-700'}`}>
                                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none">
                                            <input type="checkbox" checked={L.on} onChange={e => set('On', e.target.checked)} className="rounded border-slate-300 focus:ring-0" aria-label={`Show line ${k + 1}`} />
                                            <span className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-slate-900 shadow-sm" style={{ background: L.color }} aria-hidden />
                                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Line {k + 1}</span>
                                            <span className="ml-auto text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{L.type} {L.len}</span>
                                        </label>
                                        {L.on && (
                                            <div className="px-3 pb-3 pt-0.5 space-y-2 border-t border-slate-100 dark:border-slate-700/60">
                                                <div className="grid grid-cols-2 gap-2 pt-2">
                                                    <select aria-label="Type" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={L.type} onChange={e => set('Type', e.target.value)}>
                                                        <option value="EMA">EMA · exponential</option><option value="SMA">SMA · simple</option><option value="WMA">WMA · weighted</option>
                                                        <option value="HMA">HMA · Hull</option><option value="SMMA">SMMA · smoothed</option><option value="VWMA">VWMA · volume-weighted</option>
                                                    </select>
                                                    <input aria-label="Length" type="number" min="1" max="1000" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40 w-full" value={L.len} onChange={e => set('Len', e.target.value)} />
                                                </div>
                                                {row('Source', <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={L.source} onChange={e => set('Source', e.target.value)}>
                                                    <option value="close">Close</option><option value="open">Open</option><option value="high">High</option><option value="low">Low</option>
                                                    <option value="hl2">(H + L) / 2</option><option value="hlc3">(H + L + C) / 3</option><option value="ohlc4">(O + H + L + C) / 4</option>
                                                </select>)}
                                                {row('Line', <div className="flex items-center gap-2">
                                                    <input type="color" aria-label={`Line ${k + 1} colour`} value={L.color} onChange={e => set('Color', e.target.value)} className="w-7 h-7 p-0 border border-slate-300 dark:border-slate-600 rounded-full cursor-pointer bg-transparent overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full" />
                                                    <select aria-label="Width" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={String(L.width)} onChange={e => set('Width', Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} px</option>)}</select>
                                                    <select aria-label="Style" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40" value={L.style} onChange={e => set('Style', e.target.value)}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
                                                </div>)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 pt-1">Extras</p>
                            {row('Price-axis labels', <input type="checkbox" checked={S.mvAxisTags !== false} onChange={e => handleUpdate('mvAxisTags', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />)}
                            <div className={both ? '' : 'opacity-50'}>
                                {row('Ribbon between lines 1 and 2', <input type="checkbox" disabled={!both} checked={!!S.mvRibbon} onChange={e => handleUpdate('mvRibbon', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />)}
                                <div className="h-2" />
                                {row('Mark crossovers (golden / death)', <input type="checkbox" disabled={!both} checked={!!S.mvCrosses} onChange={e => handleUpdate('mvCrosses', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />)}
                                {!both && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Turn on lines 1 and 2 to use these.</p>}
                            </div>
                            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">Standard formulas. EMA and HMA react fastest, SMA and SMMA are smoothest, VWMA weights candles by volume. Classic set: 20 / 50 / 200. A golden cross is line 1 crossing above line 2; crossovers can also be used in Alerts.</p>
                        </div>
                        );
                    })()}

                    {/* Bollinger Bands */}
                    {activeIndicator === 'bollinger' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Length</label>
                                <input type="number" min="2" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.bbLength ?? 20} onChange={e => handleUpdate('bbLength', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Std dev multiplier</label>
                                <input type="number" step="0.1" min="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.bbMult ?? 2} onChange={e => handleUpdate('bbMult', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Source</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white"
                                    value={state.indicatorSettings.bbSource || 'close'} onChange={e => handleUpdate('bbSource', e.target.value)}>
                                    <option value="close">Close</option>
                                    <option value="open">Open</option>
                                    <option value="high">High</option>
                                    <option value="low">Low</option>
                                    <option value="hl2">(H + L) / 2</option>
                                    <option value="hlc3">(H + L + C) / 3</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Basis MA type</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white"
                                    value={state.indicatorSettings.bbMaType || 'SMA'} onChange={e => handleUpdate('bbMaType', e.target.value)}>
                                    <option value="SMA">SMA</option>
                                    <option value="EMA">EMA</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Fill between bands</label>
                                <input type="checkbox" checked={state.indicatorSettings.bbFill !== false} onChange={e => handleUpdate('bbFill', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Basis is the moving average of the source; the bands sit the chosen number of standard deviations above and below. Price near the upper band is relatively high, near the lower band relatively low; narrow bands (a squeeze) often come before a bigger move.</p>
                        </div>
                    )}

                    {/* London Breakout (Big Ben) */}
                    {activeIndicator === 'londonBreakout' && (() => {
                        const v = (k) => state.indicatorSettings[k] ?? LONDON_BREAKOUT_DEFAULTS[k];
                        const inp = "w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500";
                        const row = (label, key, props = {}, title) => (
                            <div className="flex justify-between items-center" key={key}>
                                <label className="text-xs text-slate-700 dark:text-slate-300" title={title}>{label}</label>
                                <input type="number" className={inp} value={v(key)} onChange={e => handleUpdate(key, e.target.value)} {...props} />
                            </div>
                        );
                        return (
                            <div className="space-y-2">
                                {row('Asian range from (London hour)', 'lbAsiaStart', { min: 0, max: 23, step: 1 })}
                                {row('Asian range to (London hour)', 'lbAsiaEnd', { min: 1, max: 23, step: 1 })}
                                {row('Entries until (London hour)', 'lbEntryEnd', { min: 1, max: 23, step: 1 }, 'No new breakout after this hour')}
                                {row('Close trade at (London hour)', 'lbSessionEnd', { min: 1, max: 23, step: 1 }, 'Open trade is closed at this hour if neither SL nor TP2 was hit')}
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Stop loss</label>
                                    <select value={v('lbSlMode')} onChange={e => handleUpdate('lbSlMode', e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white">
                                        <option value="range">Other side of the range</option><option value="mid">Middle of the range</option>
                                    </select>
                                </div>
                                {row('TP1 (× range)', 'lbTp1', { min: 0.25, step: 0.25 })}
                                {row('TP2 (× range)', 'lbTp2', { min: 0.25, step: 0.25 })}
                                {row('Breakout buffer (% of range)', 'lbBuffer', { min: 0, step: 5 }, 'The close must be this far beyond the range - filters small fake breaks')}
                                {row('Skip if range < (× 10-day average)', 'lbMinRange', { min: 0, step: 0.1 })}
                                {row('Skip if range > (× 10-day average)', 'lbMaxRange', { min: 0.5, step: 0.1 })}
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Asian session high/low (box) from London time (GMT/BST adjusted). In the entry window the first candle closing beyond the range is the signal - one trade a day: SL at the other side (or middle) of the range, TP1/TP2 at 1×/2× the range height, closed at the session end. Days with an unusually small or large range are skipped. Intraday charts (1h and below). Alerts: Alerts panel → London Breakout (buy, sell, TP1, exit).</p>
                            </div>
                        );
                    })()}

                    {/* BTC Turtle Breakout */}
                    {activeIndicator === 'btcTurtle' && (() => {
                        const v = (k) => state.indicatorSettings[k] ?? BTC_TURTLE_DEFAULTS[k];
                        const inp = "w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500";
                        const row = (label, key, props = {}, title) => (
                            <div className="flex justify-between items-center" key={key}>
                                <label className="text-xs text-slate-700 dark:text-slate-300" title={title}>{label}</label>
                                <input type="number" className={inp} value={v(key)} onChange={e => handleUpdate(key, e.target.value)} {...props} />
                            </div>
                        );
                        return (
                            <div className="space-y-2">
                                {row('Breakout above high of (H4 bars)', 'btEntryBars', { min: 2, step: 1 })}
                                {row('Trend EMA (0 = off)', 'btEmaLen', { min: 0, step: 10 })}
                                {row('Stop (× ATR 14)', 'btSlAtr', { min: 0.5, step: 0.5 })}
                                {row('Exit below low of (H4 bars)', 'btExitBars', { min: 2, step: 1 }, 'Normal breakouts')}
                                {row('Strong breakout from (× ATR, 0 = off)', 'btStrongBreak', { min: 0, step: 0.01 }, 'Close this far above the breakout level')}
                                {row('…exit below low of (bars)', 'btStrongExit', { min: 2, step: 1 })}
                                {row('Weak breakout under (× ATR, 0 = off)', 'btWeakBreak', { min: 0, step: 0.01 })}
                                {row('…exit below low of (bars)', 'btWeakExit', { min: 2, step: 1 })}
                                {row('Pause when ATR > (× 20-bar mean, 0 = off)', 'btSpikeAtr', { min: 0, step: 0.1 })}
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Same rules as the BTC Turtle Breakout EA (MT5), on H4 bars in broker server time (New York + 7h) built from this chart - use any timeframe from 1m to 4h. BUY when an H4 candle closes above the highest high of the last 55 bars and above EMA 200; fill at the next H4 open, stop 2 × ATR, exit when an H4 close breaks the 27-bar low (40 for strong breakouts, 20 for weak). Long only. Tested on BTC 2017-2026: PF 4.0 in the simulator, PF 1.4-2.0 in the MT5 tester - see web_app/research/btc/README.md. Alerts: Alerts panel → BTC Turtle Breakout.</p>
                            </div>
                        );
                    })()}

                    {/* MACD H&S Breakout */}
                    {activeIndicator === 'macdHs' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Pattern sensitivity (pivot lookback)</label>
                                <input type="number" min="2" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={state.indicatorSettings.mhsLookback ?? MACD_HS_DEFAULTS.mhsLookback} onChange={e => handleUpdate('mhsLookback', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="How strict the right-shoulder MACD zero-line test is">MACD zero-cross threshold</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500" value={state.indicatorSettings.mhsZeroThres ?? MACD_HS_DEFAULTS.mhsZeroThres} onChange={e => handleUpdate('mhsZeroThres', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Higher-timeframe context</label>
                                <input type="checkbox" checked={state.indicatorSettings.mhsShowHTF !== false} onChange={e => handleUpdate('mhsShowHTF', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">HTF</label>
                                <select value={state.indicatorSettings.mhsHtf || 'D'} onChange={e => handleUpdate('mhsHtf', e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white">
                                    <option value="D">Daily</option><option value="W">Weekly</option>
                                </select>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Red = head &amp; shoulders (bearish), green = inverse (bullish); faded = higher timeframe. MACD must fade through zero across the shoulders. A signal fires when a candle closes beyond the neckline with MACD on the pattern's side of zero: SL beyond the right shoulder, target = head-to-neckline height.</p>
                        </div>
                    )}

                    {/* Livermore Gold Trend v12 PRO */}
                    {activeIndicator === 'livermore' && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Trend EMA length</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmEmaLen ?? LIVERMORE_DEFAULTS.lmEmaLen} onChange={e => handleUpdate('lmEmaLen', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">ADX threshold</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmAdxThresh ?? LIVERMORE_DEFAULTS.lmAdxThresh} onChange={e => handleUpdate('lmAdxThresh', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">RSI(21) buy level</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmRsiEntry ?? LIVERMORE_DEFAULTS.lmRsiEntry} onChange={e => handleUpdate('lmRsiEntry', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Stop loss (ATR ×)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmSlMult ?? LIVERMORE_DEFAULTS.lmSlMult} onChange={e => handleUpdate('lmSlMult', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Take profit (ATR ×)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmTpMult ?? LIVERMORE_DEFAULTS.lmTpMult} onChange={e => handleUpdate('lmTpMult', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Trailing offset (ATR ×)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmTsOffset ?? LIVERMORE_DEFAULTS.lmTsOffset} onChange={e => handleUpdate('lmTsOffset', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Session from hour</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmSessionStart ?? LIVERMORE_DEFAULTS.lmSessionStart} onChange={e => handleUpdate('lmSessionStart', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Session to hour (incl.)</label>
                                <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.lmSessionEnd ?? LIVERMORE_DEFAULTS.lmSessionEnd} onChange={e => handleUpdate('lmSessionEnd', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Use trailing stop</label>
                                <input type="checkbox" checked={state.indicatorSettings.lmUseTs !== false} onChange={e => handleUpdate('lmUseTs', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Only buy when yesterday's close (broker server day) was above the daily EMA(50)">Daily trend filter</label>
                                <input type="checkbox" checked={(state.indicatorSettings.lmUseDaily ?? LIVERMORE_DEFAULTS.lmUseDaily) !== false} onChange={e => handleUpdate('lmUseDaily', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">London/NY session only</label>
                                <input type="checkbox" checked={state.indicatorSettings.lmUseSession !== false} onChange={e => handleUpdate('lmUseSession', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300" title="Pine's `hour` uses the TradingView symbol's exchange timezone. Pick the one of the symbol you compare with.">Session timezone</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white" value={state.indicatorSettings.lmSessionTz || LIVERMORE_DEFAULTS.lmSessionTz} onChange={e => handleUpdate('lmSessionTz', e.target.value)}>
                                    <option value="server">Broker server (New York +7h)</option>
                                    <option value="UTC">UTC</option>
                                    <option value="America/New_York">New York (e.g. OANDA:XAUUSD)</option>
                                    <option value="Europe/London">London</option>
                                    <option value="Asia/Kolkata">India (IST)</option>
                                </select>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed"><b>Tested on XAUUSD 45m</b> (2021-2026): these defaults were profitable every year with the smallest drawdown of 27,648 settings tried; 15m and 1h were weaker. Same signals as the MT5 EA Livermore_Gold_Trend_EA.</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Matches the Pine strategy on TradingView: a buy when RSI(21) crosses above the level while price is above the EMA, ADX is above the threshold and the hour is in the session. The order fills at the next candle's open; the stop (red) trails up by ATR × offset at each close; target (green). Up to 2 entries (pyramiding). If signals differ from TradingView, first check the session timezone — TradingView uses the symbol's exchange time.</p>
                        </div>
                    )}

                    {/* Next-Candle Projection (no settings — explanation only) */}
                    {activeIndicator === 'nextProjection' && (
                        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            <p>Beside the live candle: its typical high and low from the open, and how often the next candle closed up or down after candles like the last closed one on this chart (same body strength, close position and volume).</p>
                            <p>It also checks itself: "past calls" shows how often its earlier calls on this chart were right. A direction arrow appears only when that is clearly better than a coin flip (54%+ over 30+ calls); otherwise it says <b>no proven edge</b>.</p>
                            <p className="text-slate-400">Statistics from history, not a prediction or trading advice. Turn it on or off in Chart Settings (gear icon). On footprint charts the same projection uses order flow.</p>
                        </div>
                    )}

                    {/* Market Sessions */}
                    {activeIndicator === 'sessions' && (() => {
                        const S = { ...MARKET_SESSION_DEFAULTS, ...state.indicatorSettings };
                        const input = "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500";
                        const check = (key, label) => (
                            <label key={key} className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                                <input type="checkbox" checked={!!S[key]} onChange={e => handleUpdate(key, e.target.checked)} className="rounded border-slate-300 focus:ring-0" /> {label}
                            </label>
                        );
                        return (
                        <div className="space-y-3">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Session hours are in UTC{S.msUtcOffset ? ` ${S.msUtcOffset > 0 ? '+' : ''}${S.msUtcOffset}h` : ''}. Shown on intraday charts only.</p>
                            {MARKET_SESSION_SLOTS.map(n => (
                                <div key={n} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" checked={!!S[`ms${n}On`]} onChange={e => handleUpdate(`ms${n}On`, e.target.checked)} className="rounded border-slate-300 focus:ring-0" title="Show this session" />
                                        <input type="color" value={S[`ms${n}Color`]} onChange={e => handleUpdate(`ms${n}Color`, e.target.value)} className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0" title="Colour" />
                                        <input type="text" value={S[`ms${n}Name`]} maxLength={16} onChange={e => handleUpdate(`ms${n}Name`, e.target.value)} className={`${input} flex-1 min-w-0`} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-[11px] text-slate-600 dark:text-slate-400 w-12">Hours</label>
                                        <input type="time" value={S[`ms${n}Start`]} onChange={e => handleUpdate(`ms${n}Start`, e.target.value)} className={input} />
                                        <span className="text-slate-400 text-xs">–</span>
                                        <input type="time" value={S[`ms${n}End`]} onChange={e => handleUpdate(`ms${n}End`, e.target.value)} className={input} />
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                        {check(`ms${n}Range`, 'Range box')}
                                        {check(`ms${n}HiLo`, 'Prev High/Low')}
                                        {check(`ms${n}Vwap`, 'VWAP')}
                                        {check(`ms${n}Mean`, 'Mean')}
                                        {check(`ms${n}Trend`, 'Trendline')}
                                    </div>
                                </div>
                            ))}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300" title="How many days of sessions to draw, most recent first. 0 = every day on the chart.">Days to show (0 = all)</label>
                                    <input type="number" min={0} max={60} step={1} value={S.msDaysBack ?? 1} onChange={e => handleUpdate('msDaysBack', e.target.value)} className={`${input} w-16 text-center`} />
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">UTC offset (hours)</label>
                                    <input type="number" min={-12} max={14} step={1} value={S.msUtcOffset} onChange={e => handleUpdate('msUtcOffset', e.target.value)} className={`${input} w-16 text-center`} />
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Range fill opacity (%)</label>
                                    <input type="number" min={0} max={100} step={5} value={S.msFillOpacity} onChange={e => handleUpdate('msFillOpacity', e.target.value)} className={`${input} w-16 text-center`} />
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                                    {check('msOutline', 'Range outline')}
                                    {check('msLabels', 'Session names')}
                                    {check('msDayDividers', 'Day dividers')}
                                    {check('msDashboard', 'Dashboard')}
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* MTF Order Blocks */}
                    {activeIndicator === 'mtfOb' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Mitigated Blocks</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowMitigated} onChange={e => handleUpdate('obShowMitigated', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show M5 OBs</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowM5} onChange={e => handleUpdate('obShowM5', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show M15 OBs</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowM15} onChange={e => handleUpdate('obShowM15', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show M30 OBs</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowM30} onChange={e => handleUpdate('obShowM30', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show H1 OBs</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowH1} onChange={e => handleUpdate('obShowH1', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show H4 OBs</label>
                                <input type="checkbox" checked={state.indicatorSettings.obShowH4} onChange={e => handleUpdate('obShowH4', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                        </>
                    )}

                    {/* Gold Move */}
                    {activeIndicator === 'goldMove' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Factor (ATR Len)</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmFactor} onChange={e => handleUpdate('gmFactor', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Sensitivity</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmSensitivity} onChange={e => handleUpdate('gmSensitivity', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Signal Type</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmSignalType} onChange={e => handleUpdate('gmSignalType', e.target.value)}>
                                    <option value="All Signals">All Signals</option>
                                    <option value="Smart Signals">Smart Signals</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Trend Ribbon</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmTrendRibbon} onChange={e => handleUpdate('gmTrendRibbon', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Trend Cloud</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmTrendCloud} onChange={e => handleUpdate('gmTrendCloud', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Chaos Trend Line</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmChaosTrend} onChange={e => handleUpdate('gmChaosTrend', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Order Blocks</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmOrderBlocks} onChange={e => handleUpdate('gmOrderBlocks', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Moving Average</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmMovingAvarg} onChange={e => handleUpdate('gmMovingAvarg', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">MA Value</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmMaValue} onChange={e => handleUpdate('gmMaValue', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Candlestick Colors</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmCandlestickColor} onChange={e => handleUpdate('gmCandlestickColor', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Candle Type</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmCandleType} onChange={e => handleUpdate('gmCandleType', e.target.value)}>
                                    <option value="CleanScalper">CleanScalper</option>
                                    <option value="Trend Ribbon">Trend Ribbon</option>
                                    <option value="Moving Average">Moving Average</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Overbought/Oversold</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmOverRsi} onChange={e => handleUpdate('gmOverRsi', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Channel Breakouts</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmCBreak} onChange={e => handleUpdate('gmCBreak', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Turn Signals Off</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmSignalsShow} onChange={e => handleUpdate('gmSignalsShow', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Show Dashboard</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmShowDashboard} onChange={e => handleUpdate('gmShowDashboard', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Dashboard Location</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmDashboardLocation} onChange={e => handleUpdate('gmDashboardLocation', e.target.value)}>
                                    <option value="Top Right">Top Right</option>
                                    <option value="Bottom Right">Bottom Right</option>
                                    <option value="Bottom Left">Bottom Left</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Dashboard Size</label>
                                <select className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmDashboardSize} onChange={e => handleUpdate('gmDashboardSize', e.target.value)}>
                                    <option value="Tiny">Tiny</option>
                                    <option value="Small">Small</option>
                                    <option value="Normal">Normal</option>
                                    <option value="Large">Large</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Risk Manager On/Off</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmRiskManage} onChange={e => handleUpdate('gmRiskManage', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">TP Strength</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.gmTpStrength} onChange={e => handleUpdate('gmTpStrength', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">TP 1</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmTp1} onChange={e => handleUpdate('gmTp1', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">TP 2</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmTp2} onChange={e => handleUpdate('gmTp2', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">TP 3</label>
                                <input type="checkbox" checked={state.indicatorSettings.gmTp3} onChange={e => handleUpdate('gmTp3', e.target.checked)} className="rounded border-slate-300 focus:ring-0" />
                            </div>
                        </>
                    )}

                    {/* Volume-Based Support & Resistance */}
                    {activeIndicator === 'vbr' && (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Lookback (bars)</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vbrLookback} onChange={e => handleUpdate('vbrLookback', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Volume Threshold (mult of SMA)</label>
                                <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vbrVolFactor} onChange={e => handleUpdate('vbrVolFactor', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Absolute Min Volume (0=disabled)</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vbrMinVol} onChange={e => handleUpdate('vbrMinVol', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Max Levels to Plot</label>
                                <input type="number" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vbrMaxLevels} onChange={e => handleUpdate('vbrMaxLevels', e.target.value)} />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-700 dark:text-slate-300">Merge Tolerance (%)</label>
                                <input type="number" step="0.01" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white text-center focus:outline-none focus:border-indigo-500"
                                    value={state.indicatorSettings.vbrMergePct} onChange={e => handleUpdate('vbrMergePct', e.target.value)} />
                            </div>
                        </>
                    )}

                    {/* LSR - Liquidity Sweep Reversal */}
                    {activeIndicator === 'lsr' && (() => {
                        // Merge defaults so old localStorage state (missing lsr* keys) still shows values
                        const D = defaultSettings.lsr;
                        const S = state.indicatorSettings;
                        const lsr = (key) => S[key] ?? D[key];
                        return (
                        <div className="space-y-3">
                            {/* Group 1: Liquidity Pools */}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wider">Liquidity Pools (H4 / H1)</h3>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 mb-2">
                                    Use H4 Levels
                                    <input type="checkbox" checked={lsr('lsrUseH4')} onChange={e => handleUpdate('lsrUseH4', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 mb-2">
                                    Use H1 Levels
                                    <input type="checkbox" checked={lsr('lsrUseH1')} onChange={e => handleUpdate('lsrUseH1', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Fractal Bars Left</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrFracL')} onChange={e => handleUpdate('lsrFracL', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Fractal Bars Right</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrFracR')} onChange={e => handleUpdate('lsrFracR', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Equal-Level Tolerance (×ATR)</label>
                                    <input type="number" step="0.01" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrTolMult')} onChange={e => handleUpdate('lsrTolMult', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Min Touches (1=any, 2=equal H/L)</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrMinTouches')} onChange={e => handleUpdate('lsrMinTouches', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">ATR Length</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrAtrLen')} onChange={e => handleUpdate('lsrAtrLen', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Max Levels in Memory</label>
                                    <input type="number" min="10" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrMaxLevels')} onChange={e => handleUpdate('lsrMaxLevels', e.target.value)} />
                                </div>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300">
                                    Show Swept Levels (grey)
                                    <input type="checkbox" checked={lsr('lsrShowSwept')} onChange={e => handleUpdate('lsrShowSwept', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                            </div>

                            {/* Group 2: Entry Filters */}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wider">Entry Filters</h3>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 mb-2">
                                    Auto-Profile (Gold vs Generic RSI levels)
                                    <input type="checkbox" checked={lsr('lsrAutoProfile')} onChange={e => handleUpdate('lsrAutoProfile', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 mb-2">
                                    Gold Symbol (for RSI levels)
                                    <input type="checkbox" checked={lsr('lsrIsGold')} onChange={e => handleUpdate('lsrIsGold', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">RSI OB (manual, auto-off)</label>
                                    <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrRsiOb')} onChange={e => handleUpdate('lsrRsiOb', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">RSI OS (manual, auto-off)</label>
                                    <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrRsiOs')} onChange={e => handleUpdate('lsrRsiOs', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">RSI OB/OS within N candles</label>
                                    <input type="number" min="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrRsiWin')} onChange={e => handleUpdate('lsrRsiWin', e.target.value)} />
                                </div>
                                <label className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 mb-2">
                                    MACD Mandatory Confluence
                                    <input type="checkbox" checked={lsr('lsrReqMacd')} onChange={e => handleUpdate('lsrReqMacd', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </label>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">SL Buffer (×ATR)</label>
                                    <input type="number" step="0.05" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrSlBuf')} onChange={e => handleUpdate('lsrSlBuf', e.target.value)} />
                                </div>
                            </div>

                            {/* Group 3: Take Profits */}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wider">Take Profits (R-multiples)</h3>
                                {[['lsrTp1R', 'TP1 (R)', 1.0], ['lsrTp2R', 'TP2 (R)', 2.0], ['lsrTp3R', 'TP3 (R)', 3.0]].map(([key, label, def]) => (
                                    <div key={key} className="flex justify-between items-center mb-2">
                                        <label className="text-xs text-slate-700 dark:text-slate-300">{label}</label>
                                        <input type="number" step="0.1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={S[key] ?? def} onChange={e => handleUpdate(key, e.target.value)} />
                                    </div>
                                ))}
                            </div>

                            {/* Group 4: Liquidity concept (previous-day high/low, confirmation, R:R) */}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                                <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Liquidity concept</h3>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Previous-day high / low as liquidity</label>
                                    <input type="checkbox" checked={lsr('lsrUsePdhl')} onChange={e => handleUpdate('lsrUsePdhl', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300" title="Hours added to UTC for the trading-day boundary (e.g. 3 for a UTC+3 broker day)">Day boundary (UTC ±h)</label>
                                    <input type="number" step="1" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrDayOffset')} onChange={e => handleUpdate('lsrDayOffset', e.target.value)} />
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Confirmation</label>
                                    <select value={lsr('lsrConfirm')} onChange={e => handleUpdate('lsrConfirm', e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-white">
                                        <option value="rejection">Sweep candle closes back inside</option>
                                        <option value="next_candle">Next candle confirms (closes beyond sweep body)</option>
                                    </select>
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300">Require RSI turn (momentum filter)</label>
                                    <input type="checkbox" checked={lsr('lsrUseRsi')} onChange={e => handleUpdate('lsrUseRsi', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-0" />
                                </div>
                                <div className="flex justify-between items-center">
                                    <label className="text-xs text-slate-700 dark:text-slate-300" title="Skip a setup when the opposite liquidity (the natural target) is less than this many R away. 0 = off">Min R:R to opposite liquidity</label>
                                    <input type="number" step="0.5" min="0" className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-indigo-500" value={lsr('lsrMinRR')} onChange={e => handleUpdate('lsrMinRR', e.target.value)} />
                                </div>
                                <button type="button" onClick={() => { handleUpdate('lsrUsePdhl', true); handleUpdate('lsrConfirm', 'next_candle'); handleUpdate('lsrUseRsi', false); handleUpdate('lsrMinRR', 2); }}
                                    className="w-full mt-1 text-[11px] font-semibold px-2 py-1.5 rounded border border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">
                                    Liquidity-concept preset: PDH/PDL · confirmation candle · no RSI · min 1:2
                                </button>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">Liquidity = previous-day high/low and H1/H4 swing points. A sweep takes the stops beyond a level and closes back inside; SL goes beyond the sweep wick, the purple line is the opposite liquidity (natural target). Levels only count once they exist (no look-ahead).</p>
                            </div>
                        </div>
                        );
                    })()}

                </div>
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end shrink-0">
                    <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded transition-colors shadow-sm">
                        Apply & Close
                    </button>
                </div>
            </div>
        </div>
    );
}
