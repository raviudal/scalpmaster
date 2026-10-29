const STATE_KEY = 'fsm_state_v1';

document.addEventListener('DOMContentLoaded', () => {
  const pnlEl = document.getElementById('pop-day-pnl');
  const tradesEl = document.getElementById('pop-trades');
  const winrateEl = document.getElementById('pop-winrate');
  const wlEl = document.getElementById('pop-wl');
  const openFyersBtn = document.getElementById('open-fyers-btn');
  const resetBtn = document.getElementById('reset-day-btn');

  // Load stats from storage
  function refreshStats() {
    chrome.storage.local.get([STATE_KEY], (res) => {
      if (res && res[STATE_KEY]) {
        const data = res[STATE_KEY];
        const stats = data.dayStats || { totalPnL: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0 };
        
        const sign = stats.totalPnL >= 0 ? '+' : '';
        pnlEl.textContent = `${sign}₹${stats.totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        pnlEl.className = 'pnl-value ' + (stats.totalPnL > 0 ? 'pnl-positive' : stats.totalPnL < 0 ? 'pnl-negative' : '');

        tradesEl.textContent = stats.totalTrades;
        winrateEl.textContent = `${stats.winRate}%`;
        winrateEl.style.color = stats.winRate >= 50 ? '#34d399' : '#f87171';
        wlEl.textContent = `${stats.wins} / ${stats.losses}`;
      }
    });
  }

  refreshStats();

  // Open FYERS Terminal
  openFyersBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://trade.fyers.in/' });
  });

  // Reset Day stats
  resetBtn.addEventListener('click', () => {
    if (confirm("Reset today's practice statistics and trade log?")) {
      chrome.storage.local.get([STATE_KEY], (res) => {
        let state = res && res[STATE_KEY] ? res[STATE_KEY] : {};
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
        chrome.storage.local.set({ [STATE_KEY]: state }, () => {
          refreshStats();
        });
      });
    }
  });
});
