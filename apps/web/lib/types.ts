export type DistanceMode = "points" | "percent" | "reference_candle";

export type Leg = {
  enabled: boolean;
  volume: number;
  stop_loss: { mode: DistanceMode; value: number };
  take_profit: { mode: Exclude<DistanceMode, "reference_candle">; value: number };
};

export type StrategyConfig = {
  enabled: boolean;
  symbol: string;
  timeframe: string;
  direction: "buy" | "sell";
  deviation_points: number;
  magic_number: number;
  poll_interval_ms: number;
  closed_leg_behavior: "same_leg" | "next_leg";
  stop_after_entry: boolean;
  legs: Leg[];
};

export type LiveEvent = { type: string; payload: Record<string, unknown> };
export type BrokerSymbol = { name: string; description: string; currency: string };
export type DashboardSnapshot = {
  account: { balance: number; equity: number; free_margin: number; currency: string };
  pnl: number;
  active_legs: number;
  next_leg: number;
  signal_status: "waiting" | "signal_found" | "order_filled" | "order_rejected" | "max_legs" | "trade_active";
  reference: { high: number; low: number; close: number } | null;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  remaining_seconds: number;
  condition_met: boolean;
  positions: Array<{ ticket: number; leg: number; side: "buy" | "sell"; volume: number; entry: number; current: number; sl: number; tp: number; profit: number; time: number; comment: string; signal: null | { reference: CandleDetail; confirmation: CandleDetail; signal_time_msc: number } }>;
};
export type CandleDetail = { time: string; open: number; high: number; low: number; close: number };
export type ChartCandle = { time: number; open: number; high: number; low: number; close: number };
