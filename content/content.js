/**
 * FYERS ScalpMaster - Practice & Scalping HUD
 * Injected into trade.fyers.in
 */

(function () {
  // Prevent duplicate instances
  if (window.__fyers_scalpmaster_initialized) {
    console.log('[ScalpMaster] Re-initializing existing instance...');
  }
  window.__fyers_scalpmaster_initialized = true;

  const STATE_KEY = 'fsm_state_v2';

  let state = {
    mode: 'PRACTICE', // 'PRACTICE' or 'LIVE_DOM'
    activeTab: 'position', // 'position' or 'history'
    symbol: 'WAITING FOR CHART...',
    symbolDesc: '',
    lotSize: 1,
    lots: 1,
    qty: 1,
    ltp: 0.00,
    prevLtp: 0.00,
    activePosition: null, // { symbol, side: 'BUY'|'SELL', qty: 25, entryPrice: 63.75, time: '' }
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
    minimized: false,
    soundEnabled: true
  };

  // Web Audio Synthesizer
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx && AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  function playSound(type) {
    if (!state.soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
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
          const saved = res[STATE_KEY];
          // Preserve dynamic symbol/LTP from DOM
          state.dayStats = saved.dayStats || state.dayStats;
          state.completedTrades = saved.completedTrades || [];
          state.activePosition = saved.activePosition || null;
          state.lots = saved.lots || 1;
          state.soundEnabled = saved.soundEnabled !== undefined ? saved.soundEnabled : true;
          state.minimized = !!saved.minimized;
          state.mode = saved.mode || 'PRACTICE';
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

  // Toast Notification
  function showToast(msg) {
    const toast = document.getElementById('fsm-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // Access TradingView Iframe Document
  function getTvIframeDocument() {
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      if (f.id && f.id.startsWith('tradingview')) {
        try {
          if (f.contentDocument && f.contentDocument.body) {
            return f.contentDocument;
          }
        } catch (e) {}
      }
    }
    return null;
  }

  // Query FYERS Local IndexedDB for Master Contract Details
  function querySymbolIndexedDB(symbolKey) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('symbol_data');
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('symbols')) {
            return resolve(null);
          }
          const tx = db.transaction('symbols', 'readonly');
          const store = tx.objectStore('symbols');

          const keysToTry = [
            symbolKey,
            'NSE:' + symbolKey,
            'BSE:' + symbolKey,
            'MCX:' + symbolKey
          ];

          function tryLookup(idx) {
            if (idx >= keysToTry.length) return resolve(null);
            const getReq = store.get(keysToTry[idx]);
            getReq.onsuccess = () => {
              if (getReq.result && getReq.result.lot_size) {
                resolve(getReq.result);
              } else {
                tryLookup(idx + 1);
              }
            };
            getReq.onerror = () => tryLookup(idx + 1);
          }
          tryLookup(0);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  // Fallback Heuristic for Indian Futures & Options Lot Sizes
  function inferLotSize(symbol) {
    const s = symbol.toUpperCase();
    if (s.includes('BANKNIFTY')) return 15;
    if (s.includes('FINNIFTY')) return 25;
    if (s.includes('MIDCPNIFTY')) return 50;
    if (s.includes('NIFTY') && (s.includes('PE') || s.includes('CE') || s.includes('FUT'))) return 65;
    if (s.includes('SENSEX')) return 10;
    if (s.includes('BANKEX')) return 15;
    if (s.includes('CRUDEOIL')) return 100;
    if (s.includes('NATURALGAS')) return 1250;
    return 1; // Default for equity/cash shares
  }

  // Update Instrument & Determine Lot Size
  let lastCheckedSymbol = '';
  async function handleSymbolUpdate(newSymbol) {
    if (!newSymbol || newSymbol === lastCheckedSymbol) return;
    lastCheckedSymbol = newSymbol;
    state.symbol = newSymbol;

    // 1. Fetch exact lot size and description from FYERS IndexedDB
    const dbRecord = await querySymbolIndexedDB(newSymbol);
    if (dbRecord && dbRecord.lot_size) {
      state.lotSize = dbRecord.lot_size;
      state.symbolDesc = dbRecord.description || dbRecord.short_name || '';
    } else {
      state.lotSize = inferLotSize(newSymbol);
      state.symbolDesc = newSymbol.includes('PE') ? 'Put Option' : newSymbol.includes('CE') ? 'Call Option' : 'Instrument';
    }

    // Adjust total quantity based on lots
    state.qty = state.lots * state.lotSize;

    // Update Symbol DOM elements
    const symEl = document.querySelector('.fsm-symbol-name');
    if (symEl) {
      symEl.textContent = state.symbol;
      symEl.title = state.symbol;
    }
    const descEl = document.querySelector('.fsm-symbol-desc');
    if (descEl) {
      descEl.textContent = state.symbolDesc;
    }
    updateLotDisplay();
  }

  // Real-Time Scraping: Document Title & TradingView Iframe
  function scrapeActiveMarketData() {
    let detectedPrice = null;
    let detectedSymbol = null;

    // Method 1: Check document.title (fastest, real-time ticks from FYERS Web)
    // Format: "63.75 ▼ (-51.70%) NIFTY26N0322600PE" or "24,510.50 ▲ (+0.45%) NIFTY50-INDEX"
    const title = document.title || '';
    const titleMatch = title.match(/^([\d,]+(?:\.\d+)?)\s*(?:[▲▼]\s*)?(?:\([+-]?[0-9.,]*%\)\s*)?([A-Za-z0-9_\-]+)/);
    if (titleMatch) {
      const p = parseFloat(titleMatch[1].replace(/,/g, ''));
      if (!isNaN(p) && p > 0) {
        detectedPrice = p;
        detectedSymbol = titleMatch[2].trim();
      }
    }

    // Method 2: Check TradingView Iframe
    const tvDoc = getTvIframeDocument();
    if (tvDoc) {
      const activeChart = tvDoc.querySelector('.chart-container.active') || tvDoc.querySelector('.chart-container');
      if (activeChart) {
        // Symbol from Chart
        if (!detectedSymbol) {
          const symBtn = activeChart.querySelector('.js-button-text') || activeChart.querySelector('button[class*="title-"]');
          if (symBtn && symBtn.innerText && symBtn.innerText.trim()) {
            detectedSymbol = symBtn.innerText.trim();
          }
        }
        // Price from Buy/Sell Buttons or Legend
        if (!detectedPrice) {
          const buyBtnPrice = activeChart.querySelector('[data-name="buy-order-button"] .buttonText-hw_3o_pb');
          if (buyBtnPrice && buyBtnPrice.innerText) {
            const bp = parseFloat(buyBtnPrice.innerText.replace(/,/g, '').trim());
            if (!isNaN(bp) && bp > 0) detectedPrice = bp;
          }
        }
      }
    }

    // Apply detected Symbol
    if (detectedSymbol && detectedSymbol !== state.symbol) {
      handleSymbolUpdate(detectedSymbol);
    }

    // Apply detected Price
    if (detectedPrice !== null) {
      state.prevLtp = state.ltp;
      state.ltp = detectedPrice;
      renderLtpTick();
    }

    updatePnLDisplay();
  }

  // Render LTP with Uptick/Downtick Flashes
  function renderLtpTick() {
    const ltpEl = document.getElementById('fsm-ltp-val');
    if (!ltpEl) return;

    ltpEl.textContent = '₹' + state.ltp.toFixed(2);

    if (state.prevLtp > 0 && state.ltp !== state.prevLtp) {
      if (state.ltp > state.prevLtp) {
        ltpEl.classList.remove('fsm-downtick');
        ltpEl.classList.add('fsm-uptick');
      } else {
        ltpEl.classList.remove('fsm-uptick');
        ltpEl.classList.add('fsm-downtick');
      }
      setTimeout(() => {
        ltpEl.classList.remove('fsm-uptick', 'fsm-downtick');
      }, 300);
    }
  }

  // Calculate Unrealized PnL of Open Position
  function calculateCurrentPnL() {
    if (!state.activePosition || !state.ltp) return { pnl: 0, points: 0 };
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

  // Update Dynamic PnL Display
  function updatePnLDisplay() {
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

  // Update Lot Stepper Display
  function updateLotDisplay() {
    const lotCountEl = document.getElementById('fsm-lot-count');
    const totalQtyEl = document.getElementById('fsm-total-qty');
    if (lotCountEl) {
      lotCountEl.textContent = `${state.lots} Lot${state.lots > 1 ? 's' : ''}`;
    }
    if (totalQtyEl) {
      totalQtyEl.textContent = `(${state.qty} Qty @ Lot ${state.lotSize})`;
    }
    // Update multiplier pill active states
    document.querySelectorAll('.fsm-mult-btn').forEach(btn => {
      const m = parseInt(btn.dataset.mult, 10);
      if (m === state.lots) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Execute Order (BUY / SELL)
  function executeOrder(side) {
    initAudio();
    const currentPrice = state.ltp > 0 ? state.ltp : 100.00;
    const qty = state.qty > 0 ? state.qty : state.lotSize;
    const nowStr = new Date().toLocaleTimeString();

    // Live DOM Trigger Mode
    if (state.mode === 'LIVE_DOM') {
      triggerFyersDOMOrder(side);
    }

    // Practice Execution
    if (state.activePosition) {
      if (state.activePosition.side === side) {
        // Add to existing position
        const totalQty = state.activePosition.qty + qty;
        const avgPrice = ((state.activePosition.entryPrice * state.activePosition.qty) + (currentPrice * qty)) / totalQty;
        state.activePosition.qty = totalQty;
        state.activePosition.entryPrice = parseFloat(avgPrice.toFixed(2));
        showToast(`Added ${qty} to ${side} @ ₹${currentPrice.toFixed(2)}`);
      } else {
        // Reverse
        closeActivePosition();
        state.activePosition = {
          symbol: state.symbol,
          side: side,
          qty: qty,
          entryPrice: currentPrice,
          time: nowStr
        };
        showToast(`Reversed to ${side} ${qty} @ ₹${currentPrice.toFixed(2)}`);
        playSound(side);
      }
    } else {
      // New Position
      state.activePosition = {
        symbol: state.symbol,
        side: side,
        qty: qty,
        entryPrice: currentPrice,
        time: nowStr
      };
      showToast(`${side} ${qty} ${state.symbol} @ ₹${currentPrice.toFixed(2)}`);
      playSound(side);
    }

    saveState();
    renderHUD();
  }

  // Close Active Position (Exit / Square Off)
  function closeActivePosition() {
    if (!state.activePosition) return;
    initAudio();

    const exitPrice = state.ltp > 0 ? state.ltp : state.activePosition.entryPrice;
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

  // Trigger FYERS Native TradingView Buttons in Iframe
  function triggerFyersDOMOrder(side) {
    try {
      const tvDoc = getTvIframeDocument();
      if (tvDoc) {
        const activeChart = tvDoc.querySelector('.chart-container.active') || tvDoc.querySelector('.chart-container');
        if (activeChart) {
          const btn = side === 'BUY'
            ? activeChart.querySelector('[data-name="buy-order-button"]')
            : activeChart.querySelector('[data-name="sell-order-button"]');
          if (btn) {
            btn.click();
            showToast(`[DOM Mode] Clicked TradingView ${side} Button`);
            return;
          }
        }
      }

      // Check Top DOM Order Window
      const topBtn = side === 'BUY'
        ? document.querySelector('#buyButton, button.buy-button, .buy-btn')
        : document.querySelector('#sellButton, button.sell-button, .sell-btn');
      if (topBtn) {
        topBtn.click();
        showToast(`[DOM Mode] Clicked FYERS ${side} Button`);
      } else {
        showToast(`[DOM Mode] Instant order button not visible on chart`);
      }
    } catch (e) {
      console.error('[ScalpMaster] DOM Order Trigger Error:', e);
    }
  }

  // Reset Today's Stats
  function resetDayStats() {
    if (confirm("Reset today's practice statistics and completed trade log?")) {
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

  // Build & Render HUD
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
          <span class="fsm-badge ${state.mode === 'PRACTICE' ? 'fsm-badge-practice' : 'fsm-badge-live'}" id="fsm-toggle-mode" title="Click to toggle Practice / Live DOM Mode">
            ${state.mode === 'PRACTICE' ? 'PRACTICE' : 'LIVE DOM'}
          </span>
        </div>
        <div class="fsm-controls">
          <button class="fsm-icon-btn" id="fsm-sound-btn" title="Toggle Sound">${state.soundEnabled ? '🔔' : '🔕'}</button>
          <button class="fsm-icon-btn" id="fsm-min-btn" title="Minimize / Expand">${state.minimized ? '🗖' : '🗕'}</button>
        </div>
      </div>

      <div class="fsm-body">
        <!-- Instrument & Real-time Live Price Strip -->
        <div class="fsm-quote-strip">
          <div class="fsm-symbol-info">
            <span class="fsm-symbol-name" title="${state.symbol}">${state.symbol}</span>
            <span class="fsm-symbol-desc">${state.symbolDesc || 'Live Chart Instrument'}</span>
          </div>
          <div class="fsm-ltp-box">
            <span class="fsm-ltp-val" id="fsm-ltp-val">₹${state.ltp.toFixed(2)}</span>
          </div>
        </div>

        <!-- Day Net P&L Summary -->
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

        <!-- Lot Size Stepper Controls (+ / -) -->
        <div class="fsm-order-section">
          <div class="fsm-lot-control-row">
            <div class="fsm-lot-stepper">
              <button class="fsm-step-btn" id="fsm-lot-minus" title="Decrease 1 Lot">−</button>
              <div class="fsm-lot-summary">
                <span class="fsm-lot-count" id="fsm-lot-count">${state.lots} Lot${state.lots > 1 ? 's' : ''}</span>
                <span class="fsm-total-qty" id="fsm-total-qty">(${state.qty} Qty @ Lot ${state.lotSize})</span>
              </div>
              <button class="fsm-step-btn" id="fsm-lot-plus" title="Increase 1 Lot">+</button>
            </div>
            <div class="fsm-lot-multipliers">
              <button class="fsm-mult-btn ${state.lots === 1 ? 'active' : ''}" data-mult="1">1x</button>
              <button class="fsm-mult-btn ${state.lots === 2 ? 'active' : ''}" data-mult="2">2x</button>
              <button class="fsm-mult-btn ${state.lots === 3 ? 'active' : ''}" data-mult="3">3x</button>
              <button class="fsm-mult-btn ${state.lots === 5 ? 'active' : ''}" data-mult="5">5x</button>
              <button class="fsm-mult-btn ${state.lots === 10 ? 'active' : ''}" data-mult="10">10x</button>
            </div>
          </div>

          <!-- BUY & SELL Execution Buttons -->
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

          <!-- SQUARE OFF & REVERSE Buttons -->
          <div class="fsm-action-strip">
            <button class="fsm-btn-exit" id="fsm-exit-btn" ${!state.activePosition ? 'disabled' : ''}>
              SQUARE OFF [Shift + X]
            </button>
            <button class="fsm-btn-reverse" id="fsm-reverse-btn" ${!state.activePosition ? 'disabled' : ''}>
              REVERSE [R]
            </button>
          </div>
        </div>

        <!-- Navigation Tabs: Active Position vs Trade Log -->
        <div class="fsm-tab-nav">
          <div class="fsm-tab ${state.activeTab === 'position' ? 'active' : ''}" id="fsm-tab-pos">Active Position</div>
          <div class="fsm-tab ${state.activeTab === 'history' ? 'active' : ''}" id="fsm-tab-hist">Trade Log (${state.completedTrades.length})</div>
        </div>

        <!-- Tab 1: Active Position Card -->
        <div id="fsm-tab-content-pos" style="display: ${state.activeTab === 'position' ? 'block' : 'none'};">
          ${state.activePosition ? `
            <div class="fsm-position-card">
              <div class="fsm-position-header">
                <span class="fsm-pos-type ${state.activePosition.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">
                  ${state.activePosition.side} ${state.activePosition.qty} Qty (${state.activePosition.symbol})
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

        <!-- Tab 2: Trade Log & History -->
        <div id="fsm-tab-content-hist" style="display: ${state.activeTab === 'history' ? 'block' : 'none'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; color: var(--fsm-text-muted);">Completed Scalps Today</span>
            <button id="fsm-reset-btn" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 11px; text-decoration: underline;">Reset Day</button>
          </div>
          <div class="fsm-orders-list">
            ${state.completedTrades.length === 0 ? `
              <div style="text-align: center; color: var(--fsm-text-muted); padding: 12px; font-size: 11px;">No completed scalps yet.</div>
            ` : state.completedTrades.map(t => `
              <div class="fsm-order-row">
                <div style="display: flex; flex-direction: column;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="fsm-order-side ${t.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">${t.side}</span>
                    <span style="font-weight: 600;">${t.qty} @ ₹${t.entryPrice.toFixed(2)}</span>
                  </div>
                  <span style="font-size: 9px; color: var(--fsm-text-muted);">${t.symbol}</span>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 800; color: ${t.pnl >= 0 ? '#34d399' : '#f87171'};">
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

  // Bind Events
  function bindEvents(container) {
    // Mode switch
    const modeBtn = container.querySelector('#fsm-toggle-mode');
    if (modeBtn) {
      modeBtn.onclick = () => {
        state.mode = state.mode === 'PRACTICE' ? 'LIVE_DOM' : 'PRACTICE';
        showToast(`Mode: ${state.mode === 'PRACTICE' ? 'Practice (Simulated)' : 'Live DOM Execution'}`);
        saveState();
        renderHUD();
      };
    }

    // Sound toggle
    const soundBtn = container.querySelector('#fsm-sound-btn');
    if (soundBtn) {
      soundBtn.onclick = () => {
        state.soundEnabled = !state.soundEnabled;
        showToast(state.soundEnabled ? 'Audio Chimes Enabled' : 'Audio Muted');
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

    // Lot Stepper: Plus (+) and Minus (-)
    const lotMinusBtn = container.querySelector('#fsm-lot-minus');
    if (lotMinusBtn) {
      lotMinusBtn.onclick = () => {
        if (state.lots > 1) {
          state.lots--;
          state.qty = state.lots * state.lotSize;
          updateLotDisplay();
          saveState();
        }
      };
    }

    const lotPlusBtn = container.querySelector('#fsm-lot-plus');
    if (lotPlusBtn) {
      lotPlusBtn.onclick = () => {
        state.lots++;
        state.qty = state.lots * state.lotSize;
        updateLotDisplay();
        saveState();
      };
    }

    // Lot Multipliers (1x, 2x, 3x, 5x, 10x)
    container.querySelectorAll('.fsm-mult-btn').forEach(btn => {
      btn.onclick = () => {
        const mult = parseInt(btn.dataset.mult, 10);
        if (mult > 0) {
          state.lots = mult;
          state.qty = state.lots * state.lotSize;
          updateLotDisplay();
          saveState();
        }
      };
    });

    // BUY Button
    const buyBtn = container.querySelector('#fsm-buy-btn');
    if (buyBtn) {
      buyBtn.onclick = (e) => {
        e.preventDefault();
        executeOrder('BUY');
      };
    }

    // SELL Button
    const sellBtn = container.querySelector('#fsm-btn-sell');
    if (sellBtn) {
      sellBtn.onclick = (e) => {
        e.preventDefault();
        executeOrder('SELL');
      };
    }

    // SQUARE OFF Button
    const exitBtn = container.querySelector('#fsm-exit-btn');
    if (exitBtn) {
      exitBtn.onclick = (e) => {
        e.preventDefault();
        closeActivePosition();
      };
    }

    // REVERSE Button
    const reverseBtn = container.querySelector('#fsm-reverse-btn');
    if (reverseBtn) {
      reverseBtn.onclick = (e) => {
        e.preventDefault();
        reversePosition();
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

    // Reset Day button
    const resetBtn = container.querySelector('#fsm-reset-btn');
    if (resetBtn) {
      resetBtn.onclick = () => resetDayStats();
    }
  }

  // Draggable HUD
  function setupDrag(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    element.onmousedown = (e) => {
      if (e.target.closest('#fsm-drag-handle')) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = () => {
          document.onmouseup = null;
          document.onmousemove = null;
        };
        document.onmousemove = (e) => {
          e.preventDefault();
          pos1 = pos3 - e.clientX;
          pos2 = pos4 - e.clientY;
          pos3 = e.clientX;
          pos4 = e.clientY;
          element.style.top = (element.offsetTop - pos2) + "px";
          element.style.left = (element.offsetLeft - pos1) + "px";
          element.style.right = "auto";
        };
      }
    };
  }

  // Hotkey Shortcuts
  window.addEventListener('keydown', (e) => {
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

  // Fast Scraping Loop (100ms interval for real-time tick and symbol tracking)
  setInterval(scrapeActiveMarketData, 100);

  // Initialize
  loadState();
  renderHUD();
  scrapeActiveMarketData();
  console.log('[ScalpMaster] Initialized successfully with auto-symbol & lot tracking.');
})();
