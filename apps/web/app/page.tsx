"use client";

import { Fragment, useEffect, useState } from "react";
import { InteractiveChart } from "@/components/interactive-chart";
import { useLiveEngine } from "@/lib/use-live-engine";
import type { DistanceMode, StrategyConfig } from "@/lib/types";

const modes: { value: DistanceMode; label: string }[] = [
  { value: "points", label: "Points" },
  { value: "percent", label: "Percentage" },
  { value: "reference_candle", label: "Previous candle" },
];

function PositiveNumberInput({
  value,
  onChange,
  min = 0,
  step = "any",
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number | "any";
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const parsedDraft = Number(draft);
  const invalid = !disabled && (draft === "" || !Number.isFinite(parsedDraft) || parsedDraft < min);

  useEffect(() => setDraft(String(value)), [value]);

  return <>
    <input
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      disabled={disabled}
      value={draft}
      aria-invalid={invalid}
      onKeyDown={(event) => {
        if (["-", "+", "e", "E"].includes(event.key)) event.preventDefault();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next === "") return;
        const parsed = Number(next);
        if (Number.isFinite(parsed) && parsed >= min) onChange(parsed);
      }}
    />
    {invalid && <small className="number-error" role="alert">Value 0 se bada hona chahiye</small>}
  </>;
}

function Icon({ name }: { name: "symbol" | "clock" | "lot" | "shield" | "target" }) {
  const paths = {
    symbol: <><circle cx="12" cy="12" r="8"/><path d="M8 12h8m-4-4v8"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
    lot: <><path d="M4 17h16M6 14l4-4 3 2 5-6"/><path d="m15 6h3v3"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m14 10 5-5"/></>,
  };
  return <svg className="field-icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function LiveSignalChart({ dashboard, direction }: { dashboard: NonNullable<ReturnType<typeof useLiveEngine>["dashboard"]>; direction: "buy" | "sell" }) {
  const candles = dashboard.candles.slice(-42);
  if (!candles.length) return <div className="chart-loading">Waiting for market candles…</div>;
  const width = 900, height = 330, top = 18, bottom = 38;
  const prices = candles.flatMap((candle) => [candle.high, candle.low]);
  if (dashboard.reference) prices.push(dashboard.reference.high, dashboard.reference.low);
  const min = Math.min(...prices), max = Math.max(...prices), range = Math.max(max - min, 0.00001);
  const y = (price: number) => top + ((max - price) / range) * (height - top - bottom);
  const step = width / candles.length;
  const bodyWidth = Math.max(3, step * .58);
  const remaining = `${Math.floor(dashboard.remaining_seconds / 60).toString().padStart(2,"0")}:${Math.floor(dashboard.remaining_seconds % 60).toString().padStart(2,"0")}`;
  return <div className="live-chart-wrap">
    <div className="chart-toolbar"><div><span className="live-dot"/><strong>LIVE CANDLES</strong><small>{candles.length} bars</small></div><div className={`condition-chip ${dashboard.condition_met ? "met" : "waiting"}`}><span>{dashboard.condition_met ? "✓" : "◷"}</span>{dashboard.condition_met ? "Condition met — waiting close" : "Waiting for condition"}</div><div className="candle-timer"><small>CANDLE CLOSE</small><strong>{remaining}</strong></div></div>
    <svg className="signal-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Live candlestick signal chart">
      {[.2,.4,.6,.8].map((value) => <line key={value} x1="0" x2={width} y1={top+(height-top-bottom)*value} y2={top+(height-top-bottom)*value} className="grid-line"/>)}
      {dashboard.reference && <><line x1="0" x2={width} y1={y(dashboard.reference.high)} y2={y(dashboard.reference.high)} className="reference-line high"/><text x="8" y={y(dashboard.reference.high)-6} className="reference-text">REF HIGH {dashboard.reference.high.toFixed(2)}</text><line x1="0" x2={width} y1={y(dashboard.reference.low)} y2={y(dashboard.reference.low)} className="reference-line low"/><text x="8" y={y(dashboard.reference.low)+14} className="reference-text">REF LOW {dashboard.reference.low.toFixed(2)}</text></>}
      {candles.map((candle,index) => { const bullish=candle.close>=candle.open; const x=index*step+step/2; const bodyTop=y(Math.max(candle.open,candle.close)); const bodyHeight=Math.max(1.5,Math.abs(y(candle.open)-y(candle.close))); return <g key={candle.time} className={index===candles.length-1?"current-candle":""}><line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} className={bullish?"wick up":"wick down"}/><rect x={x-bodyWidth/2} y={bodyTop} width={bodyWidth} height={bodyHeight} rx="1" className={bullish?"candle-body up":"candle-body down"}/></g>})}
      {dashboard.positions.map((position) => <g key={position.ticket}><line x1="0" x2={width} y1={y(position.entry)} y2={y(position.entry)} className="entry-line"/><text x={width-8} y={y(position.entry)-6} textAnchor="end" className="entry-text">LEG {position.leg} · {position.entry}</text></g>)}
      <text x="8" y={height-9} className="chart-caption">{direction.toUpperCase()} signal monitor · green bullish · red bearish</text>
    </svg>
  </div>;
}

