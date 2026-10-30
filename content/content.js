/**
 * FYERS ScalpMaster - Practice & Scalping HUD
 * Chart Markers, Robust Draggable Stop-Loss, Every-Trade Counter, and Partial Close
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

  // -------------------------------------------------------------
  // GOOGLE ANALYTICS 4 (GA4) TELEMETRY MODULE
  // -------------------------------------------------------------
  const GA_MEASUREMENT_ID = 'G-HVGVDSWP5D';
  const GA_API_SECRET = 'fYXxGXj_TVy70h6-guS5iw';

  async function logAnalyticsEvent(eventName, params = {}) {
    try {
      let clientData = await new Promise(resolve => {
        chrome.storage.local.get(['ga_client_id'], res => resolve(res || {}));
      });

      let clientId = clientData.ga_client_id;
      if (!clientId) {
        clientId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
          ? crypto.randomUUID() 
          : 'cid_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        chrome.storage.local.set({ ga_client_id: clientId });
      }

      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;
      fetch(url, {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [
            {
              name: eventName,
              params: {
                ...params,
                engagement_time_msec: 100
              }
            }
          ]
        })
      }).catch(() => {});
    } catch (e) {
      // Fail silently to never block UI
    }
  }

  // -------------------------------------------------------------
  // 1. INJECT TRADINGVIEW CHART & NATIVE BROKER BRIDGE (Main World)
  // -------------------------------------------------------------
  function injectChartBridge() {
    const existingScript = document.getElementById('fsm-chart-bridge-script');
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = 'fsm-chart-bridge-script';
    script.textContent = `
      (function() {
        let activeOrderLine = null;
        let createdShapes = [];
        let currentActiveSl = null; // { symbol, price, qty }
        let currentActivePos = null; // { symbol, side, qty, avgPrice }
        let isBrokerHooked = false;

        // Normalize symbol to TradingView exchange format (e.g., "NSE:NIFTY26N0322950PE")
        function formatTvSymbol(symbol) {
          if (!symbol) return '';
          let s = symbol.trim();
          if (!s.includes(':')) {
            s = (s.includes('MCX') ? 'MCX:' : (s.includes('BSE') ? 'BSE:' : 'NSE:')) + s;
          }
          return s;
        }

        // Wait for FYERS native broker or TradingView Chart to be ready
        function waitForBrokerOrChart(timeoutMs = 25000) {
          return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
              // 1. Check native TradingView broker host (FYERS native mechanism)
              if (window.broker && window.broker._host && typeof window.broker._host.orderUpdate === 'function') {
                hookBrokerMethods();
                return resolve({ type: 'broker', broker: window.broker, host: window.broker._host });
              }
              // 2. Check TradingView widget
              if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                try {
                  const c = window.tvWidget.activeChart();
                  if (c && typeof c.createOrderLine === 'function') {
                    return resolve({ type: 'chart', chart: c });
                  }
                } catch(e) {}
              }
              if (Date.now() - start > timeoutMs) {
                return resolve(null);
              }
              setTimeout(check, 300);
            };
            check();
          });
        }

        // Hook FYERS native broker methods so drag & cancel on chart sync back to ScalpMaster
        function hookBrokerMethods() {
          if (isBrokerHooked || !window.broker) return;
          isBrokerHooked = true;

          const origModifyOrder = window.broker.modifyOrder;
          window.broker.modifyOrder = function(order) {
            if (order && order.id && String(order.id).startsWith('FSM_SL_')) {
              const newPrice = order.stopPrice || order.price || order.limitPrice;
              if (newPrice && newPrice > 0) {
                window.dispatchEvent(new CustomEvent('FSM_SL_DRAGGED', { detail: { price: newPrice } }));
              }
              return Promise.resolve({ success: true });
            }
            if (typeof origModifyOrder === 'function') {
              return origModifyOrder.apply(this, arguments);
            }
            return Promise.resolve();
          };

          const origCancelOrder = window.broker.cancelOrder;
          window.broker.cancelOrder = function(orderId) {
            if (orderId && String(orderId).startsWith('FSM_SL_')) {
              window.dispatchEvent(new CustomEvent('FSM_SL_CANCELLED'));
              return Promise.resolve({ success: true });
            }
            if (typeof origCancelOrder === 'function') {
              return origCancelOrder.apply(this, arguments);
            }
            return Promise.resolve();
          };

          const origClosePosition = window.broker.closePosition;
          window.broker.closePosition = function(positionId) {
            if (positionId && String(positionId).startsWith('FSM_POS_')) {
              window.dispatchEvent(new CustomEvent('FSM_POS_CLOSE_CLICKED'));
              return Promise.resolve({ success: true });
            }
            if (typeof origClosePosition === 'function') {
              return origClosePosition.apply(this, arguments);
            }
            return Promise.resolve();
          };
        }

        // -------------------------------------------------------------
        // NATIVE BROKER POSITION UPDATE
        // -------------------------------------------------------------
        async function updateNativePosition(pos) {
          const res = await waitForBrokerOrChart(15000);
          if (!res) return;

          if (res.type === 'broker') {
            const host = res.host;
            const tvSym = formatTvSymbol(pos ? pos.symbol : (currentActivePos ? currentActivePos.symbol : ''));
            const posId = 'FSM_POS_' + (pos ? pos.symbol : 'MAIN');

            if (!pos || !pos.qty || pos.qty <= 0) {
              // Close position
              try {
                host.positionUpdate({
                  id: posId,
                  symbol: tvSym,
                  qty: 0,
                  side: 1,
                  avgPrice: 0
                });
              } catch(e) {}
              currentActivePos = null;
              return;
            }

            currentActivePos = { ...pos, tvSymbol: tvSym };
            try {
              host.positionUpdate({
                id: posId,
                symbol: tvSym,
                qty: pos.qty,
                side: pos.side === 'BUY' ? 1 : -1,
                avgPrice: pos.avgPrice || pos.entryPrice
              });
              console.log('[ScalpMaster Bridge] Native Broker Position updated:', tvSym, pos.qty, '@', pos.avgPrice);
            } catch(err) {
              console.warn('[ScalpMaster Bridge] Position update error:', err);
            }
          }
        }

        // -------------------------------------------------------------
        // STOP-LOSS ORDER UPDATE (Native Broker + Fallback OrderLine)
        // -------------------------------------------------------------
        async function renderStopLoss(price, qty, symbol, side) {
          if (!price || price <= 0) return;
          const res = await waitForBrokerOrChart(20000);
          if (!res) return;

          const tvSym = formatTvSymbol(symbol || (currentActiveSl ? currentActiveSl.symbol : ''));
          const slId = 'FSM_SL_' + (symbol || 'MAIN');
          const posId = 'FSM_POS_' + (symbol || 'MAIN');
          currentActiveSl = { price, qty, symbol: tvSym, side };

          // 1. Primary: Native FYERS / TradingView Broker Host
          if (res.type === 'broker') {
            const host = res.host;
            try {
              // Register SL order directly in TradingView native broker
              host.orderUpdate({
                id: slId,
                symbol: tvSym,
                qty: qty || 1,
                side: side === 'BUY' ? -1 : 1, // Opposing side to close
                type: 3, // OrderType.Stop
                status: 6, // OrderStatus.Working
                stopPrice: price,
                price: price,
                limitPrice: price,
                parentId: posId,
                parentType: 2 // ParentType.Position (Bracket SL on Position!)
              });
              console.log('[ScalpMaster Bridge] Native TradingView Bracket SL order rendered at ₹' + price);
            } catch(err) {
              console.warn('[ScalpMaster Bridge] Native SL orderUpdate error:', err);
            }
          }

          // 2. Also ensure TradingView visual chart orderLine is drawn (Direct Canvas Fallback)
          try {
            if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
              const chart = window.tvWidget.activeChart();
              if (chart && typeof chart.createOrderLine === 'function') {
                if (activeOrderLine) {
                  try { activeOrderLine.remove(); } catch(e) {}
                  activeOrderLine = null;
                }
                const order = await chart.createOrderLine();
                order.setPrice(price)
                  .setText('🛑 STOP LOSS: ₹' + price.toFixed(2))
                  .setQuantity(String(qty || ''))
                  .setExtendLeft(true)
                  .setLineWidth(2)
                  .setLineStyle(2)
                  .setLineColor('#EF4444')
                  .setBodyBackgroundColor('#EF4444')
                  .setBodyTextColor('#FFFFFF')
                  .setBodyBorderColor('#B91C1C')
                  .setQuantityBackgroundColor('#B91C1C')
                  .setQuantityTextColor('#FFFFFF')
                  .setCancelButtonBackgroundColor('#B91C1C')
                  .setCancelButtonIconColor('#FFFFFF')
                  .onMove(() => {
                    const newPrice = order.getPrice();
                    if (newPrice && newPrice > 0) {
                      order.setText('🛑 STOP LOSS: ₹' + newPrice.toFixed(2));
                      if (currentActiveSl) currentActiveSl.price = newPrice;
                      window.dispatchEvent(new CustomEvent('FSM_SL_DRAGGED', { detail: { price: newPrice } }));
                    }
                  })
                  .onCancel(() => {
                    activeOrderLine = null;
                    currentActiveSl = null;
                    window.dispatchEvent(new CustomEvent('FSM_SL_CANCELLED'));
                  });
                activeOrderLine = order;
              }
            }
          } catch(err) {}
        }

        // Remove Stop Loss
        async function removeStopLoss() {
          const slId = currentActiveSl ? ('FSM_SL_' + (currentActiveSl.symbol || 'MAIN')) : 'FSM_SL_MAIN';
          currentActiveSl = null;

          if (window.broker && window.broker._host && typeof window.broker._host.orderUpdate === 'function') {
            try {
              window.broker._host.orderUpdate({
                id: slId,
                status: 1 // OrderStatus.Canceled
              });
            } catch(e) {}
          }

          if (activeOrderLine) {
            try { activeOrderLine.remove(); } catch(e) {}
            activeOrderLine = null;
          }
        }

        // -------------------------------------------------------------
        // EXECUTION MARKER ON CHART
        // -------------------------------------------------------------
        async function placeMarker(side, price, text, qty, time) {
          const res = await waitForBrokerOrChart(15000);
          if (!price || price <= 0) return;

          let chart = null;
          if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
            chart = window.tvWidget.activeChart();
          }

          // Compute accurate candle time
          let markerTime = time;
          if (!markerTime && chart) {
            try {
              const vr = chart.getVisibleRange();
              if (vr && vr.to) markerTime = Math.floor(vr.to) - 60;
            } catch(e) {}
          }
          if (!markerTime) markerTime = Math.floor(Date.now() / 1000);

          try {
            if (chart && typeof chart.createExecutionShape === 'function') {
              const exec = await chart.createExecutionShape();
              exec.setTime(markerTime)
                .setPrice(price)
                .setDirection(side.toLowerCase() === 'buy' ? 'buy' : 'sell')
                .setText(text || (side.toUpperCase() + ' ' + (qty || '') + ' @ ₹' + price.toFixed(2)))
                .setArrowColor(side.toLowerCase() === 'buy' ? '#00E676' : '#FF5252')
                .setTextColor(side.toLowerCase() === 'buy' ? '#00E676' : '#FF5252');
              createdShapes.push(exec);
              console.log('[ScalpMaster Bridge] Execution marker placed:', text || side, '@', price);
            } else if (chart && typeof chart.createShape === 'function') {
              const shapeId = await chart.createShape(
                { time: markerTime, price: price },
                {
                  shape: side.toLowerCase() === 'buy' ? 'arrow_up' : 'arrow_down',
                  text: text || (side.toUpperCase() + ' @ ₹' + price.toFixed(2)),
                  overrides: {
                    color: side.toLowerCase() === 'buy' ? '#00E676' : '#FF5252',
                    fontsize: 11
                  }
                }
              );
              createdShapes.push({ remove: () => chart.removeEntity(shapeId) });
            } else if (window.broker && window.broker._host && typeof window.broker._host.executionUpdate === 'function') {
              // Native Broker execution event
              window.broker._host.executionUpdate({
                id: 'FSM_EXEC_' + Date.now(),
                price: price,
                time: markerTime,
                side: side.toLowerCase() === 'buy' ? 1 : -1,
                qty: qty || 1
              });
            }
          } catch(err) {
            console.warn('[ScalpMaster Bridge] Marker error:', err);
          }
        }

        // -------------------------------------------------------------
        // EVENT LISTENERS
        // -------------------------------------------------------------
        window.addEventListener('FSM_CHART_POS_UPDATE', (e) => {
          updateNativePosition(e.detail);
        });

        window.addEventListener('FSM_CHART_SET_SL', (e) => {
          const { price, qty, symbol, side } = e.detail || {};
          renderStopLoss(price, qty, symbol, side);
        });

        window.addEventListener('FSM_CHART_ENSURE_SL', (e) => {
          const { price, qty, symbol, side } = e.detail || {};
          if (price && price > 0) {
            renderStopLoss(price, qty, symbol, side);
          }
        });

        window.addEventListener('FSM_CHART_REMOVE_SL', () => {
          removeStopLoss();
        });

        window.addEventListener('FSM_CHART_PLACE_MARKER', (e) => {
          const { side, price, text, qty, time } = e.detail || {};
          placeMarker(side, price, text, qty, time);
        });

        window.addEventListener('FSM_CHART_CLEAR_ALL', () => {
          updateNativePosition(null);
          removeStopLoss();
          createdShapes.forEach(s => {
            try { s.remove(); } catch(e) {}
          });
          createdShapes = [];
        });

        // Auto-reconnect on TradingView symbol or resolution switch
        function hookTvEvents() {
          if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
            try {
              const chart = window.tvWidget.activeChart();
              if (chart && chart.onSymbolChanged) {
                chart.onSymbolChanged().subscribe(null, () => {
                  if (currentActivePos) updateNativePosition(currentActivePos);
                  if (currentActiveSl) renderStopLoss(currentActiveSl.price, currentActiveSl.qty, currentActiveSl.symbol, currentActiveSl.side);
                });
              }
              if (chart && chart.onIntervalChanged) {
                chart.onIntervalChanged().subscribe(null, () => {
                  if (currentActivePos) updateNativePosition(currentActivePos);
                  if (currentActiveSl) renderStopLoss(currentActiveSl.price, currentActiveSl.qty, currentActiveSl.symbol, currentActiveSl.side);
                });
              }
            } catch(e) {}
          }
        }
        setTimeout(hookTvEvents, 3000);
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
  }

  injectChartBridge();

  // Listen to bridge events (e.g. user drags the SL line directly on the chart)
  window.addEventListener('FSM_SL_DRAGGED', (e) => {
    if (state.activePosition && e.detail && e.detail.price > 0) {
      state.activePosition.stopLoss = parseFloat(e.detail.price.toFixed(2));
      saveState();
      updateSlDisplay();
      showToast('Stop Loss dragged to ₹' + state.activePosition.stopLoss.toFixed(2));
    }
  });

  window.addEventListener('FSM_SL_CANCELLED', () => {
    if (state.activePosition) {
      state.activePosition.stopLoss = null;
      state.activePosition.slPoints = null;
      saveState();
      updateSlDisplay();
      showToast('Stop Loss cancelled');
    }
  });

  window.addEventListener('FSM_POS_CLOSE_CLICKED', () => {
    if (state.activePosition) {
      const currentPrice = state.ltp > 0 ? state.ltp : state.activePosition.entryPrice;
      state.dayStats.totalTrades += 1;
      closeActivePositionInternal(state.activePosition.qty, currentPrice, 'CHART EXIT');
      showToast(`Position squared off from Chart (Trade #${state.dayStats.totalTrades})`);
    }
  });

  // -------------------------------------------------------------
  // 2. STATE DEFINITION
  // -------------------------------------------------------------
  const STATE_KEY = 'fsm_state_v7';

  let state = {
    mode: 'PRACTICE',
    activeTab: 'position',
    symbol: '',
    symbolDesc: '',
    lotSize: 1,
    lots: 1,
    qty: 1,
    ltp: 0,
    prevLtp: 0,
    activePosition: null, // { symbol, side: 'BUY'|'SELL', qty, entryPrice, time, lastKnownLtp, stopLoss: null, slPoints: null }
    completedTrades: [],
    dayStats: {
      grossPnL: 0,
      totalCharges: 0,
      netPnL: 0,
      totalTrades: 0, // Counts EVERY executed order (Buy click = 1, Sell click = 2, etc.)
      completedRounds: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      peakPnL: 0,
      maxDrawdown: 0
    },
    hudVisible: true,
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

  // Toast
  function showToast(msg) {
    const toast = document.getElementById('fsm-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // Calculate Real FYERS Brokerage & Regulatory Charges
  function calculateTradeCharges(symbol, qty, buyPrice, sellPrice) {
    const s = (symbol || '').toUpperCase();
    const isOption = s.includes('CE') || s.includes('PE');
    const isFuture = s.includes('FUT');
    const buyTurnover = buyPrice * qty;
    const sellTurnover = sellPrice * qty;
    const totalTurnover = buyTurnover + sellTurnover;

    let brokerage = 0;
    let stt = 0;
    let exchangeCharge = 0;
    let stampDuty = 0;
    const sebiCharge = totalTurnover * 0.000001; // ₹10 per crore

    if (isOption) {
      brokerage = 40.0;
      stt = sellTurnover * 0.001;
      exchangeCharge = totalTurnover * 0.0005;
      stampDuty = buyTurnover * 0.00003;
    } else if (isFuture) {
      brokerage = Math.min(20, buyTurnover * 0.0003) + Math.min(20, sellTurnover * 0.0003);
      stt = sellTurnover * 0.0002;
      exchangeCharge = totalTurnover * 0.000019;
      stampDuty = buyTurnover * 0.00002;
    } else {
      brokerage = Math.min(20, buyTurnover * 0.0003) + Math.min(20, sellTurnover * 0.0003);
      stt = sellTurnover * 0.00025;
      exchangeCharge = totalTurnover * 0.0000325;
      stampDuty = buyTurnover * 0.00003;
    }

    const gst = (brokerage + exchangeCharge + sebiCharge) * 0.18;
    const totalCharges = parseFloat((brokerage + stt + exchangeCharge + gst + stampDuty + sebiCharge).toFixed(2));

    return {
      brokerage: parseFloat(brokerage.toFixed(2)),
      stt: parseFloat(stt.toFixed(2)),
      exchangeCharge: parseFloat(exchangeCharge.toFixed(2)),
      gst: parseFloat(gst.toFixed(2)),
      stampDuty: parseFloat(stampDuty.toFixed(2)),
      totalCharges
    };
  }

  // Load Saved State
  function loadState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STATE_KEY], (res) => {
        if (res && res[STATE_KEY]) {
          const saved = res[STATE_KEY];
          state.dayStats = saved.dayStats || state.dayStats;
          state.completedTrades = saved.completedTrades || [];
          state.chartMarkers = saved.chartMarkers || [];
          state.activePosition = saved.activePosition || null;
          state.lots = saved.lots || 1;
          state.lotSize = saved.lotSize && saved.lotSize > 1 ? saved.lotSize : state.lotSize;
          state.qty = (state.lots || 1) * (state.lotSize || 1);
          state.hudVisible = saved.hudVisible !== undefined ? saved.hudVisible : true;
          state.soundEnabled = saved.soundEnabled !== undefined ? saved.soundEnabled : true;
          state.minimized = !!saved.minimized;
          state.mode = saved.mode || 'PRACTICE';

          // Restore Position on chart
          if (state.activePosition) {
            window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', {
              detail: {
                symbol: state.activePosition.symbol,
                side: state.activePosition.side,
                qty: state.activePosition.qty,
                avgPrice: state.activePosition.entryPrice
              }
            }));
          }
          // Restore SL line on chart once chart is fully ready
          if (state.activePosition && state.activePosition.stopLoss) {
            restoreChartStopLoss(state.activePosition.stopLoss, state.activePosition.qty, state.activePosition.symbol, state.activePosition.side);
          }
          // Restore past execution markers on chart
          if (state.chartMarkers && state.chartMarkers.length > 0) {
            restoreChartMarkers();
          }
        }
        renderHUD();
      });
    } else {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          state.dayStats = saved.dayStats || state.dayStats;
          state.completedTrades = saved.completedTrades || [];
          state.chartMarkers = saved.chartMarkers || [];
          state.activePosition = saved.activePosition || null;
          state.lots = saved.lots || 1;
          state.lotSize = saved.lotSize && saved.lotSize > 1 ? saved.lotSize : state.lotSize;
          state.qty = (state.lots || 1) * (state.lotSize || 1);
          state.hudVisible = saved.hudVisible !== undefined ? saved.hudVisible : true;
          state.soundEnabled = saved.soundEnabled !== undefined ? saved.soundEnabled : true;
          state.minimized = !!saved.minimized;
          state.mode = saved.mode || 'PRACTICE';

          if (state.activePosition) {
            window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', {
              detail: {
                symbol: state.activePosition.symbol,
                side: state.activePosition.side,
                qty: state.activePosition.qty,
                avgPrice: state.activePosition.entryPrice
              }
            }));
          }
          if (state.activePosition && state.activePosition.stopLoss) {
            restoreChartStopLoss(state.activePosition.stopLoss, state.activePosition.qty, state.activePosition.symbol, state.activePosition.side);
          }
          if (state.chartMarkers && state.chartMarkers.length > 0) {
            restoreChartMarkers();
          }
        }
      } catch(e) {}
      renderHUD();
    }
  }

  // Helper to restore SL on initial load with repeated retries until TradingView is ready
  function restoreChartStopLoss(price, qty, symbol, side, attempts = 0) {
    if (attempts > 15) return;
    window.dispatchEvent(new CustomEvent('FSM_CHART_SET_SL', {
      detail: { price: price, qty: qty, symbol: symbol || (state.activePosition ? state.activePosition.symbol : ''), side: side || (state.activePosition ? state.activePosition.side : 'BUY') }
    }));
    if (attempts < 5) {
      setTimeout(() => {
        if (state.activePosition && state.activePosition.stopLoss) {
          restoreChartStopLoss(price, qty, symbol, side, attempts + 1);
        }
      }, 1200 + attempts * 800);
    }
  }

  // Restore Execution Markers on Chart
  function restoreChartMarkers(attempts = 0) {
    if (!state.chartMarkers || state.chartMarkers.length === 0 || attempts > 10) return;
    setTimeout(() => {
      state.chartMarkers.forEach(m => {
        window.dispatchEvent(new CustomEvent('FSM_CHART_PLACE_MARKER', { detail: m }));
      });
    }, 1500 + attempts * 1000);
  }

  // Record and Place Marker (Persisted)
  function recordAndPlaceExecutionMarker(side, price, text, qty) {
    state.chartMarkers = state.chartMarkers || [];
    const marker = {
      side: side,
      price: parseFloat(price.toFixed(2)),
      text: text,
      qty: qty,
      time: Math.floor(Date.now() / 1000)
    };
    state.chartMarkers.push(marker);
    if (state.chartMarkers.length > 50) {
      state.chartMarkers.shift();
    }
    window.dispatchEvent(new CustomEvent('FSM_CHART_PLACE_MARKER', { detail: marker }));
    saveState();
  }

  // Save State
  function saveState() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STATE_KEY]: state });
    }
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch(e) {}
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

  // Query FYERS Local IndexedDB for accurate master contract & lot size
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

          // Clean raw symbol
          const raw = (symbolKey || '').trim();
          const cleanNoEx = raw.replace(/^(NSE:|BSE:|MCX:)/i, '');

          const keysToTry = [
            'NSE:' + cleanNoEx,
            cleanNoEx,
            'BSE:' + cleanNoEx,
            'MCX:' + cleanNoEx,
            raw
          ];

          function tryLookup(idx) {
            if (idx >= keysToTry.length) return resolve(null);
            const getReq = store.get(keysToTry[idx]);
            getReq.onsuccess = () => {
              const res = getReq.result;
              if (res) {
                const ls = res.lot_size || res.min_lot_size || res.min_lot || res.lotsize;
                if (ls && Number(ls) > 0) {
                  return resolve({
                    ...res,
                    lot_size: Number(ls),
                    description: res.description || res.short_name || res.name || ''
                  });
                }
              }
              tryLookup(idx + 1);
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

  // Fallback Lot Sizes (Regulatory standard exchange lot sizes)
  function inferLotSize(symbol) {
    const s = (symbol || '').toUpperCase();
    if (s.includes('BANKNIFTY')) return 15;
    if (s.includes('FINNIFTY')) return 25;
    if (s.includes('MIDCPNIFTY')) return 50;
    if (s.includes('NIFTY') && (s.includes('PE') || s.includes('CE') || s.includes('FUT') || s.includes('26') || s.includes('25') || s.includes('24'))) return 65;
    if (s.includes('SENSEX')) return 10;
    if (s.includes('BANKEX')) return 15;
    if (s.includes('CRUDEOIL')) return 100;
    if (s.includes('NATURALGAS')) return 1250;
    if (s.includes('GOLDM')) return 10;
    if (s.includes('SILVERM')) return 5;
    return 1;
  }

  // Helper to normalize symbol strings for robust comparison
  function normalizeSymbolName(s) {
    if (!s) return '';
    return String(s)
      .trim()
      .toUpperCase()
      .replace(/^(NSE:|BSE:|MCX:)/i, '')
      .replace(/[-\s_]/g, '');
  }

  // Symbol Update Handler
  let lastCheckedSymbol = '';
  async function handleSymbolUpdate(newSymbol, force = false) {
    if (!newSymbol) return;
    if (!force && newSymbol === lastCheckedSymbol && state.lotSize > 1) return;
    lastCheckedSymbol = newSymbol;
    state.symbol = newSymbol;

    const dbRecord = await querySymbolIndexedDB(newSymbol);
    if (dbRecord && dbRecord.lot_size) {
      state.lotSize = Number(dbRecord.lot_size);
      state.symbolDesc = dbRecord.description || dbRecord.short_name || '';
      console.log(`[ScalpMaster] Retrieved lot size from IndexedDB for ${newSymbol}: ${state.lotSize}`);
    } else {
      state.lotSize = inferLotSize(newSymbol);
      state.symbolDesc = newSymbol.includes('PE') ? 'Put Option' : newSymbol.includes('CE') ? 'Call Option' : (newSymbol.includes('FUT') ? 'Futures' : 'Chart Instrument');
      console.log(`[ScalpMaster] Inferred lot size for ${newSymbol}: ${state.lotSize}`);
    }

    state.qty = (state.lots || 1) * (state.lotSize || 1);

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
    renderHUD();
  }

  // -------------------------------------------------------------
  // 3. REAL-TIME SCRAPING & AUTO STOP LOSS CHECK LOOP
  // -------------------------------------------------------------
  let lastSlEnsureTime = 0;

  function ensureSlOnChartPeriodic() {
    if (!state.activePosition || !state.activePosition.stopLoss) return;
    const now = Date.now();
    if (now - lastSlEnsureTime > 2500) {
      lastSlEnsureTime = now;
      window.dispatchEvent(new CustomEvent('FSM_CHART_ENSURE_SL', {
        detail: {
          price: state.activePosition.stopLoss,
          qty: state.activePosition.qty
        }
      }));
    }
  }

  function updateChartMismatchWarning(show, chartSymbol, lockedSymbol) {
    let warnEl = document.getElementById('fsm-chart-mismatch-warn');
    if (show) {
      if (!warnEl) {
        warnEl = document.createElement('div');
        warnEl.id = 'fsm-chart-mismatch-warn';
        warnEl.className = 'fsm-chart-warning';
        const header = document.querySelector('.fsm-header');
        if (header && header.parentNode) {
          header.insertAdjacentElement('afterend', warnEl);
        }
      }
      warnEl.innerHTML = `⚠️ Chart: <b>${chartSymbol}</b> | Trade Locked: <b>${lockedSymbol}</b>`;
      warnEl.style.display = 'flex';
    } else if (warnEl) {
      warnEl.style.display = 'none';
    }
  }

  function hideChartMismatchWarning() {
    const warnEl = document.getElementById('fsm-chart-mismatch-warn');
    if (warnEl) warnEl.style.display = 'none';
  }

  function scrapeActiveMarketData() {
    try {
      let detectedPrice = null;
      let detectedSymbol = null;

      // 1. From document.title (fastest, zero-DOM overhead)
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
              const buyBtnPrice = activeChart.querySelector('[data-name="buy-order-button"] .buttonText-hw_3o_pb') ||
                                  activeChart.querySelector('[data-name="buy-order-button"] [class*="buttonText"]');
              if (buyBtnPrice && buyBtnPrice.innerText) {
                const bp = parseFloat(buyBtnPrice.innerText.replace(/,/g, '').trim());
                if (!isNaN(bp) && bp > 0) detectedPrice = bp;
              }
            }
          }
        }
      }

      // -----------------------------------------------------------
      // REQUIREMENT 5: STRICT SYMBOL LOCK DURING ACTIVE TRADE
      // -----------------------------------------------------------
      const isTradeActive = !!(state.activePosition && state.activePosition.symbol);

      if (isTradeActive) {
        const lockedSymbol = state.activePosition.symbol;
        if (state.symbol !== lockedSymbol) {
          state.symbol = lockedSymbol;
          const symEl = document.querySelector('.fsm-symbol-name');
          if (symEl) symEl.textContent = lockedSymbol;
        }

        // Compare using normalized names (e.g. "NSE:NIFTY26N0322900CE" vs "NIFTY26N0322900CE")
        const normDetected = normalizeSymbolName(detectedSymbol);
        const normLocked = normalizeSymbolName(lockedSymbol);
        const matchesActive = (!detectedSymbol || normDetected === normLocked);

        if (matchesActive && detectedPrice !== null && !isNaN(detectedPrice) && detectedPrice > 0) {
          state.prevLtp = state.ltp || detectedPrice;
          state.ltp = detectedPrice;
          state.activePosition.lastKnownLtp = detectedPrice;
          renderLtpTick();
        }

        // Show warning ONLY IF the user truly switched to another instrument
        const isOffChart = !!(detectedSymbol && normDetected !== normLocked);
        updateChartMismatchWarning(isOffChart, detectedSymbol, lockedSymbol);
      } else {
        // Flat (No active trade): freely adopt whichever chart instrument is focused
        hideChartMismatchWarning();
        if (detectedSymbol && normalizeSymbolName(detectedSymbol) !== normalizeSymbolName(state.symbol)) {
          handleSymbolUpdate(detectedSymbol);
        }
        if (detectedPrice !== null && !isNaN(detectedPrice) && detectedPrice > 0) {
          state.prevLtp = state.ltp || detectedPrice;
          state.ltp = detectedPrice;
          renderLtpTick();
        }
      }

      // Check Stop Loss auto-trigger
      checkStopLossTrigger();
      updatePnLDisplay();

      // Ensure Stop Loss is actively rendered on chart
      ensureSlOnChartPeriodic();
    } catch (err) {
      // Catch all to ensure scrape loop never terminates
      console.warn('[ScalpMaster Scraper]', err);
    }
  }

  // Check Stop Loss Trigger
  function checkStopLossTrigger() {
    if (!state.activePosition || !state.activePosition.stopLoss) return;

    if (state.symbol && state.activePosition.symbol && state.symbol !== state.activePosition.symbol) {
      return;
    }

    const currentPrice = state.ltp;
    if (!currentPrice || currentPrice <= 0) return;

    const sl = state.activePosition.stopLoss;

    if (state.activePosition.side === 'BUY') {
      if (currentPrice <= sl) {
        triggerAutoStopLossExit(currentPrice);
      }
    } else if (state.activePosition.side === 'SELL') {
      if (currentPrice >= sl) {
        triggerAutoStopLossExit(currentPrice);
      }
    }
  }

  // Trigger Automatic Stop Loss Square Off
  function triggerAutoStopLossExit(triggerPrice) {
    if (!state.activePosition) return;
    const pos = state.activePosition;
    showToast(`🛑 STOP LOSS HIT @ ₹${triggerPrice.toFixed(2)}! Auto-Closing...`);

    // Place exit marker on chart (recorded and persisted)
    recordAndPlaceExecutionMarker(
      pos.side === 'BUY' ? 'sell' : 'buy',
      triggerPrice,
      `SL HIT @ ₹${triggerPrice.toFixed(2)}`,
      pos.qty
    );

    // Remove SL Line from chart
    window.dispatchEvent(new CustomEvent('FSM_CHART_REMOVE_SL'));

    // Count this exit order as a trade!
    state.dayStats.totalTrades += 1;

    // Close position
    closeActivePositionInternal(pos.qty, triggerPrice, 'STOP LOSS');
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

  // Calculate Unrealized PnL of Open Position
  function calculateCurrentPnL() {
    if (!state.activePosition) return { pnl: 0, points: 0, charges: 0, netPnl: 0 };

    let currentPrice = state.ltp;
    if (state.symbol && state.activePosition.symbol && state.symbol !== state.activePosition.symbol) {
      currentPrice = state.activePosition.lastKnownLtp || state.activePosition.entryPrice;
    } else {
      state.activePosition.lastKnownLtp = currentPrice;
    }

    if (!currentPrice || currentPrice <= 0) return { pnl: 0, points: 0, charges: 0, netPnl: 0 };

    const entryPrice = state.activePosition.entryPrice;
    const qty = state.activePosition.qty;

    let points = 0;
    let buyPrice = 0;
    let sellPrice = 0;

    if (state.activePosition.side === 'BUY') {
      points = currentPrice - entryPrice;
      buyPrice = entryPrice;
      sellPrice = currentPrice;
    } else {
      points = entryPrice - currentPrice;
      buyPrice = currentPrice;
      sellPrice = entryPrice;
    }

    const pnl = points * qty;
    const chargeInfo = calculateTradeCharges(state.activePosition.symbol, qty, buyPrice, sellPrice);
    const netPnl = pnl - chargeInfo.totalCharges;

    return {
      pnl,
      points,
      charges: chargeInfo.totalCharges,
      netPnl
    };
  }

  // Update Dynamic PnL Display
  function updatePnLDisplay() {
    const { pnl, points, charges, netPnl } = calculateCurrentPnL();

    const liveGrossDayPnL = state.dayStats.grossPnL + pnl;
    const liveTotalCharges = state.dayStats.totalCharges + (state.activePosition ? charges : 0);
    const liveNetDayPnL = liveGrossDayPnL - liveTotalCharges;

    const dayPnlEl = document.getElementById('fsm-day-pnl-val');
    if (dayPnlEl) {
      const sign = liveNetDayPnL >= 0 ? '+' : '';
      dayPnlEl.textContent = `${sign}₹${liveNetDayPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      dayPnlEl.className = 'fsm-day-pnl-value ' + (liveNetDayPnL > 0 ? 'fsm-pnl-positive' : liveNetDayPnL < 0 ? 'fsm-pnl-negative' : '');
    }

    const grossEl = document.getElementById('fsm-day-gross');
    const chargesEl = document.getElementById('fsm-day-charges');
    if (grossEl && chargesEl) {
      const gSign = liveGrossDayPnL >= 0 ? '+' : '';
      grossEl.textContent = `Gross: ${gSign}₹${liveGrossDayPnL.toFixed(2)}`;
      grossEl.style.color = liveGrossDayPnL > 0 ? '#34d399' : liveGrossDayPnL < 0 ? '#f87171' : '#94a3b8';
      chargesEl.textContent = `Charges: ₹${liveTotalCharges.toFixed(2)}`;
    }

    const activePnlEl = document.getElementById('fsm-active-pnl-val');
    if (activePnlEl && state.activePosition) {
      const sign = pnl >= 0 ? '+' : '';
      activePnlEl.innerHTML = `
        <span class="${pnl >= 0 ? 'fsm-pnl-positive' : 'fsm-pnl-negative'}">${sign}₹${pnl.toFixed(2)} (${points >= 0 ? '+' : ''}${points.toFixed(2)} pts)</span>
        <span style="font-size: 10px; color: var(--fsm-text-muted); font-weight: 500; display: block; margin-top: 1px;">
          Est. Charges: ₹${charges.toFixed(2)} | Net: ${netPnl >= 0 ? '+' : ''}₹${netPnl.toFixed(2)}
        </span>
      `;
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

  // Update Stop Loss Display in HUD
  function updateSlDisplay() {
    const slPriceEl = document.getElementById('fsm-sl-price-val');
    if (slPriceEl) {
      if (state.activePosition && state.activePosition.stopLoss) {
        slPriceEl.textContent = '₹' + state.activePosition.stopLoss.toFixed(2);
      } else {
        slPriceEl.textContent = 'None';
      }
    }
    document.querySelectorAll('.fsm-sl-btn').forEach(btn => {
      const pts = parseFloat(btn.dataset.pts);
      if (state.activePosition && state.activePosition.slPoints === pts) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // -------------------------------------------------------------
  // 4. ORDER EXECUTION & EVERY-TRADE COUNTING LOGIC
  // -------------------------------------------------------------

  function handleTradeButtonClick(side) {
    initAudio();

    if (state.activePosition && state.activePosition.symbol && normalizeSymbolName(state.symbol) !== normalizeSymbolName(state.activePosition.symbol)) {
      showToast(`⚠️ Trade locked on ${state.activePosition.symbol}! Square it off first.`);
      playSound('LOSS');
      return;
    }

    const currentPrice = state.ltp > 0 ? state.ltp : 100.00;
    const qty = state.qty > 0 ? state.qty : state.lotSize;
    const nowStr = new Date().toLocaleTimeString();

    // EVERY-TRADE COUNT: increments by 1 on every executed order
    state.dayStats.totalTrades += 1;

    // Case 1: Currently FLAT (No open position) -> Open fresh position
    if (!state.activePosition) {
      state.activePosition = {
        symbol: state.symbol,
        side: side,
        qty: qty,
        entryPrice: currentPrice,
        lastKnownLtp: currentPrice,
        time: nowStr,
        stopLoss: null,
        slPoints: null
      };

      // Place execution marker on chart
      recordAndPlaceExecutionMarker(
        side,
        currentPrice,
        `${side} ${qty} @ ₹${currentPrice.toFixed(2)}`,
        qty
      );

      // Update Native TradingView Broker Position Line
      window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', {
        detail: {
          symbol: state.symbol,
          side: side,
          qty: qty,
          avgPrice: currentPrice
        }
      }));

      playSound(side);
      showToast(`${side} ${qty} ${state.symbol} @ ₹${currentPrice.toFixed(2)} (Trade #${state.dayStats.totalTrades})`);
      logAnalyticsEvent('scalp_order_executed', {
        side: side,
        symbol: state.symbol || 'UNKNOWN',
        qty: qty
      });
      saveState();
      renderHUD();
      return;
    }

    // Case 2: Adding to SAME DIRECTION position
    if (state.activePosition.side === side) {
      const totalQty = state.activePosition.qty + qty;
      const avgPrice = ((state.activePosition.entryPrice * state.activePosition.qty) + (currentPrice * qty)) / totalQty;
      state.activePosition.qty = totalQty;
      state.activePosition.entryPrice = parseFloat(avgPrice.toFixed(2));

      recordAndPlaceExecutionMarker(
        side,
        currentPrice,
        `ADD ${qty} @ ₹${currentPrice.toFixed(2)}`,
        qty
      );

      // Update Native TradingView Broker Position Line
      window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', {
        detail: {
          symbol: state.activePosition.symbol,
          side: side,
          qty: totalQty,
          avgPrice: state.activePosition.entryPrice
        }
      }));

      if (state.activePosition.stopLoss) {
        window.dispatchEvent(new CustomEvent('FSM_CHART_SET_SL', {
          detail: { price: state.activePosition.stopLoss, qty: totalQty, symbol: state.activePosition.symbol, side: state.activePosition.side }
        }));
      }

      showToast(`Added ${qty} to ${side}. Total: ${totalQty} @ Avg ₹${state.activePosition.entryPrice.toFixed(2)} (Trade #${state.dayStats.totalTrades})`);
      saveState();
      renderHUD();
      return;
    }

    // Case 3: OPPOSITE BUTTON PRESSED -> REDUCE / CLOSE
    const openQty = state.activePosition.qty;
    const closeQty = Math.min(openQty, qty);

    recordAndPlaceExecutionMarker(
      side,
      currentPrice,
      `CLOSE ${closeQty} @ ₹${currentPrice.toFixed(2)}`,
      closeQty
    );

    if (closeQty >= openQty) {
      // Full close -> Position becomes FLAT
      closeActivePositionInternal(openQty, currentPrice, 'MANUAL EXIT');
      showToast(`Closed full ${state.activePosition ? state.activePosition.side : 'trade'} (${openQty} Qty) (Trade #${state.dayStats.totalTrades})`);
    } else {
      // Partial close -> Reduce quantity by selected qty
      closeActivePositionInternal(closeQty, currentPrice, 'PARTIAL EXIT');
      const remainingQty = openQty - closeQty;
      state.activePosition.qty = remainingQty;

      if (state.activePosition.stopLoss) {
        window.dispatchEvent(new CustomEvent('FSM_CHART_SET_SL', {
          detail: { price: state.activePosition.stopLoss, qty: remainingQty, symbol: state.activePosition.symbol, side: state.activePosition.side }
        }));
      }

      // Update Native TradingView Broker Position Line
      window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', {
        detail: {
          symbol: state.activePosition.symbol,
          side: state.activePosition.side,
          qty: remainingQty,
          avgPrice: state.activePosition.entryPrice
        }
      }));

      showToast(`Closed ${closeQty} Qty. Remaining: ${remainingQty} Qty (Trade #${state.dayStats.totalTrades})`);
      saveState();
      renderHUD();
    }
  }

  // Internal Position Closer
  function closeActivePositionInternal(closeQty, exitPrice, reason) {
    if (!state.activePosition) return;
    initAudio();

    const entryPrice = state.activePosition.entryPrice;
    const isBuy = state.activePosition.side === 'BUY';
    const nowStr = new Date().toLocaleTimeString();

    let points = 0;
    let buyPrice = 0;
    let sellPrice = 0;

    if (isBuy) {
      points = exitPrice - entryPrice;
      buyPrice = entryPrice;
      sellPrice = exitPrice;
    } else {
      points = entryPrice - exitPrice;
      buyPrice = exitPrice;
      sellPrice = entryPrice;
    }

    const grossPnl = parseFloat((points * closeQty).toFixed(2));
    const chargeInfo = calculateTradeCharges(state.activePosition.symbol, closeQty, buyPrice, sellPrice);
    const charges = chargeInfo.totalCharges;
    const netPnl = parseFloat((grossPnl - charges).toFixed(2));

    const trade = {
      id: Date.now(),
      symbol: state.activePosition.symbol,
      side: state.activePosition.side,
      qty: closeQty,
      buyPrice: parseFloat(buyPrice.toFixed(2)),
      sellPrice: parseFloat(sellPrice.toFixed(2)),
      entryPrice: entryPrice,
      exitPrice: exitPrice,
      entryTime: state.activePosition.time,
      exitTime: nowStr,
      points: parseFloat(points.toFixed(2)),
      grossPnl: grossPnl,
      charges: charges,
      netPnl: netPnl,
      isWin: netPnl > 0,
      reason: reason || 'EXIT'
    };

    state.completedTrades.unshift(trade);
    state.dayStats.completedRounds = (state.dayStats.completedRounds || 0) + 1;
    state.dayStats.grossPnL = parseFloat((state.dayStats.grossPnL + grossPnl).toFixed(2));
    state.dayStats.totalCharges = parseFloat((state.dayStats.totalCharges + charges).toFixed(2));
    state.dayStats.netPnL = parseFloat((state.dayStats.grossPnL - state.dayStats.totalCharges).toFixed(2));

    if (netPnl > 0) {
      state.dayStats.wins += 1;
      playSound('WIN');
    } else if (netPnl < 0) {
      state.dayStats.losses += 1;
      playSound('LOSS');
    }

    state.dayStats.winRate = Math.round((state.dayStats.wins / state.dayStats.completedRounds) * 100);

    if (state.dayStats.netPnL > state.dayStats.peakPnL) {
      state.dayStats.peakPnL = state.dayStats.netPnL;
    }
    const currentDrawdown = state.dayStats.peakPnL - state.dayStats.netPnL;
    if (currentDrawdown > state.dayStats.maxDrawdown) {
      state.dayStats.maxDrawdown = currentDrawdown;
    }

    // If all qty closed, clean up active position & remove SL line from chart
    if (closeQty >= state.activePosition.qty) {
      state.activePosition = null;
      window.dispatchEvent(new CustomEvent('FSM_CHART_POS_UPDATE', { detail: null }));
      window.dispatchEvent(new CustomEvent('FSM_CHART_REMOVE_SL'));
    }

    saveState();
    renderHUD();
  }

  // Set Stop Loss by Points (Always cleanly recreates full-width draggable line on TV chart)
  function setStopLossByPoints(points) {
    if (!state.activePosition) return;
    const entryPrice = state.activePosition.entryPrice;
    let slPrice = 0;

    if (state.activePosition.side === 'BUY') {
      slPrice = Math.max(0.05, entryPrice - points);
    } else {
      slPrice = entryPrice + points;
    }

    slPrice = parseFloat(slPrice.toFixed(2));
    state.activePosition.stopLoss = slPrice;
    state.activePosition.slPoints = points;

    // Dispatch fresh event to TradingView Chart Bridge
    window.dispatchEvent(new CustomEvent('FSM_CHART_SET_SL', {
      detail: { price: slPrice, qty: state.activePosition.qty, symbol: state.activePosition.symbol, side: state.activePosition.side }
    }));

    showToast(`Stop Loss placed at ₹${slPrice.toFixed(2)} (${points} pts)`);
    saveState();
    updateSlDisplay();
  }

  // Set Stop Loss by Explicit Price (Manual Input)
  function setStopLossExplicitPrice(price) {
    if (!state.activePosition) return;
    const entryPrice = state.activePosition.entryPrice;
    price = parseFloat(price);
    if (isNaN(price) || price <= 0) return;
    price = parseFloat(price.toFixed(2));

    let pts = 0;
    if (state.activePosition.side === 'BUY') {
      pts = Math.max(0, entryPrice - price);
    } else {
      pts = Math.max(0, price - entryPrice);
    }

    state.activePosition.stopLoss = price;
    state.activePosition.slPoints = parseFloat(pts.toFixed(2));

    // Dispatch fresh event to TradingView Chart Bridge
    window.dispatchEvent(new CustomEvent('FSM_CHART_SET_SL', {
      detail: { price: price, qty: state.activePosition.qty, symbol: state.activePosition.symbol, side: state.activePosition.side }
    }));

    showToast(`Stop Loss placed at ₹${price.toFixed(2)} (${pts > 0 ? pts.toFixed(1) + ' pts' : 'Manual'})`);
    saveState();
    updateSlDisplay();
  }

  // Clear Stop Loss
  function clearStopLoss() {
    if (!state.activePosition) return;
    state.activePosition.stopLoss = null;
    state.activePosition.slPoints = null;
    window.dispatchEvent(new CustomEvent('FSM_CHART_REMOVE_SL'));
    showToast('Stop Loss removed');
    saveState();
    updateSlDisplay();
  }

  // Reset Today
  function resetDayStats() {
    if (confirm("Reset today's practice statistics and completed trade log?")) {
      state.activePosition = null;
      state.completedTrades = [];
      state.chartMarkers = [];
      state.dayStats = {
        grossPnL: 0,
        totalCharges: 0,
        netPnL: 0,
        totalTrades: 0,
        completedRounds: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        peakPnL: 0,
        maxDrawdown: 0
      };
      window.dispatchEvent(new CustomEvent('FSM_CHART_CLEAR_ALL'));
      saveState();
      renderHUD();
      showToast('Daily stats and markers reset successfully');
    }
  }

  // -------------------------------------------------------------
  // 5. BUILD & RENDER HUD DOM
  // -------------------------------------------------------------
  function renderHUD() {
    let container = document.getElementById('fyers-scalpmaster-hud');
    if (!container) {
      container = document.createElement('div');
      container.id = 'fyers-scalpmaster-hud';
      document.body.appendChild(container);
      setupDrag(container);
    }

    if (state.hudVisible === false) {
      container.classList.add('fsm-hidden');
      container.style.setProperty('display', 'none', 'important');
    } else {
      container.classList.remove('fsm-hidden');
      container.style.setProperty('display', 'block', 'important');
    }

    if (state.minimized) {
      container.classList.add('fsm-minimized');
    } else {
      container.classList.remove('fsm-minimized');
    }

    const { pnl, charges } = calculateCurrentPnL();
    const liveGrossDayPnL = state.dayStats.grossPnL + pnl;
    const liveTotalCharges = state.dayStats.totalCharges + (state.activePosition ? charges : 0);
    const liveNetDayPnL = liveGrossDayPnL - liveTotalCharges;
    const daySign = liveNetDayPnL >= 0 ? '+' : '';

    const isLockedToOther = state.activePosition && state.activePosition.symbol && normalizeSymbolName(state.symbol) !== normalizeSymbolName(state.activePosition.symbol);

    container.innerHTML = `
      <!-- Header -->
      <div class="fsm-header" id="fsm-drag-handle">
        <div class="fsm-title">
          <span>⚡ ScalpMaster</span>
          <span class="fsm-badge ${state.mode === 'PRACTICE' ? 'fsm-badge-practice' : 'fsm-badge-live'}" id="fsm-toggle-mode">
            ${state.mode === 'PRACTICE' ? 'PRACTICE' : 'LIVE DOM'}
          </span>
        </div>
        <div class="fsm-controls">
          <button class="fsm-icon-btn" id="fsm-refresh-btn" title="Refresh Instrument, Lot Size & LTP">🔄</button>
          <button class="fsm-icon-btn" id="fsm-sound-btn" title="Toggle Sound">${state.soundEnabled ? '🔔' : '🔕'}</button>
          <button class="fsm-icon-btn" id="fsm-min-btn" title="Minimize / Expand">${state.minimized ? '🗖' : '🗕'}</button>
        </div>
      </div>

      <div class="fsm-body">
        <!-- Locked Warning Banner -->
        ${isLockedToOther ? `
          <div class="fsm-locked-banner">
            <span>🔒</span>
            <span>Open position on <b>${state.activePosition.symbol}</b>. Square off to trade this chart.</span>
          </div>
        ` : ''}

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

        <!-- Day Net P&L Summary (Gross, Charges, Net) -->
        <div class="fsm-day-pnl-card">
          <div class="fsm-day-pnl-label">Day Net P&amp;L (After Brokerage &amp; Taxes)</div>
          <div class="fsm-day-pnl-value ${liveNetDayPnL > 0 ? 'fsm-pnl-positive' : liveNetDayPnL < 0 ? 'fsm-pnl-negative' : ''}" id="fsm-day-pnl-val">
            ${daySign}₹${liveNetDayPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div class="fsm-breakdown-row">
            <span id="fsm-day-gross" style="color: ${liveGrossDayPnL > 0 ? '#34d399' : liveGrossDayPnL < 0 ? '#f87171' : '#94a3b8'};">
              Gross: ${liveGrossDayPnL >= 0 ? '+' : ''}₹${liveGrossDayPnL.toFixed(2)}
            </span>
            <span id="fsm-day-charges" style="color: #f59e0b;">
              Charges: ₹${liveTotalCharges.toFixed(2)}
            </span>
          </div>
          <div class="fsm-stats-grid">
            <div class="fsm-stat-item" title="Every executed order counted: Buy = 1, Sell/Exit = 2, etc.">
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

        <!-- Sleek Small Scalping Trade Buttons (Partial Close & Lock Logic) -->
        <div class="fsm-trade-btns">
          <button class="fsm-btn-small fsm-btn-buy" id="fsm-buy-btn" ${isLockedToOther ? 'disabled title="Locked to ' + state.activePosition.symbol + '"' : ''}>
            <span>${state.activePosition && state.activePosition.side === 'SELL' ? 'BUY TO COVER' : 'BUY'}</span>
          </button>
          <button class="fsm-btn-small fsm-btn-sell" id="fsm-btn-sell" ${isLockedToOther ? 'disabled title="Locked to ' + state.activePosition.symbol + '"' : ''}>
            <span>${state.activePosition && state.activePosition.side === 'BUY' ? 'SELL TO CLOSE' : 'SELL'}</span>
          </button>
        </div>

        <!-- Full Square Off Button -->
        <div class="fsm-action-strip">
          <button class="fsm-btn-exit" id="fsm-exit-btn" ${!state.activePosition ? 'disabled' : ''}>
            SQUARE OFF ALL
          </button>
        </div>

        <!-- Navigation Tabs: Active Position vs Trade Log -->
        <div class="fsm-tab-nav">
          <div class="fsm-tab ${state.activeTab === 'position' ? 'active' : ''}" id="fsm-tab-pos">Active Position</div>
          <div class="fsm-tab ${state.activeTab === 'history' ? 'active' : ''}" id="fsm-tab-hist">Trade Log (${state.completedTrades.length})</div>
        </div>

        <!-- Tab 1: Active Position Card (with Stop Loss controls) -->
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

              <!-- Stop Loss Section -->
              <div class="fsm-sl-section">
                <div class="fsm-sl-header">
                  <span class="fsm-sl-label">🛑 STOP LOSS</span>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <span class="fsm-sl-price" id="fsm-sl-price-val">
                      ${state.activePosition.stopLoss ? '₹' + state.activePosition.stopLoss.toFixed(2) : 'None'}
                    </span>
                    ${state.activePosition.stopLoss ? '<button class="fsm-sl-clear" id="fsm-sl-clear-btn" title="Remove SL">✕</button>' : ''}
                  </div>
                </div>
                <!-- Quick Points Buttons -->
                <div class="fsm-sl-controls">
                  <button class="fsm-sl-btn ${state.activePosition.slPoints === 5 ? 'active' : ''}" data-pts="5">5 pts</button>
                  <button class="fsm-sl-btn ${state.activePosition.slPoints === 10 ? 'active' : ''}" data-pts="10">10 pts</button>
                  <button class="fsm-sl-btn ${state.activePosition.slPoints === 15 ? 'active' : ''}" data-pts="15">15 pts</button>
                  <button class="fsm-sl-btn ${state.activePosition.slPoints === 20 ? 'active' : ''}" data-pts="20">20 pts</button>
                  <span style="font-size: 8px; color: var(--fsm-text-muted); margin-left: auto;">(Draggable)</span>
                </div>
                <!-- Manual SL Input Option -->
                <div class="fsm-sl-manual-row">
                  <div class="fsm-sl-manual-input-wrap">
                    <span class="fsm-sl-manual-curr">₹</span>
                    <input type="number" step="0.05" id="fsm-sl-manual-input" class="fsm-sl-input" placeholder="Manual SL Price..." value="${state.activePosition.stopLoss ? state.activePosition.stopLoss.toFixed(2) : ''}" />
                  </div>
                  <button id="fsm-sl-manual-set-btn" class="fsm-btn-manual-sl">SET SL</button>
                </div>
              </div>
            </div>
          ` : `
            <div class="fsm-no-pos">Flat. Click BUY or SELL to scalp!</div>
          `}
        </div>

        <!-- Tab 2: Trade Log with Detailed Buy/Sell Prices, Gross P&L, Charges, and Net P&L -->
        <div id="fsm-tab-content-hist" style="display: ${state.activeTab === 'history' ? 'block' : 'none'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 10px; color: var(--fsm-text-muted);">Completed Scalps &amp; Charges</span>
            <button id="fsm-reset-btn" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 10px; text-decoration: underline;">Reset Day</button>
          </div>
          <div class="fsm-orders-list">
            ${state.completedTrades.length === 0 ? `
              <div style="text-align: center; color: var(--fsm-text-muted); padding: 8px; font-size: 10px;">No completed scalps yet.</div>
            ` : state.completedTrades.map(t => `
              <div class="fsm-order-card">
                <div class="fsm-order-top">
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <span class="fsm-order-side ${t.side === 'BUY' ? 'fsm-type-long' : 'fsm-type-short'}">${t.side}</span>
                    <span style="font-weight: 700; font-size: 11px;">${t.qty} Qty</span>
                    ${t.reason ? `<span style="font-size: 8px; background: rgba(255,255,255,0.08); padding: 1px 3px; border-radius: 2px;">${t.reason}</span>` : ''}
                  </div>
                  <div style="font-weight: 800; font-size: 12px; color: ${t.netPnl >= 0 ? '#34d399' : '#f87171'};">
                    Net: ${t.netPnl >= 0 ? '+' : ''}₹${t.netPnl.toFixed(2)}
                  </div>
                </div>

                <div class="fsm-order-prices">
                  <span>Buy: <b style="color: #34d399;">₹${t.buyPrice.toFixed(2)}</b></span>
                  <span>Sell: <b style="color: #f87171;">₹${t.sellPrice.toFixed(2)}</b></span>
                  <span>${t.points >= 0 ? '+' : ''}${t.points} pts</span>
                </div>

                <div class="fsm-order-charges-row">
                  <span style="color: ${t.grossPnl >= 0 ? '#34d399' : '#f87171'};">
                    Gross: ${t.grossPnl >= 0 ? '+' : ''}₹${t.grossPnl.toFixed(2)}
                  </span>
                  <span style="color: #f59e0b;" title="Brokerage ₹40 + STT + Turnover + GST">
                    Charges: -₹${t.charges.toFixed(2)}
                  </span>
                  <span style="color: var(--fsm-text-muted); font-size: 8px;">
                    ${t.exitTime}
                  </span>
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

    const refreshBtn = container.querySelector('#fsm-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        refreshBtn.style.transform = 'rotate(360deg)';
        refreshBtn.style.transition = 'transform 0.4s ease';
        setTimeout(() => { refreshBtn.style.transform = ''; refreshBtn.style.transition = ''; }, 400);

        // Force reload active instrument and master contract details
        lastCheckedSymbol = '';
        const titleData = quickScrapeTitle();
        const detectedSym = titleData.symbol || state.symbol;
        if (detectedSym) {
          await handleSymbolUpdate(detectedSym, true);
        }
        scrapeActiveMarketData();
        renderHUD();
        showToast(`Refreshed: ${state.symbol} (Lot: ${state.lotSize}, LTP: ₹${state.ltp.toFixed(2)})`);
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

    // Buy & Sell Buttons
    const buyBtn = container.querySelector('#fsm-buy-btn');
    if (buyBtn) buyBtn.onclick = (e) => { e.preventDefault(); handleTradeButtonClick('BUY'); };

    const sellBtn = container.querySelector('#fsm-btn-sell');
    if (sellBtn) sellBtn.onclick = (e) => { e.preventDefault(); handleTradeButtonClick('SELL'); };

    // Full Square Off button
    const exitBtn = container.querySelector('#fsm-exit-btn');
    if (exitBtn) {
      exitBtn.onclick = (e) => {
        e.preventDefault();
        if (state.activePosition) {
          state.dayStats.totalTrades += 1;
          const currentPrice = state.ltp > 0 ? state.ltp : state.activePosition.entryPrice;
          const oppSide = state.activePosition.side === 'BUY' ? 'sell' : 'buy';
          recordAndPlaceExecutionMarker(
            oppSide,
            currentPrice,
            `EXIT ${state.activePosition.qty} @ ₹${currentPrice.toFixed(2)}`,
            state.activePosition.qty
          );
          closeActivePositionInternal(state.activePosition.qty, currentPrice, 'MANUAL EXIT');
          showToast(`Squared off all open quantity (Trade #${state.dayStats.totalTrades})`);
        }
      };
    }

    // Stop Loss Quick Buttons
    container.querySelectorAll('.fsm-sl-btn').forEach(btn => {
      btn.onclick = () => {
        const pts = parseFloat(btn.dataset.pts);
        setStopLossByPoints(pts);
      };
    });

    // Manual SL Setter
    const manualSlBtn = container.querySelector('#fsm-sl-manual-set-btn');
    const manualSlInput = container.querySelector('#fsm-sl-manual-input');
    const handleManualSl = () => {
      if (!manualSlInput || !state.activePosition) return;
      const val = parseFloat(manualSlInput.value);
      if (isNaN(val) || val <= 0) {
        showToast('Please enter a valid price for Stop Loss');
        return;
      }
      setStopLossExplicitPrice(val);
    };
    if (manualSlBtn) manualSlBtn.onclick = (e) => { e.preventDefault(); handleManualSl(); };
    if (manualSlInput) {
      manualSlInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleManualSl();
        }
      };
    }

    const clearSlBtn = container.querySelector('#fsm-sl-clear-btn');
    if (clearSlBtn) {
      clearSlBtn.onclick = () => clearStopLoss();
    }

    const tabPos = container.querySelector('#fsm-tab-pos');
    const tabHist = container.querySelector('#fsm-tab-hist');
    if (tabPos && tabHist) {
      tabPos.onclick = () => { state.activeTab = 'position'; renderHUD(); };
      tabHist.onclick = () => { state.activeTab = 'history'; renderHUD(); };
    }

    const resetBtn = container.querySelector('#fsm-reset-btn');
    if (resetBtn) resetBtn.onclick = () => resetDayStats();
  }

  // Draggable HUD
  function setupDrag(element) {
    let startX = 0, startY = 0;

    element.onmousedown = (e) => {
      if (e.target.closest('#fsm-drag-handle')) {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;

        document.onmousemove = (moveEvent) => {
          moveEvent.preventDefault();
          const dx = startX - moveEvent.clientX;
          const dy = startY - moveEvent.clientY;
          startX = moveEvent.clientX;
          startY = moveEvent.clientY;
          element.style.top = (element.offsetTop - dy) + "px";
          element.style.left = (element.offsetLeft - dx) + "px";
          element.style.right = "auto";
        };

        document.onmouseup = () => {
          document.onmousemove = null;
          document.onmouseup = null;
        };
      }
    };
  }

  function applyHudVisibility(visible) {
    state.hudVisible = visible !== false;
    const hud = document.getElementById('fyers-scalpmaster-hud');
    if (hud) {
      if (state.hudVisible) {
        hud.classList.remove('fsm-hidden');
        hud.style.setProperty('display', 'block', 'important');
      } else {
        hud.classList.add('fsm-hidden');
        hud.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // Listen for storage changes across all tabs/popup
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STATE_KEY]) {
        const newVal = changes[STATE_KEY].newValue;
        if (newVal && newVal.hudVisible !== undefined) {
          applyHudVisibility(newVal.hudVisible);
        }
      }
    });
  }

  // Chrome Runtime Message Listener for Extension Popup
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'SET_HUD_VISIBILITY') {
        applyHudVisibility(req.visible);
        saveState();
        sendResponse({ success: true, visible: state.hudVisible });
      } else if (req.action === 'RESET_STATE') {
        state.activePosition = null;
        state.completedTrades = [];
        state.chartMarkers = [];
        state.dayStats = {
          grossPnL: 0,
          totalCharges: 0,
          netPnL: 0,
          totalTrades: 0,
          completedRounds: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          peakPnL: 0,
          maxDrawdown: 0
        };
        window.dispatchEvent(new CustomEvent('FSM_CHART_CLEAR_ALL'));
        saveState();
        renderHUD();
        sendResponse({ success: true });
      }
    });
  }

  // -------------------------------------------------------------
  // TAB SWITCH & FOCUS RE-ACTIVATION (Prevent Stuck / Delayed LTP)
  // -------------------------------------------------------------
  function restartActiveLoop() {
    if (window.__fsm_interval) {
      clearInterval(window.__fsm_interval);
      window.__fsm_interval = null;
    }
    scrapeActiveMarketData();
    window.__fsm_interval = setInterval(scrapeActiveMarketData, 100);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      restartActiveLoop();
    }
  });

  window.addEventListener('focus', () => {
    restartActiveLoop();
  });

  // Watch for real-time title changes directly (instant, zero-latency trigger)
  try {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const titleObserver = new MutationObserver(() => {
        scrapeActiveMarketData();
      });
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  } catch(e) {}

  // Start single loop
  restartActiveLoop();

  // Initialize
  loadState();
  scrapeActiveMarketData();
  logAnalyticsEvent('hud_session_active', {
    version: '1.0.0',
    platform: 'fyers_web'
  });
  console.log('[ScalpMaster] Initialized with robust self-healing SL order lines.');
})();
