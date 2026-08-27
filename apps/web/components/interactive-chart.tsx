"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

import type { ChartCandle, DashboardSnapshot } from "@/lib/types";

const timeframes = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const seconds: Record<string, number> = { M1:60, M5:300, M15:900, M30:1800, H1:3600, H4:14400, D1:86400 };

type Props = {
  dashboard: DashboardSnapshot;
  history: { timeframe: string; candles: ChartCandle[] } | null;
  historyReady: boolean;
  market: { bid: number; ask: number; time_msc: number } | null;
  initialTimeframe: string;
  direction: "buy" | "sell";
  theme: "day" | "night";
  requestChart: (timeframe: string) => void;
};

export function InteractiveChart({ dashboard, history, historyReady, market, initialTimeframe, direction, theme, requestChart }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBar = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [hover, setHover] = useState<CandlestickData<UTCTimestamp> | null>(null);
  const forming = history?.timeframe === timeframe ? history.candles.at(-1) : null;
  const strategyCandle = timeframe === initialTimeframe ? dashboard.candles.at(-1) : null;
  const candidate = strategyCandle ?? forming;
  const livePrice = market?.bid ?? null;
  const correctCandleColor = Boolean(
    candidate && livePrice !== null && (
      (direction === "buy" && livePrice > candidate.open)
      || (direction === "sell" && livePrice < candidate.open)
    )
  );
  const oppositeSideIntact = Boolean(
    candidate && dashboard.reference && (
      (direction === "buy" && candidate.low >= dashboard.reference.low)
      || (direction === "sell" && candidate.high <= dashboard.reference.high)
    )
  );
  const showStrategyLevels = timeframe === initialTimeframe && correctCandleColor && oppositeSideIntact;

  useEffect(() => {
    if (historyReady && history?.timeframe === timeframe) return;
    requestChart(timeframe);
    const retry = setInterval(() => requestChart(timeframe), 2000);
    return () => clearInterval(retry);
  }, [history?.timeframe, historyReady, requestChart, timeframe]);

  useEffect(() => {
    if (!container.current) return;
    const dark = theme === "night";
    const instance = createChart(container.current, {
      autoSize: true,
      height: 430,
      layout: { background: { type: ColorType.Solid, color: dark ? "#090d0b" : "#ffffff" }, textColor: dark ? "#8f9d95" : "#68766f", attributionLogo: true },
      grid: { vertLines: { color: dark ? "#17201b" : "#eef2ef" }, horzLines: { color: dark ? "#17201b" : "#eef2ef" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#77857e", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#26332c" }, horzLine: { color: "#77857e", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#26332c" } },
      rightPriceScale: { borderColor: dark ? "#28332d" : "#dde5e0", scaleMargins: { top: .08, bottom: .08 } },
      timeScale: { borderColor: dark ? "#28332d" : "#dde5e0", timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 9 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candleSeries = instance.addSeries(CandlestickSeries, { upColor: "#20a464", downColor: "#e35d56", borderVisible: false, wickUpColor: "#20a464", wickDownColor: "#e35d56", priceLineVisible: true, lastValueVisible: true });
    instance.subscribeCrosshairMove((param) => {
      const value = param.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
      setHover(value ?? lastBar.current);
    });
    chart.current = instance; series.current = candleSeries;
    const resize = new ResizeObserver(() => instance.applyOptions({ width: container.current?.clientWidth ?? 800 }));
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); chart.current=null; series.current=null; };
  }, []);

  useEffect(() => {
    const dark = theme === "night";
    chart.current?.applyOptions({ layout: { background: { type: ColorType.Solid, color: dark ? "#090d0b" : "#ffffff" }, textColor: dark ? "#8f9d95" : "#68766f" }, grid: { vertLines: { color: dark ? "#17201b" : "#eef2ef" }, horzLines: { color: dark ? "#17201b" : "#eef2ef" } } });
  }, [theme]);

  useEffect(() => {
    if (!series.current || !history || history.timeframe !== timeframe) return;
    const data = history.candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp }));
    series.current.setData(data);
    lastBar.current = data.at(-1) ?? null;
    setHover(lastBar.current);
    chart.current?.timeScale().setVisibleLogicalRange({
      from: Math.max(0, data.length - 25),
      to: data.length + 4,
    });
  }, [history, timeframe]);

  useEffect(() => {
    if (!series.current || !market || !lastBar.current) return;
    const previous = lastBar.current;
    const tickTime = Math.floor(market.time_msc / 1000);
    const duration = seconds[timeframe];
    const isNew = tickTime >= Number(previous.time) + duration;
    const price = market.bid;
    const next: CandlestickData<UTCTimestamp> = isNew
      ? { time: (Number(previous.time) + duration) as UTCTimestamp, open: price, high: price, low: price, close: price }
      : { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price };
    series.current.update(next); lastBar.current = next;
  }, [market, timeframe, direction]);

  useEffect(() => {
    if (!series.current) return;
    for (const line of priceLines.current) series.current.removePriceLine(line);
    priceLines.current = [];
    if (dashboard.reference && showStrategyLevels) {
      priceLines.current.push(series.current.createPriceLine({ price: dashboard.reference.high, color: "#29925c", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Ref High" }));
      priceLines.current.push(series.current.createPriceLine({ price: dashboard.reference.low, color: "#db625b", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Ref Low" }));
    }
    for (const position of dashboard.positions) priceLines.current.push(series.current.createPriceLine({ price: position.entry, color: "#4384da", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Leg ${position.leg}` }));
  }, [dashboard.reference, dashboard.positions, showStrategyLevels]);

  const shown = hover ?? lastBar.current;
  return <div className="pro-chart">
    <div className="pro-chart-bar"><div className="ohlc"><strong>{direction.toUpperCase()}</strong>{shown && <><span>O <b>{shown.open.toFixed(2)}</b></span><span>H <b>{shown.high.toFixed(2)}</b></span><span>L <b>{shown.low.toFixed(2)}</b></span><span>C <b>{shown.close.toFixed(2)}</b></span></>}</div><div className="chart-timeframes">{timeframes.map((item) => <button key={item} className={timeframe===item?"active":""} onClick={() => setTimeframe(item)}>{item}</button>)}</div><button className="go-live" onClick={() => chart.current?.timeScale().scrollToRealTime()}>Go Live</button></div>
    <div className="condition-row"><span className={`condition-chip ${dashboard.condition_met && showStrategyLevels ? "met" : "waiting"}`}>{timeframe !== initialTimeframe ? `Chart only — strategy runs on ${initialTimeframe}` : !dashboard.reference ? "◷ Waiting for reference candle" : !oppositeSideIntact ? `✕ Setup invalid — reference ${direction === "buy" ? "low" : "high"} broken` : !correctCandleColor ? `◷ Waiting for ${direction === "buy" ? "green" : "red"} candle` : dashboard.condition_met ? "✓ Condition met — waiting candle close" : "◷ Waiting for signal condition"}</span><span>Candle closes in <strong>{Math.floor(dashboard.remaining_seconds/60).toString().padStart(2,"0")}:{Math.floor(dashboard.remaining_seconds%60).toString().padStart(2,"0")}</strong></span></div>
    <div ref={container} className="professional-chart" />
  </div>;
}
