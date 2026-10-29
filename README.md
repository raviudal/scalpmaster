# ⚡ FYERS ScalpMaster

> **A high-speed scalping HUD & paper trading Chrome Extension (Manifest V3) for the [FYERS Web Trading Terminal](https://trade.fyers.in/).**

![FYERS ScalpMaster](icons/icon128.png)

---

## 🚀 Key Features

### 1. 🎯 Auto-Detection & Live Price Sync
- **Active Instrument Detection**: Automatically tracks the active symbol from the TradingView chart without manual selection.
- **Real-Time LTP**: Syncs with live market ticks for sub-second P&L updates.
- **Smart Lot Size**: Auto-detects instrument type (Options, Futures, Equity) and sets correct lot sizes (e.g., 65 for Nifty, 15 for BankNifty) with `[+]` and `[-]` stepper controls.

### 2. ⚡ High-Speed 1-Click Scalping Execution
- **BUY / SELL Buttons**: Instant entry at the current market price with custom lot multipliers.
- **Position Reduction / Partial Exit**: Clicking the opposing button reduces the open position by the selected lot size rather than flipping/reversing.
- **Instrument Lock**: Automatically locks execution to the active trade's instrument until squared off to prevent accidental cross-trading.
- **Every-Trade Counter**: Counts every individual trade execution (Buy = 1 trade, Sell/Exit = 2 trades).

### 3. 🛑 Interactive Draggable Chart Stop-Loss
- **TradingView Native Order Line**: Red dashed full-width stop-loss line (`chart.createOrderLine()`) rendered directly across the chart.
- **Chart Dragging**: Click and drag the stop-loss line up or down; price updates automatically in the HUD.
- **Automated SL Execution**: Real-time monitoring triggers an automatic market exit the instant price reaches or breaches your stop-loss level.
- **Chart Execution Markers**: Visual markers (`BUY`, `SELL`, `EXIT`, `SL HIT`) placed directly on candles using `chart.createExecutionShape()`.

### 4. 💰 Real FYERS Brokerage & Statutory Charges Calculator
- Computes actual transaction costs according to FYERS official fee structure:
  - **Flat Brokerage**: ₹20 per executed order (₹40 round trip for Options).
  - **STT/CTT**: 0.1% on options sell side / equity delivery.
  - **Exchange Turnover Charges**: NSE/BSE turnover fees.
  - **GST**: 18% on (Brokerage + Turnover + SEBI fees).
  - **Stamp Duty**: Statutory state stamp duties.
- Displays both **Gross P&L** and **Net Realized P&L** (after all charges) in real-time.

### 5. 📊 Extension Popup Analytics & Controls
- **Show / Hide HUD Toggle**: One-click toggle (`👁️ Hide Order Window` / `🙈 Show Order Window`) to keep the TradingView chart clean whenever needed.
- **15-Day Net Equity Curve**: Interactive visual chart plotting daily net P&L performance over time.
- **Trade Log CSV Export**: Export historical trades with complete entry/exit timestamps, quantities, prices, gross P&L, charges, and net P&L with 30-day (default), 120-day, or all-time filters.

---

## 📦 Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/<your-username>/fyers-scalpmaster.git
   ```
2. Open **Google Chrome** and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** (toggle switch in the top-right corner).
4. Click **Load unpacked** (top-left button).
5. Select the project folder:
   ```text
   C:\Users\ravi\Documents\antigravity\resilient-hertz
   ```
6. The extension **FYERS ScalpMaster** is now installed!

---

## 🖥️ Usage

1. Open and log in to [trade.fyers.in](https://trade.fyers.in/).
2. Open any chart (Index, Stocks, Options, or Futures).
3. The **ScalpMaster HUD** will appear over your chart with the active symbol and live market price.
4. Set your desired lot count using `[+]` / `[-]`.
5. Click **BUY** or **SELL** to enter a trade.
6. Click any quick SL button (e.g., `5 pts`, `10 pts`) to place a draggable Stop-Loss line directly on your TradingView chart.
7. Click the extension toolbar icon anytime to view your **15-Day Equity Curve**, export your **Trade Log (CSV)**, or toggle HUD visibility.

---

## 🛡️ License

MIT License. Designed for trading education, strategy backtesting, and scalping practice.
