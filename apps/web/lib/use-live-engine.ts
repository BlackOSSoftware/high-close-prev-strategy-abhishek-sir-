"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrokerSymbol, ChartCandle, DashboardSnapshot, LiveEvent, StrategyConfig } from "./types";

export function useLiveEngine() {
  const socket = useRef<WebSocket | null>(null);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [market, setMarket] = useState<{ bid: number; ask: number; trend: "buy" | "sell"; time_msc: number } | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [symbols, setSymbols] = useState<BrokerSymbol[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "updated">("idle");
  const [chartHistory, setChartHistory] = useState<{ timeframe: string; candles: ChartCandle[] } | null>(null);

  useEffect(() => {
    let disposed = false;
    const connect = () => {
      const ws = new WebSocket("ws://127.0.0.1:8765/live");
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = ({ data }) => {
        const event = JSON.parse(data) as LiveEvent;
        if (event.type === "snapshot") {
          const payload = event.payload as unknown as { config: StrategyConfig; events: LiveEvent[]; engine: { running: boolean }; market: { bid: number; ask: number; trend: "buy" | "sell"; time_msc: number } | null; dashboard: DashboardSnapshot | null };
          setConfig(payload.config);
          setEvents(payload.events);
          setEngineRunning(payload.engine.running);
          setMarket(payload.market);
          setDashboard(payload.dashboard);
        } else if (event.type === "command_accepted") {
          setSaveStatus("updated");
          setTimeout(() => setSaveStatus("idle"), 2500);
        } else if (event.type === "config_applied") {
          setConfig(event.payload as unknown as StrategyConfig);
        } else if (event.type === "market_tick") {
          const value = event.payload as unknown as { bid: number; ask: number; trend: "buy" | "sell"; time_msc: number };
          setMarket(value);
          setEngineRunning(true);
        } else if (event.type === "engine_status") {
          setEngineRunning(Boolean(event.payload.running));
        } else if (event.type === "symbol_results") {
          const value = event.payload as unknown as { items: BrokerSymbol[] };
          setSymbols(value.items);
        } else if (event.type === "dashboard_snapshot") {
          setDashboard(event.payload as unknown as DashboardSnapshot);
        } else if (event.type === "chart_history") {
          setChartHistory(event.payload as unknown as { timeframe: string; candles: ChartCandle[] });
        } else {
          setEvents((current) => [event, ...current].slice(0, 100));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) reconnect.current = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnect.current) clearTimeout(reconnect.current);
      socket.current?.close();
    };
  }, []);

  const save = useCallback((value: StrategyConfig) => {
    setSaveStatus("saving");
    socket.current?.send(JSON.stringify({ type: "update_config", payload: value }));
    setConfig(value);
  }, []);

  const searchSymbols = useCallback((query: string) => {
    socket.current?.send(JSON.stringify({ type: "search_symbols", payload: { query } }));
  }, []);

  const closePosition = useCallback((ticket: number) => {
    socket.current?.send(JSON.stringify({ type: "close_position", payload: { ticket } }));
  }, []);

  const requestChart = useCallback((timeframe: string) => {
    socket.current?.send(JSON.stringify({ type: "request_chart", payload: { timeframe } }));
  }, []);

  return { connected, config, setConfig, events, market, engineRunning, dashboard, chartHistory, requestChart, symbols, searchSymbols, closePosition, saveStatus, save };
}
