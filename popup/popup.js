const STATE_KEY = 'fsm_state_v7';

document.addEventListener('DOMContentLoaded', () => {
  const equityValEl = document.getElementById('pop-equity-val');
  const tradeCountEl = document.getElementById('pop-trade-count');
  const chartStartDateEl = document.getElementById('chart-start-date');
  const chartEndDateEl = document.getElementById('chart-end-date');
  const canvas = document.getElementById('equity-canvas');

  const toggleHudBtn = document.getElementById('toggle-hud-btn');
  const toggleHudIcon = document.getElementById('toggle-hud-icon');
  const toggleHudText = document.getElementById('toggle-hud-text');

  const rangeSelect = document.getElementById('csv-range-select');
  const downloadCsvBtn = document.getElementById('download-csv-btn');

  const openFyersBtn = document.getElementById('open-fyers-btn');
  const resetBtn = document.getElementById('reset-day-btn');

  let currentCompletedTrades = [];
  let isHudVisible = true;

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
    } catch (e) {}
  }

  // Log popup open session
  logAnalyticsEvent('popup_opened', { view: 'analytics_dashboard' });

  // -------------------------------------------------------------
  // 1. LOAD DATA & RENDER 15-DAY EQUITY CURVE
  // -------------------------------------------------------------
  function loadData() {
    chrome.storage.local.get(null, (allData) => {
      const v7 = allData && allData['fsm_state_v7'] ? allData['fsm_state_v7'] : {};
      const v6 = allData && allData['fsm_state_v6'] ? allData['fsm_state_v6'] : {};
      const v5 = allData && allData['fsm_state_v5'] ? allData['fsm_state_v5'] : {};

      let trades = v7.completedTrades || [];
      if (!trades || trades.length === 0) {
        trades = (v6.completedTrades && v6.completedTrades.length > 0) ? v6.completedTrades : (v5.completedTrades || []);
        if (trades.length > 0) {
          v7.completedTrades = trades;
          v7.dayStats = v7.dayStats || v6.dayStats || v5.dayStats;
          chrome.storage.local.set({ [STATE_KEY]: v7 });
        }
      }

      currentCompletedTrades = trades;
      isHudVisible = v7.hudVisible !== false;
      updateHudButtonUI(isHudVisible);
      render15DayEquityChart(currentCompletedTrades);
    });
  }

  function updateHudButtonUI(visible) {
    if (visible) {
      toggleHudBtn.className = 'btn btn-hud-toggle';
      toggleHudIcon.textContent = '👁️';
      toggleHudText.textContent = 'Hide Order Window on Chart';
    } else {
      toggleHudBtn.className = 'btn btn-hud-toggle btn-hud-hidden';
      toggleHudIcon.textContent = '🙈';
      toggleHudText.textContent = 'Show Order Window on Chart';
    }
  }

  // Generate date string YYYY-MM-DD
  function toLocalDateStr(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Draw 15-Day Equity Chart on Canvas
  function render15DayEquityChart(trades) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 15 days window
    const now = new Date();
    const dayLabels = [];
    const dailyPnLMap = {};

    for (let i = 14; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const str = toLocalDateStr(d.getTime());
      dayLabels.push(str);
      dailyPnLMap[str] = 0;
    }

    // Aggregate trades net P&L
    let tradesIn15DaysCount = 0;
    trades.forEach(t => {
      const dStr = toLocalDateStr(t.id);
      if (dailyPnLMap[dStr] !== undefined) {
        dailyPnLMap[dStr] += (t.netPnl || 0);
        tradesIn15DaysCount++;
      }
    });

    // Compute cumulative equity curve
    let runningNet = 0;
    const equityPoints = [];
    dayLabels.forEach(dateStr => {
      runningNet += dailyPnLMap[dateStr];
      equityPoints.push({
        date: dateStr,
        value: runningNet
      });
    });

    // Update Header Text
    const sign = runningNet >= 0 ? '+' : '';
    equityValEl.textContent = `${sign}₹${runningNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    equityValEl.className = 'equity-value ' + (runningNet > 0 ? 'pnl-positive' : runningNet < 0 ? 'pnl-negative' : '');
    tradeCountEl.textContent = `${tradesIn15DaysCount} scalp${tradesIn15DaysCount === 1 ? '' : 's'}`;

    chartStartDateEl.textContent = dayLabels[0].slice(5);
    chartEndDateEl.textContent = dayLabels[14].slice(5) + ' (Today)';

    // Canvas plotting
    ctx.clearRect(0, 0, width, height);

    const padLeft = 10;
    const padRight = 10;
    const padTop = 15;
    const padBottom = 15;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const values = equityPoints.map(p => p.value);
    const minVal = Math.min(0, ...values);
    const maxVal = Math.max(0, ...values);
    const range = (maxVal - minVal) === 0 ? 100 : (maxVal - minVal);

    function getY(val) {
      return padTop + chartH - ((val - minVal) / range) * chartH;
    }
    function getX(idx) {
      return padLeft + (idx / (equityPoints.length - 1)) * chartW;
    }

    // Zero Baseline
    const zeroY = getY(0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, zeroY);
    ctx.lineTo(padLeft + chartW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curve Path
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(equityPoints[0].value));
    for (let i = 1; i < equityPoints.length; i++) {
      ctx.lineTo(getX(i), getY(equityPoints[i].value));
    }

    // Line Style
    const lineColor = runningNet >= 0 ? '#10b981' : '#ef4444';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Gradient Fill
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    if (runningNet >= 0) {
      grad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
      grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    } else {
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.35)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
    }

    ctx.lineTo(getX(equityPoints.length - 1), zeroY);
    ctx.lineTo(getX(0), zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Point dots
    equityPoints.forEach((p, idx) => {
      if (dailyPnLMap[p.date] !== 0 || idx === 0 || idx === equityPoints.length - 1) {
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(getX(idx), getY(p.value), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }

  // -------------------------------------------------------------
  // 2. REQUIREMENT 1: SHOW / HIDE ORDER WINDOW
  // -------------------------------------------------------------
  toggleHudBtn.addEventListener('click', () => {
    isHudVisible = !isHudVisible;
    updateHudButtonUI(isHudVisible);

    // Save in storage (triggers chrome.storage.onChanged in content.js immediately)
    chrome.storage.local.get([STATE_KEY], (res) => {
      const data = res && res[STATE_KEY] ? res[STATE_KEY] : {};
      data.hudVisible = isHudVisible;
      chrome.storage.local.set({ [STATE_KEY]: data });
    });

    // Message all trade.fyers.in tabs
    chrome.tabs.query({ url: "*://trade.fyers.in/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        tabs.forEach(t => {
          try {
            chrome.tabs.sendMessage(t.id, {
              action: 'SET_HUD_VISIBILITY',
              visible: isHudVisible
            }, () => {
              if (chrome.runtime.lastError) {}
            });
          } catch(e) {}
        });
      }
    });

    // Also message active tab as fallback
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'SET_HUD_VISIBILITY',
            visible: isHudVisible
          }, () => {
            if (chrome.runtime.lastError) {}
          });
        } catch(e) {}
      }
    });
  });

  // -------------------------------------------------------------
  // 3. REQUIREMENT 2: DOWNLOAD TRADE LOG IN CSV FORMAT
  // -------------------------------------------------------------
  downloadCsvBtn.addEventListener('click', () => {
    const range = rangeSelect.value; // '30', '120', 'all'
    const now = Date.now();
    let cutoff = 0;

    if (range === '30') {
      cutoff = now - (30 * 24 * 60 * 60 * 1000);
    } else if (range === '120') {
      cutoff = now - (120 * 24 * 60 * 60 * 1000);
    }

    const filtered = currentCompletedTrades.filter(t => t.id >= cutoff);

    if (filtered.length === 0) {
      alert(`No completed trades found for ${range === 'all' ? 'all time' : 'the last ' + range + ' days'}.`);
      return;
    }

    // CSV Headers
    const headers = [
      'Trade ID',
      'Date',
      'Entry Time',
      'Exit Time',
      'Symbol',
      'Side',
      'Quantity',
      'Buy Price (INR)',
      'Sell Price (INR)',
      'Points',
      'Gross PnL (INR)',
      'Charges (INR)',
      'Net PnL (INR)',
      'Result',
      'Reason'
    ];

    const rows = filtered.map(t => {
      const dateStr = toLocalDateStr(t.id);
      return [
        t.id,
        dateStr,
        `"${t.entryTime || ''}"`,
        `"${t.exitTime || ''}"`,
        `"${t.symbol || ''}"`,
        t.side,
        t.qty,
        (t.buyPrice || 0).toFixed(2),
        (t.sellPrice || 0).toFixed(2),
        (t.points || 0).toFixed(2),
        (t.grossPnl || 0).toFixed(2),
        (t.charges || 0).toFixed(2),
        (t.netPnl || 0).toFixed(2),
        t.isWin ? 'WIN' : 'LOSS',
        `"${t.reason || 'EXIT'}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const rangeLabel = range === 'all' ? 'all' : `last${range}days`;
    link.setAttribute('download', `fyers_scalpmaster_${rangeLabel}_${toLocalDateStr(now)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  // Open FYERS Terminal
  openFyersBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://trade.fyers.in/' });
  });

  // Reset Today's stats
  resetBtn.addEventListener('click', () => {
    if (confirm("Reset today's practice statistics and trade log?")) {
      chrome.storage.local.get([STATE_KEY], (res) => {
        let state = res && res[STATE_KEY] ? res[STATE_KEY] : {};
        state.activePosition = null;
        state.completedTrades = [];
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
        chrome.storage.local.set({ [STATE_KEY]: state }, () => {
          loadData();
          // Also message content script to clear
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'RESET_STATE' });
            }
          });
        });
      });
    }
  });

  // Referral link
  const signupLink = document.getElementById('fyers-signup-link');
  if (signupLink) {
    signupLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://signup.fyers.in/?utm-source=AP-Leads&utm-medium=AP4530' });
    });
  }

  // -------------------------------------------------------------
  // DYNAMIC REMOTE BROADCAST / ANNOUNCEMENT SYSTEM
  // -------------------------------------------------------------
  const BROADCAST_URL = "https://raw.githubusercontent.com/raviudal/scalpmaster/main/docs/broadcast.json";

  function checkBroadcastNotice() {
    const bannerContainer = document.getElementById('broadcast-container');
    if (!bannerContainer) return;

    fetch(BROADCAST_URL, { cache: 'no-cache' })
      .then(res => {
        if (!res.ok) throw new Error('Network response not ok');
        return res.json();
      })
      .then(data => {
        if (!data || !data.enabled || !data.id) {
          bannerContainer.style.display = 'none';
          return;
        }

        chrome.storage.local.get(['dismissed_broadcast_id'], (result) => {
          if (result && result.dismissed_broadcast_id === data.id) {
            bannerContainer.style.display = 'none';
            return;
          }

          renderBroadcastBanner(bannerContainer, data);
        });
      })
      .catch(() => {
        // Fail silently when offline or unreachable
        bannerContainer.style.display = 'none';
      });
  }

  function renderBroadcastBanner(container, data) {
    container.innerHTML = `
      <div class="broadcast-header">
        <span class="broadcast-title">${escapeHTML(data.title || '⚡ Announcement')}</span>
        <button id="close-broadcast-btn" class="broadcast-close" title="Dismiss">&times;</button>
      </div>
      <div class="broadcast-message">${escapeHTML(data.message || '')}</div>
      ${data.action_url ? `<a href="#" id="broadcast-action-link" class="broadcast-link">Learn More ➔</a>` : ''}
    `;
    container.style.display = 'block';

    const closeBtn = document.getElementById('close-broadcast-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        container.style.display = 'none';
        chrome.storage.local.set({ dismissed_broadcast_id: data.id });
      });
    }

    const actionLink = document.getElementById('broadcast-action-link');
    if (actionLink && data.action_url) {
      actionLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: data.action_url });
      });
    }
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  checkBroadcastNotice();

  loadData();
});