export function TradingConsole({ view }: { view: "dashboard" | "settings" }) {
  const { connected, config, setConfig, market, engineRunning, dashboard, chartHistory, requestChart, symbols, searchSymbols, closePosition, saveStatus, save, errorNotice, dismissError } = useLiveEngine();
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [theme, setTheme] = useState<"day" | "night">("day");
  const [legDrafts, setLegDrafts] = useState<Record<number, StrategyConfig["legs"][number]>>({});
  const [expandedLeg, setExpandedLeg] = useState<number | null>(null);
  const [submittedLeg, setSubmittedLeg] = useState<number | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("phlc-theme") === "night" ? "night" : "day";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  const toggleTheme = () => {
    const next = theme === "day" ? "night" : "day";
    setTheme(next);
    localStorage.setItem("phlc-theme", next);
    document.documentElement.dataset.theme = next;
  };
  useEffect(() => {
    if (!symbolOpen || !config) return;
    const timer = setTimeout(() => searchSymbols(config.symbol), 180);
    return () => clearTimeout(timer);
  }, [config, searchSymbols, symbolOpen]);
  if (!config) {
    return <main className="loading">Connecting to local trading engine…{errorNotice && <ErrorPopup title={errorNotice.title} message={errorNotice.message} onClose={dismissError} />}</main>;
  }

  const patch = (value: Partial<StrategyConfig>) => setConfig({ ...config, ...value });
  const patchLeg = (index: number, value: Partial<StrategyConfig["legs"][number]>) => {
    const legs = config.legs.map((leg, position) =>
      position === index ? { ...leg, ...value } : leg,
    );
    patch({ legs });
  };
  const addLeg = () => {
    if (config.legs.length >= 20) return;
    patch({ legs: [...config.legs, {
      enabled: true, volume: 0.01,
      stop_loss: { mode: "reference_candle", value: 0 },
      take_profit: { mode: "points", value: 5 },
    }] });
  };
  const deleteLeg = (index: number) => {
    if (config.legs.length > 1 && !config.legs[index].enabled) {
      patch({ legs: config.legs.filter((_, position) => position !== index) });
    }
  };
  const editDashboardLeg = (index: number, value: Partial<StrategyConfig["legs"][number]>) => {
    setLegDrafts((current) => {
      const candidate = { ...(current[index] ?? config.legs[index]), ...value };
      const next = { ...current };
      if (JSON.stringify(candidate) === JSON.stringify(config.legs[index])) delete next[index];
      else next[index] = candidate;
      return next;
    });
  };
  const updateDashboardLeg = (index: number) => {
    const draft = legDrafts[index];
    if (!draft) return;
    const updated = { ...config, legs: config.legs.map((leg, position) => position === index ? draft : leg) };
    setSubmittedLeg(index + 1);
    save(updated);
    setLegDrafts((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  };
  const money = (value?: number) => `${dashboard?.account.currency ?? ""} ${(value ?? 0).toFixed(2)}`;

  return (
    <div className="app-shell">
      {errorNotice && <ErrorPopup title={errorNotice.title} message={errorNotice.message} onClose={dismissError} />}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div><strong>PHLC</strong><small>Trading Console</small></div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Trading navigation">
          <a className={view === "dashboard" ? "nav-active" : ""} href="/">
            <svg viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>
            <span><strong>Overview</strong><small>Engine control</small></span>
          </a>
          <a className={view === "settings" ? "nav-active" : ""} href="/settings">
            <svg viewBox="0 0 24 24"><path d="M4 19V9m0 6h4M8 5v14m4 0V7m0 4h4m0-7v15m4 0V9m-4 5h4" /></svg>
            <span><strong>Settings</strong><small>Market, legs & risk</small></span>
          </a>
        </nav>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle day and night mode">
          <span className="theme-track"><span className="theme-thumb">{theme === "day" ? "☀" : "☾"}</span></span>
          <span><strong>{theme === "day" ? "Day mode" : "Night mode"}</strong><small>Appearance</small></span>
        </button>
      </aside>
    <main className="content">
      <header className="trading-header" id="overview">
        <div>
          <p className="eyebrow">TRADING ENGINE</p>
          <h1>{config.symbol}</h1>
          <span className="timeframe">{config.timeframe} strategy</span>
        </div>
        <div className="header-metrics">
          <div className="metric price"><small>LIVE BID</small><strong>{market?.bid?.toFixed(2) ?? "—"}</strong></div>
          <div className="metric price"><small>LIVE ASK</small><strong>{market?.ask?.toFixed(2) ?? "—"}</strong></div>
          <div className="metric"><small>CURRENT TREND</small><strong className={config.direction === "sell" ? "sell" : "buy"}>{config.direction.toUpperCase()}</strong></div>
          <div className="metric"><small>ENGINE</small><strong className={engineRunning && connected ? "buy" : "sell"}>{engineRunning && connected ? "STARTED" : "OFFLINE"}</strong></div>
          <div className="strategy-control">
            <span><small>STRATEGY</small><strong>{config.enabled ? "ON" : "OFF"}</strong></span>
            <button className={`power-switch ${config.enabled ? "on" : ""}`} role="switch" aria-checked={config.enabled} onClick={() => save({ ...config, enabled: !config.enabled })}><span /></button>
          </div>
        </div>
      </header>
        {saveStatus !== "idle" && <div className={`save-toast ${saveStatus}`}><span>{saveStatus === "saving" ? "↻" : "✓"}</span><div><strong>{saveStatus === "saving" ? "Updating…" : submittedLeg ? `Leg ${submittedLeg} updated` : "Settings updated"}</strong><small>{saveStatus === "saving" ? "Saving changes to trading engine" : "Changes are active in the engine"}</small></div></div>}
        {view === "dashboard" && <section className="overview-dashboard">
          <div className="account-strip">
            <article><small>ACCOUNT BALANCE</small><strong>{money(dashboard?.account.balance)}</strong></article>
            <article><small>EQUITY</small><strong>{money(dashboard?.account.equity)}</strong></article>
            <article><small>FREE MARGIN</small><strong>{money(dashboard?.account.free_margin)}</strong></article>
            <article><small>FLOATING P&amp;L</small><strong className={(dashboard?.pnl ?? 0) < 0 ? "sell" : "buy"}>{money(dashboard?.pnl)}</strong></article>
          </div>
          <div className="dashboard-main-grid">
            <article className="card signal-panel">
              {dashboard ? <InteractiveChart dashboard={dashboard} history={chartHistory ?? { timeframe: config.timeframe, candles: dashboard.candles }} historyReady={Boolean(chartHistory)} market={market} initialTimeframe={config.timeframe} direction={config.direction} theme={theme} requestChart={requestChart}/> : <div className="chart-loading">Loading MT5 candles…</div>}
            </article>
          </div>
          <article className="card leg-manager-panel">
            <div className="panel-head"><div><p className="label">ACTIVE LEG MANAGEMENT</p><h2>Leg settings</h2></div></div>
            <div className="leg-manager-table"><table><thead><tr><th>Leg</th><th><span className="table-heading"><Icon name="lot"/>Lot size</span></th><th><span className="table-heading"><Icon name="shield"/>Stop loss</span></th><th>SL value</th><th><span className="table-heading"><Icon name="target"/>Target</span></th><th>Target value</th><th>State</th><th></th></tr></thead><tbody>
              {config.legs.map((savedLeg, index) => { const leg = legDrafts[index] ?? savedLeg; const position = dashboard?.positions.find((item) => item.leg === index + 1); return savedLeg.enabled && <Fragment key={index}><tr>
                <td><span className="leg-number"><i>{index + 1}</i><strong>Leg {index + 1}</strong></span></td>
                <td><div className="table-control"><Icon name="lot"/><PositiveNumberInput min={0.01} step={0.01} value={leg.volume} onChange={(value) => editDashboardLeg(index, { volume: value })}/></div></td>
                <td><div className="table-control"><Icon name="shield"/><select value={leg.stop_loss.mode} onChange={(e) => { const mode = e.target.value as DistanceMode; editDashboardLeg(index, { stop_loss: { ...leg.stop_loss, mode, value: mode === "reference_candle" ? 0 : Math.max(0.01, leg.stop_loss.value) } }); }}>{modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></div></td>
                <td><div className="value-control"><PositiveNumberInput min={0.01} disabled={leg.stop_loss.mode === "reference_candle"} value={leg.stop_loss.value} onChange={(value) => editDashboardLeg(index, { stop_loss: { ...leg.stop_loss, value } })}/><span>{leg.stop_loss.mode === "percent" ? "%" : leg.stop_loss.mode === "points" ? "PTS" : "AUTO"}</span></div></td>
                <td><div className="table-control"><Icon name="target"/><select value={leg.take_profit.mode} onChange={(e) => editDashboardLeg(index, { take_profit: { ...leg.take_profit, mode: e.target.value as "points" | "percent" } })}>{modes.slice(0,2).map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></div></td>
                <td><div className="value-control"><PositiveNumberInput min={0.01} value={leg.take_profit.value} onChange={(value) => editDashboardLeg(index, { take_profit: { ...leg.take_profit, value } })}/><span>{leg.take_profit.mode === "percent" ? "%" : "PTS"}</span></div></td>
                <td><span className={`leg-state ${position ? "running" : "ready"}`}>{position ? "RUNNING" : "READY"}</span></td>
                <td className="row-update"><div>{legDrafts[index] && <button className="primary" disabled={!connected} onClick={() => updateDashboardLeg(index)}>Update</button>}{position && <button className="view-leg" onClick={() => setExpandedLeg(expandedLeg === index ? null : index)}>{expandedLeg === index ? "Hide" : "View"}</button>}</div></td>
              </tr>{position && expandedLeg === index && <tr className="leg-detail-row"><td colSpan={8}><div className="trade-detail">
                <div className="trade-detail-head"><div><span className={`side-pill ${position.side}`}>{position.side.toUpperCase()}</span><strong>Ticket #{position.ticket}</strong></div><button className="close-trade" onClick={() => { if (window.confirm(`Close Leg ${index + 1} position #${position.ticket}?`)) closePosition(position.ticket); }}>Close trade</button></div>
                <div className="trade-facts"><span><small>OPENED AT</small><strong>{new Date(position.time * 1000).toLocaleString()}</strong></span><span><small>ENTRY PRICE</small><strong>{position.entry}</strong></span><span><small>CURRENT PRICE</small><strong>{position.current}</strong></span><span><small>LOT</small><strong>{position.volume}</strong></span><span><small>STOP LOSS</small><strong>{position.sl || "—"}</strong></span><span><small>TARGET</small><strong>{position.tp || "—"}</strong></span><span><small>LIVE P&amp;L</small><strong className={position.profit < 0 ? "sell" : "buy"}>{money(position.profit)}</strong></span></div>
                {position.signal ? <div className="candle-details"><div><small>REFERENCE CANDLE</small><strong>{new Date(position.signal.reference.time).toLocaleString()}</strong><p>O {position.signal.reference.open} · H {position.signal.reference.high} · L {position.signal.reference.low} · C {position.signal.reference.close}</p></div><div><small>SIGNAL CANDLE</small><strong>{new Date(position.signal.confirmation.time).toLocaleString()}</strong><p>O {position.signal.confirmation.open} · H {position.signal.confirmation.high} · L {position.signal.confirmation.low} · C {position.signal.confirmation.close}</p></div></div> : <p className="historic-note">Signal candle details are recorded for trades opened by the current engine session.</p>}
              </div></td></tr>}</Fragment>})}
            </tbody></table></div>
            <p className="manager-note">Changes apply to new entries. Existing broker positions keep their current SL and target.</p>
          </article>
        </section>}

        {view === "settings" && <section className="card settings" id="market-setup">
          <div className="section-title">
            <div><p className="label">01</p><h2>Market setup</h2></div>
            <button className="primary" disabled={!connected} onClick={() => save(config)}>Apply settings</button>
          </div>
          <div className="fields market-fields">
            <label>Symbol<div className="input-shell symbol-search"><Icon name="symbol"/><input autoComplete="off" value={config.symbol} onFocus={() => { setSymbolOpen(true); searchSymbols(config.symbol); }} onBlur={() => setTimeout(() => setSymbolOpen(false), 150)} onChange={(e) => { patch({ symbol: e.target.value.toUpperCase() }); setSymbolOpen(true); }} />
              {symbolOpen && <div className="symbol-results">
                {symbols.length === 0 && <div className="symbol-empty">No broker symbols found</div>}
                {symbols.map((symbol) => <button key={symbol.name} onMouseDown={(event) => event.preventDefault()} onClick={() => { patch({ symbol: symbol.name }); setSymbolOpen(false); }}>
                  <span><strong>{symbol.name}</strong><small>{symbol.description || "Broker symbol"}</small></span>
                  <em>{symbol.currency}</em>
                </button>)}
              </div>}
            </div></label>
            <label>Timeframe<div className="input-shell"><Icon name="clock"/><select value={config.timeframe} onChange={(e) => patch({ timeframe: e.target.value })}>
              {['M1','M5','M15','M30','H1','H4','D1'].map((item) => <option key={item}>{item}</option>)}
            </select></div></label>
            <label>Trade direction<div className={`direction-switch compact-direction direction-${config.direction}`}>
              <button className={config.direction === "buy" ? "buy-active" : ""} onClick={() => patch({ direction: "buy" })}>
                <svg viewBox="0 0 24 24"><path d="M4 17 10 11l4 4 6-8"/><path d="M15 7h5v5"/></svg>BUY
              </button>
              <button className={config.direction === "sell" ? "sell-active" : ""} onClick={() => patch({ direction: "sell" })}>
                <svg viewBox="0 0 24 24"><path d="m4 7 6 6 4-4 6 8"/><path d="M15 17h5v-5"/></svg>SELL
              </button>
            </div></label>
          </div>

          <div className="section-title legs-title" id="entry-legs">
            <div><p className="label">02</p><h2>Entry legs</h2></div>
            <button className="add-leg" disabled={config.legs.length >= 20} onClick={addLeg}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add leg
            </button>
          </div>
          <div className="lifecycle-settings">
            <div className="lifecycle-setting">
              <div><strong>After a leg closes</strong><small>Choose which settings the next entry will use.</small></div>
              <div className="lifecycle-options">
                <button type="button" className={config.closed_leg_behavior === "same_leg" ? "active" : ""} onClick={() => patch({ closed_leg_behavior: "same_leg" })}>Same leg settings</button>
                <button type="button" className={config.closed_leg_behavior === "next_leg" ? "active" : ""} onClick={() => patch({ closed_leg_behavior: "next_leg" })}>Next leg settings</button>
              </div>
            </div>
            <div className="lifecycle-setting">
              <div><strong>After a trade enters</strong><small>Choose whether new signals should remain enabled.</small></div>
              <div className="lifecycle-options">
                <button type="button" className={!config.stop_after_entry ? "active" : ""} onClick={() => patch({ stop_after_entry: false })}>Keep running</button>
                <button type="button" className={config.stop_after_entry ? "active danger" : ""} onClick={() => patch({ stop_after_entry: true })}>Stop after entry</button>
              </div>
            </div>
          </div>
          <div className="legs">
            {config.legs.map((leg, index) => (
              <article className={`leg ${leg.enabled ? "" : "disabled"}`} key={index}>
                <div className="leg-head"><strong>Leg {index + 1}</strong><div className="leg-actions">
                  <button className="delete-leg" disabled={config.legs.length === 1 || leg.enabled} onClick={() => deleteLeg(index)} aria-label={`Delete leg ${index + 1}`} title={leg.enabled ? "Disable this leg before deleting" : "Delete leg"}>
                    <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
                  </button>
                  <label className="switch"><input type="checkbox" checked={leg.enabled} onChange={(e) => patchLeg(index, { enabled: e.target.checked })} /><span /></label>
                </div></div>
                <div className="fields compact">
                  <label>Lot size<div className="input-shell"><Icon name="lot"/><PositiveNumberInput min={0.01} step={0.01} value={leg.volume} onChange={(value) => patchLeg(index, { volume: value })} /></div></label>
                  <label>Stop loss<div className="input-shell"><Icon name="shield"/><select value={leg.stop_loss.mode} onChange={(e) => { const mode = e.target.value as DistanceMode; patchLeg(index, { stop_loss: { ...leg.stop_loss, mode, value: mode === "reference_candle" ? 0 : Math.max(0.01, leg.stop_loss.value) } }); }}>{modes.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></div></label>
                  <label>SL value<PositiveNumberInput min={0.01} disabled={leg.stop_loss.mode === "reference_candle"} value={leg.stop_loss.value} onChange={(value) => patchLeg(index, { stop_loss: { ...leg.stop_loss, value } })} /></label>
                  <label>Target<div className="input-shell"><Icon name="target"/><select value={leg.take_profit.mode} onChange={(e) => patchLeg(index, { take_profit: { ...leg.take_profit, mode: e.target.value as "points" | "percent" } })}>{modes.slice(0, 2).map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></div></label>
                  <label>Target value<PositiveNumberInput min={0.01} value={leg.take_profit.value} onChange={(value) => patchLeg(index, { take_profit: { ...leg.take_profit, value } })} /></label>
                </div>
              </article>
            ))}
          </div>
        </section>}
    </main>
    </div>
  );
}

function ErrorPopup({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return <div className="error-popup" role="alertdialog" aria-live="assertive" aria-label={title}>
    <span className="error-popup-icon">!</span>
    <div><strong>{title}</strong><p>{message}</p></div>
    <button type="button" onClick={onClose} aria-label="Dismiss error">×</button>
  </div>;
}

export default function DashboardPage() {
  return <TradingConsole view="dashboard" />;
}
