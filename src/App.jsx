// src/App.jsx
import React, { useState, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

/**
 * Retirement Bucket Simulator (single-file)
 *
 * - Uses Tailwind via CDN (do not import tailwindcss here)
 * - Requires: npm i chart.js react-chartjs-2
 *
 * Behaviour:
 * - Inputs tab: set corpus, first-year expense, inflation, mode (auto/manual),
 *   allocation %, avg return %, volatility % (for each bucket).
 * - Start -> initializes balances
 * - Next Year -> apply random returns, then withdraw expenses from Bucket1.
 *     * Auto mode: pull from other buckets automatically
 *     * Manual mode: if Bucket1 short, simulation pauses and creates a pendingYear.
 *       User must perform transfer(s) to proceed (transfer UI below).
 * - Each row stored in `history` contains: year, returnsAmt[], endValues[], total.
 */

const DEFAULT_BUCKETS = [
  { name: "Liquid Funds", allocation: 10, avgReturn: 4, volatility: 1 },
  { name: "Debt Funds", allocation: 40, avgReturn: 7, volatility: 2 },
  { name: "Commodities (Gold/Silver)", allocation: 10, avgReturn: 8, volatility: 5 },
  { name: "Equity Large Cap", allocation: 25, avgReturn: 12, volatility: 15 },
  { name: "Equity Small/Mid Cap", allocation: 15, avgReturn: 16, volatility: 25 }
];

export default function App() {
  // UI tabs
  const [tab, setTab] = useState("inputs");

  // Inputs (defaults set as requested)
  const [corpus, setCorpus] = useState(200 * 100000); // ₹200 lakh
  const [firstYearExpenses, setFirstYearExpenses] = useState(3 * 100000); // ₹3 lakh
  const [inflation, setInflation] = useState(6); // %
  const [modeManual, setModeManual] = useState(false); // manual transfer toggle
  const [buckets, setBuckets] = useState(DEFAULT_BUCKETS);

  // Simulation state
  const [balances, setBalances] = useState([]); // current balances array (numbers)
  const [history, setHistory] = useState([]); // rows for the table
  const [year, setYear] = useState(0); // completed years
  const [pendingYear, setPendingYear] = useState(null); // when manual transfer required

  // Transfer UI state
  const [transferFrom, setTransferFrom] = useState(1); // default: from bucket 2
  const [transferTo, setTransferTo] = useState(0); // to bucket 1
  const [transferAmount, setTransferAmount] = useState("");

  // helper: allocation sum validation
  const allocationSum = useMemo(() => buckets.reduce((s, b) => s + Number(b.allocation || 0), 0), [buckets]);

  
  // start simulation: initialize balances
  function startSimulation() {
    if (Math.round(allocationSum) !== 100) {
      alert("Allocation % across buckets must total exactly 100");
      return;
    }
    const initBalances = buckets.map(b => (corpus * (b.allocation / 100)));
    setBalances(initBalances);
    setHistory([]);
    setYear(0);
    setPendingYear(null);
    setTab("simulation");
  }

  // Next year step (single year) — does returns then withdrawal.
  function nextYear() {
    if (!balances || balances.length === 0) {
      alert("Start simulation first (Start button in Inputs tab).");
      return;
    }
    if (pendingYear) {
      alert("You have a pending transfer requirement. Fix transfers before advancing.");
      return;
    }

    const nextYearIndex = year + 1;
    const expenseThisYear = firstYearExpenses * Math.pow(1 + inflation / 100, year); // year=0 => firstYearExpenses

    // Use correlated returns
    const avgReturns = buckets.map(b => b.avgReturn);
    const volatilities = buckets.map(b => b.volatility);
    const returnsPct = correlatedReturns(avgReturns, volatilities, CORRELATION_MATRIX);

    // 1) compute return amounts and apply returns
    let newBalances = balances.map((bal, i) => {
      const pct = returnsPct[i] / 100;
      const gain = bal * pct;
      return Math.max(0, bal + gain); // avoid negative due to numerical issues
    });

    const returnAmounts = newBalances.map((newBal, i) => (newBal - balances[i]));

    // 2) attempt withdrawal from Bucket 1 (Liquid Funds)
    if (newBalances[0] >= expenseThisYear) {
      newBalances[0] -= expenseThisYear;
      // record row
      pushHistoryRow(nextYearIndex, returnAmounts, newBalances);
      setBalances(newBalances);
      setYear(nextYearIndex);
      return;
    }

    // Bucket1 insufficient
    const shortfall = expenseThisYear - newBalances[0];

    // Always require manual transfer if Liquid Fund can't cover expense
    setPendingYear({
      year: nextYearIndex,
      returnsPct,
      returnAmounts,
      balancesBeforeWithdrawal: [...newBalances],
      expenseThisYear,
      shortfall
    });
    alert("Liquid Fund cannot cover the current expense. Please transfer funds to Liquid Fund before proceeding.");
    // do NOT change balances or history yet; wait for user transfers
    return;
  }

  // push row into history. Note: we store returnAmounts (absolute) and endValues (numbers)
  function pushHistoryRow(yearIndex, returnAmounts, endBalances) {
    const total = endBalances.reduce((s, v) => s + v, 0);
    const row = {
      year: yearIndex,
      returnsAmt: returnAmounts.map(r => Number(r)), // absolute rupee amounts
      endValues: endBalances.map(v => Number(v)),
      total
    };
    setHistory(prev => [...prev, row]);
  }

  // Manual transfer handler — used any time (both in pending state or normal)
  function transferFunds() {
    const from = Number(transferFrom);
    const to = Number(transferTo);
    const amountLakh = Number(transferAmount);
    const amount = amountLakh * 100000; // convert lakh to actual amount
    if (from === to) {
      alert("Choose different source and destination buckets.");
      return;
    }
    if (!balances || balances.length === 0) {
      alert("No balances available. Start simulation first.");
      return;
    }
    if (amount <= 0) {
      alert("Transfer amount must be > 0");
      return;
    }
    if (balances[from] < amount) {
      alert("Not enough balance in chosen source bucket.");
      return;
    }

    // apply transfer
    const newBalances = [...balances];
    newBalances[from] -= amount;
    newBalances[to] += amount;
    setBalances(newBalances);

    // if we had a pendingYear waiting for funds to cover expense, check if resolved:
    if (pendingYear) {
      const pb = [...pendingYear.balancesBeforeWithdrawal]; // balances after returns but before withdrawal (snapshot)
      pb[from] -= amount;
      pb[to] += amount;
      if (pb[0] >= pendingYear.expenseThisYear) {
        pb[0] -= pendingYear.expenseThisYear;
        // Remove any existing row for this year before adding the new one
        setHistory(prev => [
          ...prev.filter(r => r.year !== pendingYear.year),
          {
            year: pendingYear.year,
            returnsAmt: pendingYear.returnAmounts ? pendingYear.returnAmounts.map(r => Number(r)) : pendingYear.returnsPct.map((p,i)=> pb[i]*p/100),
            endValues: pb.map(v => Number(v)),
            total: pb.reduce((s,v)=>s+v,0)
          }
        ]);
        setBalances(pb);
        setYear(pendingYear.year);
        setPendingYear(null);
        setTransferAmount("");
        return;
      } else {
        setPendingYear(prev => ({
          ...prev,
          balancesBeforeWithdrawal: pb,
          shortfall: pendingYear.expenseThisYear - pb[0]
        }));
        setTransferAmount("");
        return;
      }
    }

    // when no pendingYear, transfers apply immediately and history does not change retroactively.
    setTransferAmount("");
  }

  // Reset everything to inputs state
  function resetAll() {
    setTab("inputs");
    setBalances([]);
    setHistory([]);
    setYear(0);
    setPendingYear(null);
    setTransferAmount("");
  }

  // Chart data from history
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return null;
    const labels = history.map(r => `Year ${r.year}`);
    const datasets = [
      // Total corpus line (make it stand out)
      {
        label: "Total Corpus",
        data: history.map(r => r.total),
        fill: false,
        borderColor: "#FFD700", // gold
        borderWidth: 4,
        pointRadius: 4,
        pointBackgroundColor: "#FFD700",
        tension: 0.2,
        yAxisID: "y",
      },
      // Individual buckets
      ...buckets.map((b, idx) => ({
        label: b.name,
        data: history.map(r => r.endValues[idx]),
        fill: false,
        borderColor: `hsl(${(idx * 60) % 360} 70% 50%)`,
        borderWidth: 2,
        pointRadius: 2,
        pointBackgroundColor: `hsl(${(idx * 60) % 360} 70% 50%)`,
        tension: 0.2,
        yAxisID: "y",
      }))
    ];
    return { labels, datasets };
  }, [history, buckets]);

  // helper for formatting numbers (lakhs display is optional)
  const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-semibold mb-4">Retirement Bucket Simulator</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("inputs")} className={`px-3 py-2 rounded ${tab==="inputs" ? "bg-blue-600":"bg-gray-800"}`}>Inputs</button>
        <button onClick={() => setTab("simulation")} className={`px-3 py-2 rounded ${tab==="simulation" ? "bg-blue-600":"bg-gray-800"}`} disabled={balances.length === 0}>Simulation</button>
        <button onClick={resetAll} className="ml-auto px-3 py-2 rounded bg-red-600">Reset</button>
      </div>

      {/* INPUTS TAB */}
      {tab === "inputs" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col">
              Starting Corpus (Lakh)
              <input
                className="mt-1 p-2 bg-gray-800 text-white rounded"
                type="number"
                value={corpus / 100000}
                onChange={e => setCorpus(Number(e.target.value) * 100000)}
              />
            </label>
            <label className="flex flex-col">
              First-year Annual Expenses (Lakh)
              <input
                className="mt-1 p-2 bg-gray-800 text-white rounded"
                type="number"
                value={firstYearExpenses / 100000}
                onChange={e => setFirstYearExpenses(Number(e.target.value) * 100000)}
              />
            </label>
            <label className="flex flex-col">
              Inflation %
              <input className="mt-1 p-2 bg-gray-800 text-white rounded" type="number" value={inflation} onChange={e => setInflation(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={modeManual} onChange={e => setModeManual(e.target.checked)} />
              Manual Transfer Mode (if checked, simulation pauses when Bucket1 short)
            </label>
          </div>

          <div className="mt-2">
            {/* Buckets Heading */}
            <div className="text-sm mb-2 font-semibold">Buckets (allocation must total 100%) — input values are editable</div>
            {/* Buckets Table */}
            <div className="grid grid-cols-1 gap-2">
              <div className="grid grid-cols-4 gap-2 items-center bg-gray-700 p-2 rounded font-semibold text-gray-200">
                <div>Name</div>
                <div>Allocation %</div>
                <div>Avg Return %</div>
                <div>Volatility %</div>
              </div>
              {buckets.map((b, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 items-center bg-gray-800 p-3 rounded">
                  <div>{b.name}</div>
                  <input className="p-2 bg-gray-700 text-white rounded" type="number" value={b.allocation} onChange={e => setBuckets(prev => prev.map((p,i)=> i===idx? {...p, allocation: Number(e.target.value)}:p))} />
                  <input className="p-2 bg-gray-700 text-white rounded" type="number" value={b.avgReturn} onChange={e => setBuckets(prev => prev.map((p,i)=> i===idx? {...p, avgReturn: Number(e.target.value)}:p))} />
                  <input className="p-2 bg-gray-700 text-white rounded" type="number" value={b.volatility} onChange={e => setBuckets(prev => prev.map((p,i)=> i===idx? {...p, volatility: Number(e.target.value)}:p))} />
                </div>
              ))}
            </div>
            <div className="mt-2">Total allocation: <span className={allocationSum!==100? "text-red-400":"text-green-400"}>{allocationSum}%</span></div>
            <div className="mt-4">
              <button className="px-4 py-2 bg-green-600 rounded" onClick={startSimulation}>Start Simulation</button>
            </div>
          </div>
        </div>
      )}

      {/* SIMULATION TAB */}
      {tab === "simulation" && (
        <div className="space-y-4">
          {/* Header / Controls */}
          <div className="flex gap-6 items-center">
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm">Current Year</div>
              <div className="text-xl font-bold">{year}</div>
            </div>
            <div className="flex-1 bg-gray-800 p-3 rounded">
              <div className="text-sm">Bucket 1 cover suggestion</div>
              <div className="text-lg">
                {balances && balances.length ? (
                  (() => {
                    const startingBucket1 = balances[0];
                    const expense = firstYearExpenses * Math.pow(1 + inflation/100, year);
                    if (expense <= 0) return "—";
                    const yrs = Math.floor((startingBucket1 / expense));
                    return `Bucket 1 can support ~ ${yrs} year(s) at current expense`;
                  })()
                ) : "—"}
              </div>
            </div>
            <div className="flex gap-6">
              {/* Make Next Year button larger (double size) */}
              <button
                className="w-32 h-32 flex items-center justify-center bg-blue-600 rounded-lg text-white font-extrabold text-2xl shadow"
                onClick={nextYear}
                title="Move to next year"
              >
                Next<br />Year
              </button>
            </div>
          </div>

          {/* Layout: upper half cards (left) and chart (right) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Cards and Transfers */}
            <div>
              {/* Compound/Annual Return inputs */}
              <div className="bg-gray-800 p-3 rounded mb-4">
                <div className="text-sm mb-2">Compound/Annual Return inputs (avg / vol shown)</div>
                <div className="grid grid-cols-5 gap-2 text-sm">
                  {buckets.map((b, i) => (
                    <div key={i} className="text-center">
                      <div className="text-xs text-gray-400">{b.name}</div>
                      <div className="font-medium">{b.avgReturn}%</div>
                      <div className="text-xs text-gray-400">vol {b.volatility}%</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Manual Transfer */}
              <div className="bg-gray-800 p-3 rounded mb-4">
                <div className="font-semibold mb-2">Manual Transfer (any → any)</div>
                <div className="flex gap-2 items-center mb-2">
                  <div>
                    <div className="text-xs text-gray-400">From</div>
                    <select value={transferFrom} onChange={e => setTransferFrom(Number(e.target.value))} className="p-2 bg-gray-700 rounded">
                      {buckets.map((b, i) => (
                        <option key={i} value={i}>
                          {b.name} ({Math.max(0, Math.round(balances[i] / 100000)).toLocaleString()} Lakh)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">To</div>
                    <select value={transferTo} onChange={e => setTransferTo(Number(e.target.value))} className="p-2 bg-gray-700 rounded">
                      {buckets.map((b, i) => (
                        <option key={i} value={i}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Amount (Lakh)</div>
                    <input
                      className={`p-2 rounded bg-gray-700 ${balances[transferFrom] !== undefined && Number(transferAmount) > Math.round(balances[transferFrom] / 100000) ? "ring-2 ring-red-500" : "text-white"}`}
                      value={transferAmount}
                      onChange={e => setTransferAmount(e.target.value)}
                      type="number"
                      min="0"
                    />
                  </div>
                  <div>
                    <button className="px-3 py-2 bg-yellow-600 rounded" onClick={transferFunds} disabled={!balances.length}>Transfer</button>
                  </div>
                </div>
                {pendingYear && (
                  <div className="mt-4 p-3 bg-red-900/40 rounded">
                    <div className="font-semibold">Pending: Year {pendingYear.year}</div>
                    <div className="text-sm">Bucket1 shortfall: ₹{fmt(pendingYear.shortfall)}</div>
                    <div className="text-xs text-gray-300 mt-1">Please transfer to Bucket 1 (or other buckets) to resolve and then press Transfer. Once Bucket 1 has enough, the year will be committed.</div>
                  </div>
                )}
              </div>
              {/* Cards */}
              <div className="bg-gray-800 p-3 rounded">
                <div className="text-sm text-gray-400 mb-2">Current Balances</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* Current Expense Card */}
                  <div className="bg-gray-700 rounded shadow p-4 flex flex-col items-center justify-center">
                    <div className="text-xs text-gray-300 mb-1">Current Expense</div>
                    <div className="text-lg font-bold text-white">
                      {Math.round(firstYearExpenses * Math.pow(1 + inflation / 100, year) / 100000).toLocaleString()} Lakh
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      ₹{fmt(firstYearExpenses * Math.pow(1 + inflation / 100, year))}
                    </div>
                  </div>
                  {/* Bucket Balances Cards with distinct colors */}
                  {balances.map((b, i) => {
                    // Mild, distinct background colors for each card
                    const cardBg = [
                      "bg-blue-600",
                      "bg-green-600",
                      "bg-yellow-500",
                      "bg-purple-600",
                      "bg-pink-500"
                    ];
                    const textColor = [
                      "text-white",
                      "text-white",
                      "text-gray-900",
                      "text-white",
                      "text-gray-900"
                    ];
                    return (
                      <div
                        key={i}
                        className={`${cardBg[i % cardBg.length]} rounded shadow p-4 flex flex-col items-center justify-center`}
                      >
                        <div className={`text-xs mb-1 ${textColor[i % textColor.length]}`}>{buckets[i].name}</div>
                        <div className={`text-lg font-bold ${textColor[i % textColor.length]}`}>
                          {Math.max(0, Math.round(b / 100000)).toLocaleString()} Lakh
                        </div>
                        <div className={`text-xs mt-1 ${textColor[i % textColor.length]}`}>₹{fmt(b)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Right: Chart */}
            <div>
              <div className="bg-gray-800 p-3 rounded h-full flex flex-col">
                <div className="font-semibold mb-2">Chart: bucket balances over years</div>
                <div className="flex-1 flex items-center justify-center">
                  {chartData ? (
                    <Line
                      data={chartData}
                      options={{
                        plugins: {
                          legend: {
                            labels: {
                              color: "#fff",
                              font: { size: 14 }
                            }
                          },
                          tooltip: {
                            enabled: true,
                            mode: "nearest",
                            intersect: false,
                            callbacks: {
                              // Show label and value in lakh with formatting
                              label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                return `${label}: ₹${Number(value).toLocaleString()} (${Math.round(value / 100000).toLocaleString()} Lakh)`;
                              }
                            }
                          }
                        },
                        interaction: {
                          mode: "nearest",
                          intersect: false
                        },
                        scales: {
                          y: {
                            ticks: { color: "#fff" },
                            title: { display: true, text: "Amount (₹)", color: "#fff" }
                          },
                          x: {
                            ticks: { color: "#fff" }
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="text-sm text-gray-400">No data yet</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Lower half: Table */}
          <div className="bg-gray-800 p-3 rounded overflow-auto mt-4">
            <div className="font-semibold mb-2">Balances / Returns by Year</div>
            <table className="table-auto w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="p-1 border align-top" rowSpan={2}>Year</th>
                  <th className="p-1 border text-center" colSpan={buckets.length} style={{ background: "#374151" }}>Returns (%)</th>
                  <th className="p-1 border text-center" colSpan={buckets.length} style={{ background: "#374151" }}>End Value (Lakh)</th>
                  <th className="p-1 border align-top" rowSpan={2}>Total (Lakh)</th>
                </tr>
                <tr>
                  {buckets.map((b, i) => (
                    <th key={`ret-head-${i}`} className="p-1 border text-center">{b.name}</th>
                  ))}
                  {buckets.map((b, i) => (
                    <th key={`end-head-${i}`} className="p-1 border text-center">{b.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td className="p-2 text-center" colSpan={1 + buckets.length * 2 + 1}>
                      No years yet — click Move to next year
                    </td>
                  </tr>
                )}
                {/* Show all rows, latest at top */}
                {[...history].reverse().map((row, idx) => (
                  <tr key={row.year} className="text-sm">
                    <td className="p-1 border">{row.year}</td>
                    {row.returnsAmt.map((r, i) => (
                      <td
                        key={`ret${i}`}
                        className={`p-1 border text-center italic ${Number(r) < 0 ? "text-red-400 font-bold" : ""}`}
                      >
                        {balances && balances[i]
                          ? `${((r / (row.endValues[i] - r)) * 100).toFixed(2)}%`
                          : "—"}
                      </td>
                    ))}
                    {row.endValues.map((v, i) => (
                      <td key={`end${i}`} className={`p-1 border text-center ${Number(v) < 0 ? "text-red-400 font-bold" : ""}`}>
                        {Math.round(v / 100000).toLocaleString()}
                      </td>
                    ))}
                    <td className="p-1 border text-center">{Math.round(row.total / 100000).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// utility: normal-like random (Box-Muller)
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

// Updated correlation matrix based on qualitative estimates
// Order: Liquid, Debt, Gold, Large Cap, Small/Mid Cap
const CORRELATION_MATRIX = [
  // Liquid, Debt, Gold, LargeCap, SmallCap
  [ 1,   0.4,   0.05,   0.05,    0.05 ],   // Liquid Fund
  [ 0.4, 1,     0.15,   0.2,     0.2  ],   // Debt Fund
  [ 0.05,0.15,  1,     -0.2,    -0.2 ],    // Gold
  [ 0.05,0.2,  -0.2,    1,      0.9  ],    // Equity Large Cap
  [ 0.05,0.2,  -0.2,    0.9,     1   ]     // Equity Small/Mid Cap
];

// Generate correlated random returns using Cholesky decomposition
function correlatedReturns(avgReturns, volatilities, correlationMatrix) {
  const n = avgReturns.length;
  // Cholesky decomposition
  function cholesky(A) {
    const L = Array(n).fill().map(() => Array(n).fill(0));
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j <= i; ++j) {
        let sum = 0;
        for (let k = 0; k < j; ++k) sum += L[i][k] * L[j][k];
        L[i][j] = i === j
          ? Math.sqrt(A[i][i] - sum)
          : (A[i][j] - sum) / L[j][j];
      }
    }
    return L;
  }
  // Generate independent standard normals
  const z = Array(n).fill().map(() => randn());
  // Apply Cholesky
  const L = cholesky(correlationMatrix);
  const correlated = Array(n).fill(0);
  for (let i = 0; i < n; ++i) {
    for (let j = 0; j <= i; ++j) {
      correlated[i] += L[i][j] * z[j];
    }
  }
  // Convert to returns
  return avgReturns.map((avg, i) => avg + correlated[i] * volatilities[i]);
}
