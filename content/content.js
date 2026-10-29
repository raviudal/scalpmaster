/**
 * FYERS ScalpMaster - Compact Scalping & Practice HUD
 * Injected into trade.fyers.in
 */

(function () {
  // Clear any existing intervals and DOM instances on re-injection
  if (window.__fsm_interval) {
    clearInterval(window.__fsm_interval);
    window.__fsm_interval = null;
  }
  const existingHud = document.getElementById('fyers-scalpmaster-hud');
  if (existingHud) {
    existingHud.remove();
  }
  window.__fyers_scalpmaster_initialized = true;

  const STATE_KEY = 'fsm_state_v3';

  // State
  let state = {
    mode: 'PRACTICE', // 'PRACTICE' or 'LIVE_DOM'
    activeTab: 'position', // 'position' or 'history'
    symbol: '',
    symbolDesc: '',
    lotSize: 1,
    lots: 1,
    qty: 1,
    ltp: 0,
    prevLtp: 0,
    activePosition: null, // { symbol, side, qty, entryPrice, time, lastKnownLtp }
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

  // Immediate pre-scrape so we don't start at 0
  const initialData = quickScrapeTitle();
  if (initialData.price > 0) {
    state.ltp = initialData.price;
    state.prevLtp = initialData.price;
  }
  if (initialData.symbol) {
    state.symbol = initialData.symbol;
  }

  // Audio Synthesizer
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx && AudioCtx) {
      audioCtx = new AudioCtx();
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
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'SELL') {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'WIN') {
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'LOSS') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(349.23, now + 0.1);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      }
    } catch (e) {
      console.warn('[ScalpMaster] Audio error:', e);
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
    }, 2000);
  }

  // Load Saved State
  function loadState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STATE_KEY], (res) => {
        if (res && res[STATE_KEY]) {
          const saved = res[STATE_KEY];
          state.dayStats = saved.dayStats || state.dayStats;
          state.completedTrades = saved.completedTrades || [];
          state.activePosition = saved.activePosition || null;
          state.lots = saved.lots || 1;
          state.soundEnabled = saved.soundEnabled !== undefined ? saved.soundEnabled : true;
          state.minimized = !!saved.minimized;
          state.mode = saved.mode || 'PRACTICE';
        }
        renderHUD();
      });
    } else {
      renderHUD();
    }
  }

  // Save State
  function saveState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STATE_KEY]: state });
    }
  }

  // Fast title parser
  function quickScrapeTitle() {
    const title = document.title || '';
    const m = title.match(/^([\d,]+(?:\.\d+)?)\s*(?:[▲▼]\s*)?(?:\([+-]?[0-9.,]*%\)\s*)?([A-Za-z0-9_\-]+)/);
    if (m) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(p) && p > 0) {
        return { price: p, symbol: m[2].trim() };
      }
    }
    return { price: null, symbol: null };
  }

  // TV Iframe Access
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

  // Query FYERS Local IndexedDB
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

  // Fallback Lot Sizes
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
    return 1;
  }

  // Symbol Update Handler
  let lastCheckedSymbol = '';
  async function handleSymbolUpdate(newSymbol) {
    if (!newSymbol || newSymbol === lastCheckedSymbol) return;
    lastCheckedSymbol = newSymbol;
    state.symbol = newSymbol;

    const dbRecord = await querySymbolIndexedDB(newSymbol);
    if (dbRecord && dbRecord.lot_size) {
      state.lotSize = dbRecord.lot_size;
      state.symbolDesc = dbRecord.description || dbRecord.short_name || '';
    } else {
      state.lotSize = inferLotSize(newSymbol);
      state.symbolDesc = newSymbol.includes('PE') ? 'Put Option' : newSymbol.includes('CE') ? 'Call Option' : 'Instrument';
    }

    state.qty = state.lots * state.lotSize;

    // Update DOM
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

  // Real-Time Scraping Loop
  function scrapeActiveMarketData() {
    let detectedPrice = null;
    let detectedSymbol = null;

    // 1. From document.title
    const titleData = quickScrapeTitle();
    if (titleData.price !== null) {
      detectedPrice = titleData.price;
      detectedSymbol = titleData.symbol;
    }

    // 2. From TradingView Iframe fallback
    if (detectedPrice === null || !detectedSymbol) {
      const tvDoc = getTvIframeDocument();
      if (tvDoc) {
        const activeChart = tvDoc.querySelector('.chart-container.active') || tvDoc.querySelector('.chart-container');
        if (activeChart) {
          if (!detectedSymbol) {
            const symBtn = activeChart.querySelector('.js-button-text') || activeChart.querySelector('button[class*="title-"]');
            if (symBtn && symBtn.innerText && symBtn.innerText.trim()) {
              detectedSymbol = symBtn.innerText.trim();
            }
          }
          if (detectedPrice === null) {
            const buyBtnPrice = activeChart.querySelector('[data-name="buy-order-button"] .buttonText-hw_3o_pb');
            if (buyBtnPrice && buyBtnPrice.innerText) {
              const bp = parseFloat(buyBtnPrice.innerText.replace(/,/g, '').trim());
              if (!isNaN(bp) && bp > 0) detectedPrice = bp;
            }
          }
        }
      }
    }

    // Apply symbol if found
    if (detectedSymbol && detectedSymbol !== state.symbol) {
      handleSymbolUpdate(detectedSymbol);
    }

    // Apply price ONLY IF valid and non-zero (NEVER reset to zero!)
    if (detectedPrice !== null && !isNaN(detectedPrice) && detectedPrice > 0) {
      state.prevLtp = state.ltp || detectedPrice;
      state.ltp = detectedPrice;
      renderLtpTick();
    }

    updatePnLDisplay();
  }

  // Render LTP Tick
  function renderLtpTick() {
    const ltpEl = document.getElementById('fsm-ltp-val');
    if (!ltpEl || state.ltp <= 0) return;

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
      }, 250);
    }
  }

  // Calculate Unrealized PnL (With Instrument Safety Check)
  function calculateCurrentPnL() {
    if (!state.activePosition) return { pnl: 0, points: 0 };

    // If current chart is on a different symbol, use position's last known LTP to prevent wild mismatches
    let currentPrice = state.ltp;
    if (state.symbol && state.activePosition.symbol && state.symbol !== state.activePosition.symbol) {
      currentPrice = state.activePosition.lastKnownLtp || state.activePosition.entryPrice;
    } else {
      state.activePosition.lastKnownLtp = currentPrice;
    }

    if (!currentPrice || currentPrice <= 0) return { pnl: 0, points: 0 };

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

    const dayPnlEl = document.getElementById('fsm-day-pnl-val');
    if (dayPnlEl) {
      const sign = totalDayPnL >= 0 ? '+' : '';
      dayPnlEl.textContent = `${sign}₹${totalDayPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      dayPnlEl.className = 'fsm-day-pnl-value ' + (totalDayPnL > 0 ? 'fsm-pnl-positive' : totalDayPnL < 0 ? 'fsm-pnl-negative' : '');
    }

    const activePnlEl = document.getElementById('fsm-active-pnl-val');
    if (activePnlEl && state.activePosition) {
      const sign = pnl >= 0 ? '+' : '';
      activePnlEl.textContent = `${sign}₹${pnl.toFixed(2)} (${points >= 0 ? '+' : ''}${points.toFixed(2)} pts)`;
      activePnlEl.className = 'fsm-position-pnl ' + (pnl > 0 ? 'fsm-pnl-positive' : pnl < 0 ? 'fsm-pnl-negative' : '');
    }
  }

  // Update Lot Stepper Display
  function updateLotDisplay() {
    const lotSummaryEl = document.getElementById('fsm-lot-summary');
    if (lotSummaryEl) {
      lotSummaryEl.innerHTML = `${state.lots} Lot${state.lots > 1 ? 's' : ''} <span class="fsm-lot-sub">(${state.qty} Qty)</span>`;
    }
    document.querySelectorAll('.fsm-mult-btn').forEach(btn => {
      const m = parseInt(btn.dataset.mult, 10);
      if (m === state.lots) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Execute Order
  function executeOrder(side) {
    initAudio();
    const currentPrice = state.ltp > 0 ? state.ltp : 100.00;
    const qty = state.qty > 0 ? state.qty : state.lotSize;
    const nowStr = new Date().toLocaleTimeString();

    if (state.mode === 'LIVE_DOM') {
      triggerFyersDOMOrder(side);
    }

    if (state.activePosition) {
      if (state.activePosition.side === side) {
        const totalQty = state.activePosition.qty + qty;
        const avgPrice = ((state.activePosition.entryPrice * state.activePosition.qty) + (currentPrice * qty)) / totalQty;
        state.activePosition.qty = totalQty;
        state.activePosition.entryPrice = parseFloat(avgPrice.toFixed(2));
        showToast(`Added ${qty} to ${side} @ ₹${currentPrice.toFixed(2)}`);
      } else {
        closeActivePosition();
        state.activePosition = {
          symbol: state.symbol,
          side: side,
          qty: qty,
          entryPrice: currentPrice,
          lastKnownLtp: currentPrice,
          time: nowStr
        };
        showToast(`Reversed to ${side} ${qty} @ ₹${currentPrice.toFixed(2)}`);
        playSound(side);
      }
    } else {
      state.activePosition = {
        symbol: state.symbol,
        side: side,
        qty: qty,
        entryPrice: currentPrice,
        lastKnownLtp: currentPrice,
        time: nowStr
      };
      showToast(`${side} ${qty} ${state.symbol} @ ₹${currentPrice.toFixed(2)}`);
      playSound(side);
    }

    saveState();
    renderHUD();
  }

  // Close Position
  function closeActivePosition() {
    if (!state.activePosition) return;
    initAudio();

    const exitPrice = (state.activePosition.symbol === state.symbol && state.ltp > 0)
      ? state.ltp
      : (state.activePosition.lastKnownLtp || state.activePosition.entryPrice);

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

  // Trigger FYERS Native Order
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
            showToast(`[DOM Mode] Clicked TV ${side} Button`);
            return;
          }
        }
      }
      const topBtn = side === 'BUY'
        ? document.querySelector('#buyButton, button.buy-button, .buy-btn')
        : document.querySelector('#sellButton, button.sell-button, .sell-btn');
      if (topBtn) {
        topBtn.click();
        showToast(`[DOM Mode] Clicked FYERS ${side} Button`);
      }
    } catch (e) {
      console.error('[ScalpMaster] DOM Order Trigger Error:', e);
    }
  }

  // Reset Today
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

  // Build HUD
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
          <span class="fsm-badge ${state.mode === 'PRACTICE' ? 'fsm-badge-practice' : 'fsm-badge-live'}" id="fsm-toggle-mode">
            ${state.mode === 'PRACTICE' ? 'PRACTICE' : 'LIVE DOM'}
          </span>
        </div>
        <div class="fsm-controls">
          <button class="fsm-icon-btn" id="fsm-sound-btn" title="Toggle Sound">${state.soundEnabled ? '🔔' : '🔕'}</button>
          <button class="fsm-icon-btn" id="fsm-min-btn" title="Minimize / Expand">${state.minimized ? '🗖' : '🗕'}</button>
        </div>
      </div>

      <div class="fsm-body">
        <!-- Big Live LTP & Symbol Hero Section -->
        <div class="fsm-hero-section">
          <div class="fsm-symbol-info">
            <span class="fsm-symbol-name" title="${state.symbol}">${state.symbol || 'Loading Symbol...'}</span>
            <span class="fsm-symbol-desc">${state.symbolDesc || 'Chart Instrument'}</span>
          </div>
          <div class="fsm-ltp-box">
            <span class="fsm-ltp-val" id="fsm-ltp-val">${state.ltp > 0 ? '₹' + state.ltp.toFixed(2) : '--'}</span>
          </div>
        </div>

        <!-- Day Net P&L Summary -->
        <div class="fsm-day-pnl-card">
          <div class="fsm-day-pnl-label">Day Net P&amp;L</div>
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

        <!-- Compact Lot Stepper Row (+ / -) -->
        <div class="fsm-lot-row">
          <div class="fsm-lot-stepper">
            <button class="fsm-step-btn" id="fsm-lot-minus" title="Decrease 1 Lot">−</button>
            <div class="fsm-lot-summary" id="fsm-lot-summary">
              ${state.lots} Lot${state.lots > 1 ? 's' : ''} <span class="fsm-lot-sub">(${state.qty} Qty)</span>
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

        <!-- Sleek Small Scalping Trade Buttons -->
        <div class="fsm-trade-btns">
          <button class="fsm-btn-small fsm-btn-buy" id="fsm-buy-btn">
            <span>BUY</span>
            <span class="fsm-shortcut">[⇧B]</span>
          </button>
          <button class="fsm-btn-small fsm-btn-sell" id="fsm-btn-sell">
            <span>SELL</span>
            <span class="fsm-shortcut">[⇧S]</span>
          </button>
        </div>

        <!-- Square Off & Reverse Controls -->
        <div class="fsm-action-strip">
          <button class="fsm-btn-exit" id="fsm-exit-btn" ${!state.activePosition ? 'disabled' : ''}>
            SQUARE OFF [⇧X]
          </button>
          <button class="fsm-btn-reverse" id="fsm-reverse-btn" ${!state.activePosition ? 'disabled' : ''}>
            REVERSE [R]
          </button>
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
                  ${state.activePosition.side} ${state.activePosition.qty} Qty
                </span>
                <span style="color: var(--fsm-text-muted); font-size: 9px;">${state.activePosition.time}</span>
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
            <div class="fsm-no-pos">Flat. Click BUY or SELL to scalp!</div>
          `}
        </div>

        <!-- Tab 2: Trade Log -->
        <div id="fsm-tab-content-hist" style="display: ${state.activeTab === 'history' ? 'block' : 'none'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 10px; color: var(--fsm-text-muted);">Completed Scalps</span>
            <button id="fsm-reset-btn" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 10px; text-decoration: underline;">Reset Day</button>
          </div>
          <div class="fsm-orders-list">
            ${state.completedTrades.length === 0 ? `
              <div style="text-align: center; color: var(--fsm-text-muted); padding: 8px; font-size: 10px;">No completed scalps yet.</div>
            ` : state.completedTrades.map(t => `
              <div class="fsm-order-row">
                <div style="display: flex; flex-direction: column;">
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <span class="fsm-order-side ${t.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">${t.side}</span>
                    <span style="font-weight: 700;">${t.qty} @ ₹${t.entryPrice.toFixed(2)}</span>
                  </div>
                  <span style="font-size: 8px; color: var(--fsm-text-muted);">${t.symbol}</span>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 800; color: ${t.pnl >= 0 ? '#34d399' : '#f87171'}; font-size: 11px;">
                    ${t.pnl >= 0 ? '+' : ''}₹${t.pnl.toFixed(2)}
                  </div>
                  <div style="font-size: 8px; color: var(--fsm-text-muted);">${t.points >= 0 ? '+' : ''}${t.points} pts</div>
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
    const modeBtn = container.querySelector('#fsm-toggle-mode');
    if (modeBtn) {
      modeBtn.onclick = () => {
        state.mode = state.mode === 'PRACTICE' ? 'LIVE_DOM' : 'PRACTICE';
        showToast(`Mode: ${state.mode === 'PRACTICE' ? 'Practice (Simulated)' : 'Live DOM Execution'}`);
        saveState();
        renderHUD();
      };
    }

    const soundBtn = container.querySelector('#fsm-sound-btn');
    if (soundBtn) {
      soundBtn.onclick = () => {
        state.soundEnabled = !state.soundEnabled;
        showToast(state.soundEnabled ? 'Audio Enabled' : 'Audio Muted');
        saveState();
        renderHUD();
      };
    }

    const minBtn = container.querySelector('#fsm-min-btn');
    if (minBtn) {
      minBtn.onclick = () => {
        state.minimized = !state.minimized;
        saveState();
        renderHUD();
      };
    }

    // Lot Stepper
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

    // Buttons
    const buyBtn = container.querySelector('#fsm-buy-btn');
    if (buyBtn) buyBtn.onclick = (e) => { e.preventDefault(); executeOrder('BUY'); };

    const sellBtn = container.querySelector('#fsm-btn-sell');
    if (sellBtn) sellBtn.onclick = (e) => { e.preventDefault(); executeOrder('SELL'); };

    const exitBtn = container.querySelector('#fsm-exit-btn');
    if (exitBtn) exitBtn.onclick = (e) => { e.preventDefault(); closeActivePosition(); };

    const reverseBtn = container.querySelector('#fsm-reverse-btn');
    if (reverseBtn) reverseBtn.onclick = (e) => { e.preventDefault(); reversePosition(); };

    const tabPos = container.querySelector('#fsm-tab-pos');
    const tabHist = container.querySelector('#fsm-tab-hist');
    if (tabPos && tabHist) {
      tabPos.onclick = () => { state.activeTab = 'position'; renderHUD(); };
      tabHist.onclick = () => { state.activeTab = 'history'; renderHUD(); };
    }

    const resetBtn = container.querySelector('#fsm-reset-btn');
    if (resetBtn) resetBtn.onclick = () => resetDayStats();
  }

  // Dragging
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

  // Keyboard Shortcuts
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

  // Start single loop
  window.__fsm_interval = setInterval(scrapeActiveMarketData, 100);

  // Initialize
  loadState();
  scrapeActiveMarketData();
  console.log('[ScalpMaster] Injected smoothly without zero flicker.');
})();
