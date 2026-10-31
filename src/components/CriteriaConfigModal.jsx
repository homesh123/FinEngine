import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { hasLiveApi, liveJson } from '../utils/dataSource';
import { saveCriteria } from '../utils/screenerRules';

export default function CriteriaConfigModal({ currentCriteria, onClose, onSave }) {
    const defaultFallback = {
        roe_min: 15.0,
        roic_min: 15.0,
        eps_growth_min: 12.0,
        revenue_growth_min: 10.0,
        gross_margin_min: 40.0,
        debt_to_equity_max: 0.5,
        peg_max: 1.5,
        margin_of_safety_min: 20.0,
        f_score_min: 7
    };
    
    // Merge provided criteria with fallbacks in case it's empty
    const [formData, setFormData] = useState({ ...defaultFallback, ...currentCriteria });
    const [saving, setSaving] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: parseFloat(value) }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (hasLiveApi()) {
                const data = await liveJson('/api/investment/criteria', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                onSave(data.criteria);
            } else {
                saveCriteria(formData);   // static site: criteria apply in this browser
                onSave(formData);
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Investment Criteria Configuration</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-4 overflow-y-auto custom-scrollbar">
                    <form id="criteria-form" onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min ROE (%)</label>
                                <input type="number" step="0.1" name="roe_min" value={formData.roe_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min ROIC (%)</label>
                                <input type="number" step="0.1" name="roic_min" value={formData.roic_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min Revenue Growth (%)</label>
                                <input type="number" step="0.1" name="revenue_growth_min" value={formData.revenue_growth_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min EPS Growth (%)</label>
                                <input type="number" step="0.1" name="eps_growth_min" value={formData.eps_growth_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min Gross Margin (%)</label>
                                <input type="number" step="0.1" name="gross_margin_min" value={formData.gross_margin_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Max Debt to Equity</label>
                                <input type="number" step="0.01" name="debt_to_equity_max" value={formData.debt_to_equity_max || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Max PEG Ratio</label>
                                <input type="number" step="0.1" name="peg_max" value={formData.peg_max || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min Margin of Safety (%)</label>
                                <input type="number" step="1" name="margin_of_safety_min" value={formData.margin_of_safety_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Min Piotroski F-Score</label>
                                <input type="number" step="1" min="0" max="9" name="f_score_min" value={formData.f_score_min || ''} onChange={handleChange} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Note: Depending on the API's fundamental data coverage, extremely strict criteria may filter out all stocks.</p>
                    </form>
                </div>
                
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors">
                        Cancel
                    </button>
                    <button type="submit" form="criteria-form" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded shadow-sm transition-colors disabled:opacity-50">
                        <Save size={16} />
                        {saving ? 'Saving...' : 'Save & Rescreen'}
                    </button>
                </div>
            </div>
        </div>
    );
}
