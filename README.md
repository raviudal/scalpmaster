# ⚡ FYERS ScalpMaster - Scalping Practice Chrome Extension

A dedicated Chrome Extension tailored for the **FYERS Trading Terminal** ([trade.fyers.in](https://trade.fyers.in/)). It injects an interactive, draggable scalping HUD directly over your trading screen, providing 1-click execution, live unrealized & realized P&L tracking, completed trade logs, and daily performance metrics.

---

## 🚀 Key Features

* **Real-time Live P&L Display**:
  - Live unrealized P&L calculated every 300ms from active positions and current market price.
  - Overall **Day Net P&L** (sum of completed scalps + current open position).
  - Dynamic color coding (green glow on profit, red glow on loss).
* **1-Click Scalping Controls**:
  - **BUY / LONG** and **SELL / SHORT** buttons with quick quantity selectors (25, 50, 75, 100 or custom qty).
  - **SQUARE OFF**: Instantly exits open position at the current LTP.
  - **REVERSE**: Closes the current position and instantly flips the trade to the opposite side.
* **Practice vs. Live Mode**:
  - **Practice Mode (Default)**: Practice scalping with virtual execution against real live FYERS market prices. Zero financial risk while honing your speed, discipline, and setups.
  - **Live DOM Mode**: Directly triggers FYERS Web terminal order buttons on the screen.
* **Trade History & Day Journal**:
  - Automatically records every scalp taken (Symbol, Side, Quantity, Entry Price, Exit Price, Points, PnL, Time).
  - Calculates **Win Rate %**, **Total Trades**, and **Win/Loss ratio**.
* **Instant Hotkeys**:
  - `Shift + B`: Quick Buy / Long
  - `Shift + S`: Quick Sell / Short
  - `Shift + X`: Instant Square Off
  - `R`: Instant Position Reverse
* **Audio Feedback**:
  - Built-in sound effects (synthesized audio chimes for entries, winning trades, and losing exits).
* **Draggable & Minimizable HUD**:
  - Drag the overlay to any corner of your multi-monitor or widescreen layout.
  - Minimize button collapses the HUD into a compact view so it won't block chart analysis.

---

## 📦 How to Install in Google Chrome

1. Open **Google Chrome** and go to `chrome://extensions/` in the address bar.
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select the project folder:
   ```
   C:\Users\ravi\Documents\antigravity\resilient-hertz
   ```
5. The extension **"FYERS ScalpMaster - Practice & Scalping HUD"** will now appear in your extensions list.

---

## 🎯 How to Use

1. Log into your FYERS account at [trade.fyers.in](https://trade.fyers.in/).
2. You will see the **⚡ ScalpMaster HUD** appear on the top-right of your screen.
3. Select your quantity (or click 25, 50, etc.).
4. Click **BUY** or **SELL** (or use `Shift + B` / `Shift + S`).
5. Watch your position tick live with the market price.
6. Click **SQUARE OFF** (`Shift + X`) to bank your profit or cut your loss.
7. Switch to the **Trade Log** tab inside the HUD to inspect your completed trades and day statistics!
