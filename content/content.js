/**
 * FYERS ScalpMaster - Practice & Live Scalping HUD
 * Injected into trade.fyers.in
 */

(function () {
  if (window.__fyers_scalpmaster_injected) return;
  window.__fyers_scalpmaster_injected = true;

  // Configuration & Persistent State
  const STATE_KEY = 'fsm_state_v1';
  let state = {
    mode: 'PRACTICE', // 'PRACTICE' or 'LIVE_DOM'
    activeTab: 'position', // 'position' or 'history'
    qty: 25,
    symbol: 'NIFTY 50',
    ltp: 24500.00,
    isManualTicker: false,
    activePosition: null, // { symbol, side: 'BUY'|'SELL', qty: 25, entryPrice: 24500.00, time: '' }
    completedTrades: [],
    dayStats: {
      totalPnL: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      peakPnL: 0,
      maxDrawdown: 0
    },
    hudPosition: { top: 70, right: 25 },
    minimized: false,
    soundEnabled: true
  };

  // Web Audio Synthesizer for Scalping Chimes
  const audioCtx = window.AudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playSound(type) {
    if (!state.soundEnabled || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;

      if (type === 'BUY') {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'SELL') {
        osc.frequency.setValueAtTime(880, now); // A5
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.12); // D5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'WIN') {
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'LOSS') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(349.23, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      console.warn('[ScalpMaster] Audio error:', e);
    }
  }

  // Load Saved State
  function loadState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STATE_KEY], (res) => {
        if (res && res[STATE_KEY]) {
          state = { ...state, ...res[STATE_KEY] };
          renderHUD();
        }
      });
    }
  }

  // Save State
  function saveState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STATE_KEY]: state });
    }
  }

  // Show floating toast
  function showToast(msg) {
    const toast = document.getElementById('fsm-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // Intelligent Price & Symbol Scraper from FYERS Web DOM
  function scrapeFyersMarketData() {
    // 1. Try to find symbol from header or chart title
    const symbolSelectors = [
      '.header-script-details .symbol-name',
      '.symbol-title',
      '[class*="symbolName"]',
      '[class*="tickerText"]',
      '.header-title',
      '.symbol-header',
      'div[class*="header"] [class*="symbol"]'
    ];
    for (const sel of symbolSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 1) {
        state.symbol = el.innerText.trim();
        break;
      }
    }

    // 2. Try to find LTP (Last Traded Price) from FYERS DOM
    const ltpSelectors = [
      '.header-script-details [class*="ltp"]',
      '[class*="header-ltp"]',
      '[class*="current-price"]',
      '[class*="lastPrice"]',
      '.symbol-ltp',
      '[data-field="ltp"]',
      '.header-price'
    ];
    let detectedLtp = null;
    for (const sel of ltpSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText) {
        const raw = el.innerText.replace(/,/g, '').trim();
        const match = raw.match(/([0-9]+\.[0-9]{2})/);
        if (match) {
          const val = parseFloat(match[1]);
          if (!isNaN(val) && val > 0) {
            detectedLtp = val;
            break;
          }
        }
      }
    }

    // If FYERS live market price is detected, update state.ltp
    if (detectedLtp !== null) {
      state.ltp = detectedLtp;
      state.isManualTicker = false;
    } else if (!state.isManualTicker && (!state.ltp || state.ltp === 24500)) {
      // Off-market simulation / initial default price
      state.ltp = 24500.00;
    }

    updatePnLDisplay();
  }

  // Calculate Unrealized PnL
  function calculateCurrentPnL() {
    if (!state.activePosition) return { pnl: 0, points: 0 };
    const currentPrice = state.ltp;
    const entryPrice = state.activePosition.entryPrice;
    const qty = state.activePosition.qty;

    let points = 0;
    if (state.activePosition.side === 'BUY') {
      points = currentPrice - entryPrice;
    } else {
      points = entryPrice - currentPrice;
    }
    const pnl = points * qty;
    return { pnl, points };
  }

  // Execute Order
  function executeOrder(side) {
    const qty = parseInt(state.qty, 10) || 25;
    const price = state.ltp;
    const nowStr = new Date().toLocaleTimeString();

    // If in Live FYERS DOM mode, trigger FYERS DOM buttons
    if (state.mode === 'LIVE_DOM') {
      triggerFyersDOMOrder(side, qty);
    }

    // Practice / Scalp Tracking logic
    if (state.activePosition) {
      if (state.activePosition.side === side) {
        // Adding to existing position
        const totalQty = state.activePosition.qty + qty;
        const avgPrice = ((state.activePosition.entryPrice * state.activePosition.qty) + (price * qty)) / totalQty;
        state.activePosition.qty = totalQty;
        state.activePosition.entryPrice = parseFloat(avgPrice.toFixed(2));
        showToast(`Added ${qty} to ${side} @ ₹${price.toFixed(2)}`);
      } else {
        // Reverse or partial close
        closeActivePosition();
        // Now open new opposite
        state.activePosition = {
          symbol: state.symbol,
          side: side,
          qty: qty,
          entryPrice: price,
          time: nowStr
        };
        showToast(`Reversed to ${side} ${qty} @ ₹${price.toFixed(2)}`);
        playSound(side);
      }
    } else {
      // New Position
      state.activePosition = {
        symbol: state.symbol,
        side: side,
        qty: qty,
        entryPrice: price,
        time: nowStr
      };
      showToast(`${side} ${qty} ${state.symbol} @ ₹${price.toFixed(2)}`);
      playSound(side);
    }

    saveState();
    renderHUD();
  }

  // Close Active Position (Exit / Square Off)
  function closeActivePosition() {
    if (!state.activePosition) return;

    const exitPrice = state.ltp;
    const { pnl, points } = calculateCurrentPnL();
    const nowStr = new Date().toLocaleTimeString();

    const trade = {
      id: Date.now(),
      symbol: state.activePosition.symbol,
      side: state.activePosition.side,
      qty: state.activePosition.qty,
      entryPrice: state.activePosition.entryPrice,
      exitPrice: exitPrice,
      entryTime: state.activePosition.time,
      exitTime: nowStr,
      points: parseFloat(points.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2)),
      isWin: pnl > 0
    };

    // Update Day Stats
    state.completedTrades.unshift(trade);
    state.dayStats.totalTrades += 1;
    state.dayStats.totalPnL = parseFloat((state.dayStats.totalPnL + pnl).toFixed(2));

    if (pnl > 0) {
      state.dayStats.wins += 1;
      playSound('WIN');
    } else if (pnl < 0) {
      state.dayStats.losses += 1;
      playSound('LOSS');
    }

    state.dayStats.winRate = Math.round((state.dayStats.wins / state.dayStats.totalTrades) * 100);

    if (state.dayStats.totalPnL > state.dayStats.peakPnL) {
      state.dayStats.peakPnL = state.dayStats.totalPnL;
    }
    const currentDrawdown = state.dayStats.peakPnL - state.dayStats.totalPnL;
    if (currentDrawdown > state.dayStats.maxDrawdown) {
      state.dayStats.maxDrawdown = currentDrawdown;
    }

    showToast(`Closed ${trade.side}: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`);
    state.activePosition = null;

    saveState();
    renderHUD();
  }

  // Reverse Position
  function reversePosition() {
    if (!state.activePosition) return;
    const oppositeSide = state.activePosition.side === 'BUY' ? 'SELL' : 'BUY';
    const currentQty = state.activePosition.qty;
    closeActivePosition();
    state.qty = currentQty;
    executeOrder(oppositeSide);
  }

  // DOM Automation for FYERS Web Order Placement
  function triggerFyersDOMOrder(side, qty) {
    try {
      // Find TradingView / FYERS Buy or Sell buttons on page
      const buySelectors = [
        'button[data-name="buy"]',
        '.buy-btn',
        'button.btn-buy',
        '[class*="buy-button"]'
      ];
      const sellSelectors = [
        'button[data-name="sell"]',
        '.sell-btn',
        'button.btn-sell',
        '[class*="sell-button"]'
      ];

      const targetSelectors = side === 'BUY' ? buySelectors : sellSelectors;
      let clicked = false;
      for (const sel of targetSelectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          clicked = true;
          break;
        }
      }
      if (clicked) {
        showToast(`[DOM Trigger] Clicked FYERS ${side} Button`);
      } else {
        showToast(`[DOM Trigger] Buy/Sell button not found in current view`);
      }
    } catch (e) {
      console.error('[ScalpMaster] DOM Trigger Error:', e);
    }
  }

  // Reset Today's Journal & Stats
  function resetDayStats() {
    if (confirm("Reset today's practice P&L, completed trades, and statistics?")) {
      state.activePosition = null;
      state.completedTrades = [];
      state.dayStats = {
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        peakPnL: 0,
        maxDrawdown: 0
      };
      saveState();
      renderHUD();
      showToast('Daily stats reset successfully');
    }
  }

  // Update Dynamic PnL Values without full DOM rerender (smooth 60fps)
  function updatePnLDisplay() {
    const ltpEl = document.getElementById('fsm-ltp-val');
    if (ltpEl) {
      ltpEl.textContent = '₹' + state.ltp.toFixed(2);
    }

    const { pnl, points } = calculateCurrentPnL();
    const totalDayPnL = state.dayStats.totalPnL + pnl;

    // Day PnL Element
    const dayPnlEl = document.getElementById('fsm-day-pnl-val');
    if (dayPnlEl) {
      const sign = totalDayPnL >= 0 ? '+' : '';
      dayPnlEl.textContent = `${sign}₹${totalDayPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      dayPnlEl.className = 'fsm-day-pnl-value ' + (totalDayPnL > 0 ? 'fsm-pnl-positive' : totalDayPnL < 0 ? 'fsm-pnl-negative' : '');
    }

    // Active Position Live PnL
    const activePnlEl = document.getElementById('fsm-active-pnl-val');
    if (activePnlEl && state.activePosition) {
      const sign = pnl >= 0 ? '+' : '';
      activePnlEl.textContent = `${sign}₹${pnl.toFixed(2)} (${points >= 0 ? '+' : ''}${points.toFixed(2)} pts)`;
      activePnlEl.className = 'fsm-position-pnl ' + (pnl > 0 ? 'fsm-pnl-positive' : pnl < 0 ? 'fsm-pnl-negative' : '');
    }
  }

  // Build & Render the Floating HUD DOM
  function renderHUD() {
    let container = document.getElementById('fyers-scalpmaster-hud');
    if (!container) {
      container = document.createElement('div');
      container.id = 'fyers-scalpmaster-hud';
      document.body.appendChild(container);
      setupDrag(container);
    }

    if (state.minimized) {
      container.classList.add('fsm-minimized');
    } else {
      container.classList.remove('fsm-minimized');
    }

    const { pnl } = calculateCurrentPnL();
    const totalDayPnL = state.dayStats.totalPnL + pnl;
    const daySign = totalDayPnL >= 0 ? '+' : '';

    container.innerHTML = `
      <div class="fsm-header" id="fsm-drag-handle">
        <div class="fsm-title">
          <span>⚡ ScalpMaster</span>
          <span class="fsm-badge ${state.mode === 'PRACTICE' ? 'fsm-badge-practice' : 'fsm-badge-live'}" id="fsm-toggle-mode" title="Click to switch Practice / Live Mode">
            ${state.mode === 'PRACTICE' ? 'PRACTICE' : 'LIVE DOM'}
          </span>
        </div>
        <div class="fsm-controls">
          <button class="fsm-icon-btn" id="fsm-sound-btn" title="Toggle Audio">${state.soundEnabled ? '🔔' : '🔕'}</button>
          <button class="fsm-icon-btn" id="fsm-min-btn" title="Minimize / Expand">${state.minimized ? '🗖' : '🗕'}</button>
        </div>
      </div>

      <div class="fsm-body">
        <!-- Live Ticker Bar -->
        <div class="fsm-quote-strip">
          <div class="fsm-symbol-name" title="${state.symbol}">${state.symbol}</div>
          <div class="fsm-ltp-box">
            <span class="fsm-ltp-val" id="fsm-ltp-val">₹${state.ltp.toFixed(2)}</span>
          </div>
        </div>

        <!-- Overall Day PnL Summary -->
        <div class="fsm-day-pnl-card">
          <div class="fsm-day-pnl-label">Day Net P&amp;L (Live + Realized)</div>
          <div class="fsm-day-pnl-value ${totalDayPnL > 0 ? 'fsm-pnl-positive' : totalDayPnL < 0 ? 'fsm-pnl-negative' : ''}" id="fsm-day-pnl-val">
            ${daySign}₹${totalDayPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div class="fsm-stats-grid">
            <div class="fsm-stat-item">
              <span class="fsm-stat-label">TRADES</span>
              <span class="fsm-stat-val">${state.dayStats.totalTrades}</span>
            </div>
            <div class="fsm-stat-item">
              <span class="fsm-stat-label">WIN RATE</span>
              <span class="fsm-stat-val" style="color: ${state.dayStats.winRate >= 50 ? '#34d399' : '#f87171'}">${state.dayStats.winRate}%</span>
            </div>
            <div class="fsm-stat-item">
              <span class="fsm-stat-label">W / L</span>
              <span class="fsm-stat-val">${state.dayStats.wins}W / ${state.dayStats.losses}L</span>
            </div>
          </div>
        </div>

        <!-- Scalping Execution Controls -->
        <div class="fsm-order-section">
          <div class="fsm-qty-bar">
            <span style="font-size: 11px; color: var(--fsm-text-muted); font-weight: 600;">QTY:</span>
            <input type="number" id="fsm-qty-input" class="fsm-qty-input" value="${state.qty}" min="1" step="1">
            <button class="fsm-qty-btn" data-qty="25">25</button>
            <button class="fsm-qty-btn" data-qty="50">50</button>
            <button class="fsm-qty-btn" data-qty="75">75</button>
            <button class="fsm-qty-btn" data-qty="100">100</button>
          </div>

          <div class="fsm-trade-btns">
            <button class="fsm-btn fsm-btn-buy" id="fsm-buy-btn">
              <span>BUY / LONG</span>
              <span class="fsm-btn-sub">[Shift + B]</span>
            </button>
            <button class="fsm-btn fsm-btn-sell" id="fsm-btn-sell">
              <span>SELL / SHORT</span>
              <span class="fsm-btn-sub">[Shift + S]</span>
            </button>
          </div>

          <div class="fsm-action-strip">
            <button class="fsm-btn-exit" id="fsm-exit-btn" ${!state.activePosition ? 'disabled' : ''}>
              SQUARE OFF [Shift + X]
            </button>
            <button class="fsm-btn-reverse" id="fsm-reverse-btn" ${!state.activePosition ? 'disabled' : ''}>
              REVERSE [R]
            </button>
          </div>
        </div>

        <!-- Navigation Tabs: Position vs Trade History -->
        <div class="fsm-tab-nav">
          <div class="fsm-tab ${state.activeTab === 'position' ? 'active' : ''}" id="fsm-tab-pos">Active Position</div>
          <div class="fsm-tab ${state.activeTab === 'history' ? 'active' : ''}" id="fsm-tab-hist">Trade Log (${state.completedTrades.length})</div>
        </div>

        <!-- Active Position Card -->
        <div id="fsm-tab-content-pos" style="display: ${state.activeTab === 'position' ? 'block' : 'none'};">
          ${state.activePosition ? `
            <div class="fsm-position-card">
              <div class="fsm-position-header">
                <span class="fsm-pos-type ${state.activePosition.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">
                  ${state.activePosition.side} ${state.activePosition.qty} Qty
                </span>
                <span style="color: var(--fsm-text-muted);">${state.activePosition.time}</span>
              </div>
              <div class="fsm-position-pnl" id="fsm-active-pnl-val">
                --
              </div>
              <div class="fsm-pos-details">
                <span>Avg: ₹${state.activePosition.entryPrice.toFixed(2)}</span>
                <span>LTP: ₹${state.ltp.toFixed(2)}</span>
              </div>
            </div>
          ` : `
            <div class="fsm-no-pos">No open position. Hit BUY or SELL to scalp!</div>
          `}
        </div>

        <!-- Completed Orders / History -->
        <div id="fsm-tab-content-hist" style="display: ${state.activeTab === 'history' ? 'block' : 'none'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; color: var(--fsm-text-muted);">Completed Scalps Today</span>
            <button id="fsm-reset-btn" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 11px; text-decoration: underline;">Reset Day</button>
          </div>
          <div class="fsm-orders-list">
            ${state.completedTrades.length === 0 ? `
              <div style="text-align: center; color: var(--fsm-text-muted); padding: 12px; font-size: 11px;">No completed scalps today yet.</div>
            ` : state.completedTrades.map(t => `
              <div class="fsm-order-row">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="fsm-order-side ${t.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">${t.side}</span>
                  <span>${t.qty} @ ₹${t.entryPrice.toFixed(1)}</span>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 700; color: ${t.pnl >= 0 ? '#34d399' : '#f87171'};">
                    ${t.pnl >= 0 ? '+' : ''}₹${t.pnl.toFixed(2)}
                  </div>
                  <div style="font-size: 9px; color: var(--fsm-text-muted);">${t.points >= 0 ? '+' : ''}${t.points} pts (${t.exitTime})</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="fsm-toast" id="fsm-toast"></div>
    `;

    bindEvents(container);
    updatePnLDisplay();
  }

  // Bind HUD DOM Events
  function bindEvents(container) {
    // Mode Switch
    const modeBtn = container.querySelector('#fsm-toggle-mode');
    if (modeBtn) {
      modeBtn.onclick = () => {
        state.mode = state.mode === 'PRACTICE' ? 'LIVE_DOM' : 'PRACTICE';
        showToast(`Switched to ${state.mode === 'PRACTICE' ? 'Practice (Simulated)' : 'Live DOM Execution'} Mode`);
        saveState();
        renderHUD();
      };
    }

    // Sound toggle
    const soundBtn = container.querySelector('#fsm-sound-btn');
    if (soundBtn) {
      soundBtn.onclick = () => {
        state.soundEnabled = !state.soundEnabled;
        showToast(state.soundEnabled ? 'Audio Chimes Enabled' : 'Audio Chimes Muted');
        saveState();
        renderHUD();
      };
    }

    // Minimize toggle
    const minBtn = container.querySelector('#fsm-min-btn');
    if (minBtn) {
      minBtn.onclick = () => {
        state.minimized = !state.minimized;
        saveState();
        renderHUD();
      };
    }

    // Tabs
    const tabPos = container.querySelector('#fsm-tab-pos');
    const tabHist = container.querySelector('#fsm-tab-hist');
    if (tabPos && tabHist) {
      tabPos.onclick = () => {
        state.activeTab = 'position';
        renderHUD();
      };
      tabHist.onclick = () => {
        state.activeTab = 'history';
        renderHUD();
      };
    }

    // Qty input & buttons
    const qtyInput = container.querySelector('#fsm-qty-input');
    if (qtyInput) {
      qtyInput.onchange = (e) => {
        const val = parseInt(e.target.value, 10);
        if (val > 0) {
          state.qty = val;
          saveState();
        }
      };
    }
    container.querySelectorAll('.fsm-qty-btn').forEach(btn => {
      btn.onclick = () => {
        const q = parseInt(btn.dataset.qty, 10);
        state.qty = q;
        if (qtyInput) qtyInput.value = q;
        saveState();
      };
    });

    // Trade action buttons
    const buyBtn = container.querySelector('#fsm-buy-btn');
    if (buyBtn) buyBtn.onclick = () => executeOrder('BUY');

    const sellBtn = container.querySelector('#fsm-btn-sell');
    if (sellBtn) sellBtn.onclick = () => executeOrder('SELL');

    const exitBtn = container.querySelector('#fsm-exit-btn');
    if (exitBtn) exitBtn.onclick = () => closeActivePosition();

    const reverseBtn = container.querySelector('#fsm-reverse-btn');
    if (reverseBtn) reverseBtn.onclick = () => reversePosition();

    // Reset Day button
    const resetBtn = container.querySelector('#fsm-reset-btn');
    if (resetBtn) resetBtn.onclick = () => resetDayStats();
  }

  // Draggable HUD functionality
  function setupDrag(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const handle = element.querySelector('#fsm-drag-handle') || element;

    element.onmousedown = (e) => {
      if (e.target.closest('#fsm-drag-handle')) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
      }
    };

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      const newTop = element.offsetTop - pos2;
      const newLeft = element.offsetLeft - pos1;
      element.style.top = newTop + "px";
      element.style.left = newLeft + "px";
      element.style.right = "auto";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // Keyboard Shortcuts for Instant Scalping
  window.addEventListener('keydown', (e) => {
    // Avoid triggering shortcuts if user is typing in an input or textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      executeOrder('BUY');
    } else if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      executeOrder('SELL');
    } else if (e.shiftKey && (e.key === 'X' || e.key === 'x')) {
      e.preventDefault();
      closeActivePosition();
    } else if (e.key === 'R' || e.key === 'r') {
      if (state.activePosition) {
        e.preventDefault();
        reversePosition();
      }
    }
  });

  // Practice Off-market Price Tick Simulator (Subtle live ticks when market is closed)
  setInterval(() => {
    if (state.isManualTicker) {
      // Small simulated tick movement (-0.25 to +0.25 points)
      const delta = (Math.random() - 0.49) * 0.5;
      state.ltp = parseFloat((state.ltp + delta).toFixed(2));
      updatePnLDisplay();
    }
  }, 400);

  // Periodic DOM Market Data Scraping & PnL Refresh (every 300ms)
  setInterval(() => {
    scrapeFyersMarketData();
  }, 300);

  // Initialize
  loadState();
  renderHUD();
  console.log('[ScalpMaster] Injected successfully into FYERS Terminal.');
})();
