"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrokerSymbol, ChartCandle, DashboardSnapshot, LiveEvent, StrategyConfig } from "./types";

export type EngineNotice = { id: number; title: string; message: string };

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
  const [errorNotice, setErrorNotice] = useState<EngineNotice | null>(null);

  const showError = useCallback((title: string, message: string) => {
    setErrorNotice({ id: Date.now(), title, message });
  }, []);

  useEffect(() => {
    let disposed = false;
    const connect = () => {
      const ws = new WebSocket("ws://127.0.0.1:8765/live");
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setErrorNotice((current) => current?.title === "Connection lost" ? null : current);
      };
      ws.onmessage = ({ data }) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(data) as LiveEvent;
        } catch {
          showError("Invalid engine response", "Trading engine sent unreadable data. Check engine logs.");
          return;
        }
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
          const value = event.payload as unknown as { items: BrokerSymbol[]; error?: string };
          setSymbols(value.items);
          if (value.error) showError("Symbol search failed", value.error);
        } else if (event.type === "dashboard_snapshot") {
          setDashboard(event.payload as unknown as DashboardSnapshot);
        } else if (event.type === "chart_history") {
          setChartHistory(event.payload as unknown as { timeframe: string; candles: ChartCandle[] });
        } else if (["engine_error", "chart_error", "order_rejected", "position_close_rejected"].includes(event.type)) {
          const message = typeof event.payload.message === "string" ? event.payload.message : "An unknown trading engine error occurred.";
          const titles: Record<string, string> = {
            engine_error: "Trading engine error",
            chart_error: "Chart loading failed",
            order_rejected: "Order rejected",
            position_close_rejected: "Position close failed",
          };
          showError(titles[event.type], message);
          setEvents((current) => [event, ...current].slice(0, 100));
        } else {
          setEvents((current) => [event, ...current].slice(0, 100));
        }
      };
      ws.onerror = () => showError("Connection error", "Could not communicate with the local trading engine.");
      ws.onclose = () => {
        setConnected(false);
        showError("Connection lost", "Trading engine connection closed. Reconnecting automatically…");
        if (!disposed) reconnect.current = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnect.current) clearTimeout(reconnect.current);
      socket.current?.close();
    };
  }, [showError]);

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

  return { connected, config, setConfig, events, market, engineRunning, dashboard, chartHistory, requestChart, symbols, searchSymbols, closePosition, saveStatus, save, errorNotice, dismissError: () => setErrorNotice(null) };
}
