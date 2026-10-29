# ⚡ ScalpMaster

> **A high-speed scalping HUD & paper trading Chrome Extension (Manifest V3) for Web Trading Terminals.**

[![Portfolio](https://img.shields.io/badge/Developer-Portfolio-blue?style=flat&logo=globe)](https://raviudal.github.io/portfolio_site/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/)

![ScalpMaster](icons/icon128.png)

---

## 📌 Project Overview

**ScalpMaster** is a lightweight, high-performance browser extension tailored for intraday traders and scalpers using web trading terminals. It overlays an interactive heads-up display (HUD) directly on your TradingView chart canvas, enabling single-click paper scalping, automated instrument and lot detection, full-width draggable stop-loss order lines, real-time brokerage and statutory charge calculations, and daily equity curve analytics.

This project was built to help traders practice execution discipline, test intraday scalping strategies, and analyze net profitability after all exchange and regulatory charges without putting real capital at risk.

---

## 🚀 Key Features

### 1. 🎯 Auto-Detection & Real-Time Sync
- **Active Instrument Detection**: Dynamically detects the active symbol directly from the TradingView chart without manual configuration.
- **Sub-Second LTP Tracking**: Captures real-time price ticks for live unrealized & realized P&L calculations.
- **Smart Lot Sizing**: Automatically recognizes Options, Futures, and Equities and sets matching exchange lot sizes (e.g., 65 for Nifty, 15 for BankNifty) with `[+]` and `[-]` stepper controls.

### 2. ⚡ 1-Click Scalping Execution
- **BUY / SELL Controls**: Instant practice order execution at market price with configurable lot sizes.
- **Position Reduction / Partial Exit**: Clicking the opposing action reduces your open quantity by the chosen lot size instead of reversing your trade.
- **Single Instrument Lock**: Locks execution to the active symbol until squared off, preventing accidental multi-instrument exposure.
- **Every-Trade Counter**: Accurately counts every execution event (Entry = 1 trade, Exit = 2 trades).

### 3. 🛑 Interactive Draggable Chart Stop-Loss
- **TradingView Native Order Line**: Generates a red dashed full-width stop-loss line (`chart.createOrderLine()`) directly across the chart.
- **Chart Drag & Drop**: Drag the SL line up or down on the chart; prices synchronize instantly with the HUD.
- **Automated Execution Engine**: Evaluates price ticks every 100ms and triggers an automatic market exit the moment price breaches your stop level.
- **Visual Chart Markers**: Places clear execution pins (`BUY`, `SELL`, `EXIT`, `SL HIT`) on the chart candles via `chart.createExecutionShape()`.

### 4. 💰 Real Brokerage & Statutory Charges Calculator
Calculates true transaction costs according to standard Indian broker schedules:
- **Brokerage**: Flat ₹20 per executed order (₹40 round-trip for Options).
- **STT/CTT**: 0.1% on options sell side / equity delivery.
- **Exchange Turnover**: NSE/BSE turnover fees.
- **GST**: 18% on (Brokerage + Turnover charges + SEBI charges).
- **Stamp Duty**: Statutory state stamp duties.
- Displays both **Gross P&L** and **Net Realized P&L** (after all statutory deductions).

### 5. 📊 Extension Popup Analytics
- **HUD Show / Hide Toggle**: One-click button (`👁️ Hide Order Window` / `🙈 Show Order Window`) to quickly declutter your chart.
- **15-Day Net Equity Curve**: Visual canvas graph illustrating historical net P&L progression.
- **Trade Log CSV Export**: One-click download of all completed scalps (filtered by Last 30 Days, Last 120 Days, or All Time).

---

## 📦 Installation Guide

1. Clone this repository to your local system:
   ```bash
   git clone https://github.com/raviudal/fyers-scalpmaster.git
   ```
2. Open **Google Chrome** and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the cloned repository directory.
6. The extension is now active and ready to use!

---

## 🖥️ How to Use

1. Navigate and log into your web trading terminal ([trade.fyers.in](https://trade.fyers.in/)).
2. Open any chart (Index, Stocks, Options, or Futures).
3. The **ScalpMaster HUD** will mount in the top-right area of the chart with your active instrument and live LTP.
4. Select your lots using `[+]` / `[-]`.
5. Click **BUY** or **SELL** to enter a practice scalp.
6. Click any quick SL button (e.g., `5 pts`, `10 pts`) to place an interactive draggable stop-loss line on your chart.
7. Click the extension toolbar icon at any time to inspect your **Equity Curve**, export your **Trade Log (CSV)**, or toggle HUD visibility.

---

## 🤝 Support the Project (Referral Link)

If you find this project helpful and want to open a new Demat / Trading account, you can use the referral link below:

👉 **[Open a Trading Account using my Referral Link](https://raviudal.github.io/portfolio_site/)** *(Replace with your direct broker referral link)*

> *Affiliate Disclosure: If you sign up using this referral link, the developer may receive a small referral incentive from the broker at zero extra cost to you. This helps support free, open-source software development.*

---

## ⚠️ Disclaimers & Terms of Use

> [!CAUTION]
> **PLEASE READ THE FOLLOWING DISCLAIMER CAREFULLY BEFORE USING THIS SOFTWARE.**

1. **Hobby & Educational Project**:
   - This software is an independent, open-source **hobby project** created solely for educational, research, and strategy practice purposes. Anyone is free to use, modify, or study it.
   - This project is **not** affiliated with, endorsed by, or officially associated with any broker, exchange, or TradingView in any manner.

2. **No Financial or Investment Advice**:
   - The creator and contributors of this project are **not** SEBI-registered advisors, brokers, or financial analysts. Nothing in this software, its source code, or documentation constitutes financial, investment, or trading advice.

3. **Use Strictly at Your Own Risk**:
   - **The developer / author will NOT be held responsible or liable under any circumstances for any financial loss, loss of profits, trading loss, operational errors, software bugs, execution delays, browser crashes, API changes, or damages of any kind resulting from the use of this software.**
   - Stock, options, and futures trading carry substantial risk of capital loss. You are solely and strictly responsible for all your trading decisions, actions, and consequences.

4. **User Responsibility**:
   - Any individual using this extension assumes 100% full responsibility and liability for their actions, configurations, and outcomes. If you do not agree to these terms, do not install or use this software.

---

## 👨‍💻 Developer & Portfolio

Developed with passion by **Ravi Udal**.

- 🌐 **Portfolio Website**: [https://raviudal.github.io/portfolio_site/](https://raviudal.github.io/portfolio_site/)
- 💻 **GitHub**: [@raviudal](https://github.com/raviudal)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
