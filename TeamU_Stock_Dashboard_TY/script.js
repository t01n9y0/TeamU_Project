const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycby-2PgB5X04HiKz5sM_aUW4dHAlb0gsqyGeOAIfx_bFI9SnwJG8knNU9M_gM6MFjg0j/exec";

let stockRows = [];
let selectedStock = null;
let selectedRange = "1D";

let portfolioJsonpScript = null;
let portfolioJsonpTimer = null;

let chartJsonpScript = null;
let chartJsonpTimer = null;

let insightsJsonpScript = null;
let insightsJsonpTimer = null;

let stockChart = null;

const chartCache = new Map();
const miniChartCache = new Map();

const tbody = document.getElementById("stockTableBody");
const searchInput = document.getElementById("searchInput");
const dataStatus = document.getElementById("dataStatus");
const syncLight = document.getElementById("syncLight");
const refreshBtn = document.getElementById("refreshBtn");

const chartTitle = document.getElementById("chartTitle");
const chartSubTitle = document.getElementById("chartSubTitle");
const chartLoading = document.getElementById("chartLoading");
const chartCanvas = document.getElementById("stockChart");
const chartRangeButtons = document.querySelectorAll(".chart-range");

const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const themeToggleText = document.getElementById("themeToggleText");

const loadInsightsBtn = document.getElementById("loadInsightsBtn");
const insightsLight = document.getElementById("insightsLight");
const insightsStatus = document.getElementById("insightsStatus");
const portfolioInsightContent = document.getElementById("portfolioInsightContent");
const newsOverviewContent = document.getElementById("newsOverviewContent");
const stockInsightCards = document.getElementById("stockInsightCards");
const newsCards = document.getElementById("newsCards");


function getSavedTheme() {
  return localStorage.getItem("teamu-stock-theme") || "dark";
}

function applyTheme(theme) {
  const safeTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);

  if (themeToggleIcon) {
    themeToggleIcon.textContent = safeTheme === "light" ? "☾" : "☀";
  }

  if (themeToggleText) {
    themeToggleText.textContent = safeTheme === "light" ? "關燈" : "開燈";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem("teamu-stock-theme", next);
  applyTheme(next);
}

function setSyncStatus(status, message) {
  syncLight.classList.remove("wait", "red", "green");
  syncLight.classList.add(status);
  dataStatus.textContent = message;
}

function setInsightsStatus(status, message) {
  insightsLight.classList.remove("wait", "red", "green");
  insightsLight.classList.add(status);
  insightsStatus.textContent = message;
}

function loadPortfolioData() {
  setSyncStatus("wait", "資料同步中...");

  tbody.innerHTML = `
    <tr>
      <td colspan="10" class="message-row">資料同步中...</td>
    </tr>
  `;

  if (portfolioJsonpScript) {
    portfolioJsonpScript.remove();
  }

  if (portfolioJsonpTimer) {
    clearTimeout(portfolioJsonpTimer);
  }

  window.handleStockData = function(payload) {
    clearTimeout(portfolioJsonpTimer);

    if (!payload || !payload.success) {
      const message = payload?.message || "同步失敗，請檢查 Apps Script";

      setSyncStatus("red", message);

      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="message-row">${message}</td>
        </tr>
      `;

      resetSummary();
      return;
    }

    stockRows = payload.rows || [];

    renderSummary(stockRows);
    renderRows(stockRows);

    const time = payload.updatedAt
      ? new Date(payload.updatedAt).toLocaleString("zh-TW")
      : "剛剛";

    const quoteStatus = payload.quoteOkCount !== undefined
      ? `｜報價成功 ${payload.quoteOkCount}/${stockRows.length}`
      : "";

    setSyncStatus(
      "green",
      `同步成功｜已載入 ${stockRows.length} 筆資料${quoteStatus}｜${time}`
    );

    queueMiniCharts(stockRows);

    if (stockRows.length > 0) {
      selectStock(stockRows[0]);
    }
  };

  portfolioJsonpScript = document.createElement("script");
  portfolioJsonpScript.src =
    `${GAS_WEB_APP_URL}?action=portfolio&callback=handleStockData&_=${Date.now()}`;

  portfolioJsonpScript.onerror = function() {
    clearTimeout(portfolioJsonpTimer);

    setSyncStatus(
      "red",
      "同步失敗，請檢查 Apps Script 部署版本或 /exec 網址"
    );

    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="message-row">
          同步失敗，請檢查 Apps Script 部署版本或 /exec 網址
        </td>
      </tr>
    `;

    resetSummary();
  };

  portfolioJsonpTimer = setTimeout(() => {
    setSyncStatus(
      "red",
      "同步逾時，請檢查 Apps Script 是否已更新部署"
    );

    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="message-row">
          同步逾時，請檢查 Apps Script 是否已更新部署
        </td>
      </tr>
    `;

    resetSummary();
  }, 15000);

  document.body.appendChild(portfolioJsonpScript);
}

function isValidNumber(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
  );
}

function money(value) {
  if (!isValidNumber(value)) return "—";

  return new Intl.NumberFormat("zh-TW").format(
    Math.round(Number(value || 0))
  );
}

function decimal(value) {
  if (!isValidNumber(value)) return "—";

  return Number(value || 0).toLocaleString("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function percent(value) {
  if (!isValidNumber(value)) return "—";

  return `${Number(value || 0).toFixed(2)}%`;
}

function signedMoney(value) {
  if (!isValidNumber(value)) return "—";

  return `${Number(value) >= 0 ? "+" : ""}${money(value)}`;
}

function signedPercent(value) {
  if (!isValidNumber(value)) return "—";

  return `${Number(value) >= 0 ? "+" : ""}${percent(value)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resetSummary() {
  document.getElementById("totalCost").textContent = "NT$ 0";
  document.getElementById("totalMarket").textContent = "NT$ 0";
  document.getElementById("totalProfit").textContent = "NT$ 0";
  document.getElementById("totalRate").textContent = "0.00%";

  document.getElementById("winLossCount").innerHTML = `
    <span class="count-up">0</span>
    <span class="count-sep">/</span>
    <span class="count-down">0</span>
  `;

  updateSummaryTone(0);
}

function renderSummary(rows) {
  const totalCost = rows.reduce(
    (sum, row) => sum + Number(row.cost || 0),
    0
  );

  const pricedRows = rows.filter(row =>
    isValidNumber(row.market) &&
    isValidNumber(row.profit)
  );

  const totalMarket = pricedRows.reduce(
    (sum, row) => sum + Number(row.market || 0),
    0
  );

  const totalProfit = pricedRows.reduce(
    (sum, row) => sum + Number(row.profit || 0),
    0
  );

  const pricedCost = pricedRows.reduce(
    (sum, row) => sum + Number(row.cost || 0),
    0
  );

  const totalRate =
    pricedCost ? (totalProfit / pricedCost) * 100 : 0;

  const winCount = pricedRows.filter(
    row => Number(row.profit) >= 0
  ).length;

  const lossCount = pricedRows.filter(
    row => Number(row.profit) < 0
  ).length;

  document.getElementById("totalCost").textContent =
    `NT$ ${money(totalCost)}`;

  document.getElementById("totalMarket").textContent =
    `NT$ ${money(totalMarket)}`;

  document.getElementById("totalProfit").textContent =
    `NT$ ${money(totalProfit)}`;

  document.getElementById("totalRate").textContent =
    percent(totalRate);

  document.getElementById("winLossCount").innerHTML = `
    <span class="count-up">${winCount}</span>
    <span class="count-sep">/</span>
    <span class="count-down">${lossCount}</span>
  `;

  updateSummaryTone(totalProfit);
}

function updateSummaryTone(totalProfit) {
  const profitCard = document.querySelector(".stat-profit");
  const totalProfitEl = document.getElementById("totalProfit");
  const totalRateEl = document.getElementById("totalRate");

  if (!profitCard || !totalProfitEl || !totalRateEl) return;

  profitCard.classList.remove(
    "profit-up",
    "profit-down",
    "profit-flat"
  );

  totalProfitEl.classList.remove(
    "profit-up-text",
    "profit-down-text",
    "profit-flat-text"
  );

  totalRateEl.classList.remove(
    "profit-up-text",
    "profit-down-text",
    "profit-flat-text"
  );

  if (Number(totalProfit) > 0) {
    profitCard.classList.add("profit-up");
    totalProfitEl.classList.add("profit-up-text");
    totalRateEl.classList.add("profit-up-text");
  } else if (Number(totalProfit) < 0) {
    profitCard.classList.add("profit-down");
    totalProfitEl.classList.add("profit-down-text");
    totalRateEl.classList.add("profit-down-text");
  } else {
    profitCard.classList.add("profit-flat");
    totalProfitEl.classList.add("profit-flat-text");
    totalRateEl.classList.add("profit-flat-text");
  }
}

function renderRows(rows) {
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="message-row">查無資料</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const originalIndex = stockRows.indexOf(row);
    const sparkKey = `${safeId(row.code)}-${originalIndex}`;

    const profitClass = !isValidNumber(row.profit)
      ? "neutral"
      : Number(row.profit) >= 0
        ? "positive"
        : "negative";

    const rateClass = !isValidNumber(row.rate)
      ? "neutral"
      : Number(row.rate) >= 0
        ? "positive"
        : "negative";

    const profitPillClass =
      profitClass === "positive"
        ? "profit-pill profit-pill-up"
        : profitClass === "negative"
          ? "profit-pill profit-pill-down"
          : "profit-pill profit-pill-neutral";

    return `
      <tr>
        <td class="code" data-label="國際代號">${row.code || ""}</td>
        <td class="stock-name" data-label="股名">${row.name || "—"}</td>
        <td data-label="持股數">${money(row.shares)}</td>
        <td class="avg" data-label="成交均價">${decimal(row.avg)}</td>
        <td data-label="投資成本">${money(row.cost)}</td>

        <td class="price" data-label="現價">
          <span class="price-pill">
            ${decimal(row.price)}
          </span>
        </td>

        <td data-label="帳面市值">${money(row.market)}</td>

        <td class="${profitClass}" data-label="損益">
          <span class="${profitPillClass}">
            ${signedMoney(row.profit)}
          </span>
        </td>

        <td class="${rateClass}" data-label="損益率">
          ${signedPercent(row.rate)}
        </td>

        <td class="spark-cell" data-label="當日線圖">
          <div
            class="spark-card"
            id="spark-${sparkKey}"
            data-code="${row.code}"
            data-index="${originalIndex}"
            title="查看 ${row.code} 當日線圖"
          >
            <div class="spark-loading">載入中</div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  bindSparkCards();
}

function applySearch() {
  const keyword = searchInput.value.trim().toLowerCase();

  if (!keyword) {
    renderRows(stockRows);
    queueMiniCharts(stockRows);
    return;
  }

  const filtered = stockRows.filter(row => {
    return [
      row.code,
      row.name,
      row.stockNo,
      row.marketType
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });

  renderRows(filtered);
  queueMiniCharts(filtered);
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function safeCallbackId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_]/g, "_");
}

function renderSparkline(points, openPrice) {
  if (!Array.isArray(points) || points.length < 2) {
    return `<div class="spark-empty">—</div>`;
  }

  const validOpen = isValidNumber(openPrice)
    ? Number(openPrice)
    : Number(points[0]);

  const width = 126;
  const height = 54;
  const padX = 6;
  const padY = 6;

  const valuesForScale = [...points, validOpen];

  const rawMax = Math.max(...valuesForScale);
  const rawMin = Math.min(...valuesForScale);
  const rawRange = rawMax - rawMin || 1;

  const max = rawMax + rawRange * 0.08;
  const min = rawMin - rawRange * 0.08;
  const range = max - min || 1;

  function toX(index) {
    return padX + ((width - padX * 2) * index / (points.length - 1));
  }

  function toY(price) {
    return padY + ((height - padY * 2) * (max - price) / range);
  }

  const openY = toY(validOpen);

  let coloredSegments = "";

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = Number(points[i]);
    const p2 = Number(points[i + 1]);

    const x1 = toX(i);
    const y1 = toY(p1);
    const x2 = toX(i + 1);
    const y2 = toY(p2);

    const side1 = p1 >= validOpen ? "red" : "green";
    const side2 = p2 >= validOpen ? "red" : "green";

    const redColor = "#B74D58";
    const greenColor = "#4A9468";

    if (side1 === side2 || p1 === p2) {
      const color = side1 === "red" ? redColor : greenColor;

      coloredSegments += `
        <line
          x1="${x1.toFixed(2)}"
          y1="${y1.toFixed(2)}"
          x2="${x2.toFixed(2)}"
          y2="${y2.toFixed(2)}"
          stroke="${color}"
          stroke-width="1.9"
          stroke-linecap="round"
        />
      `;
    } else {
      const ratio = (validOpen - p1) / (p2 - p1);
      const crossX = x1 + (x2 - x1) * ratio;
      const crossY = openY;

      const firstColor = side1 === "red" ? redColor : greenColor;
      const secondColor = side2 === "red" ? redColor : greenColor;

      coloredSegments += `
        <line
          x1="${x1.toFixed(2)}"
          y1="${y1.toFixed(2)}"
          x2="${crossX.toFixed(2)}"
          y2="${crossY.toFixed(2)}"
          stroke="${firstColor}"
          stroke-width="1.9"
          stroke-linecap="round"
        />

        <line
          x1="${crossX.toFixed(2)}"
          y1="${crossY.toFixed(2)}"
          x2="${x2.toFixed(2)}"
          y2="${y2.toFixed(2)}"
          stroke="${secondColor}"
          stroke-width="1.9"
          stroke-linecap="round"
        />
      `;
    }
  }

  return `
    <svg
      class="spark-svg"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
    >
      <line
        x1="6"
        y1="${openY.toFixed(2)}"
        x2="${width - 6}"
        y2="${openY.toFixed(2)}"
        stroke="rgba(238,238,238,0.72)"
        stroke-width="1.2"
      />

      ${coloredSegments}
    </svg>
  `;
}

function bindSparkCards() {
  document.querySelectorAll(".spark-card").forEach(card => {
    card.addEventListener("click", () => {
      const index = Number(card.dataset.index);
      const stock = stockRows[index];

      if (stock) {
        selectStock(stock);
      }
    });
  });
}

function queueMiniCharts(rows) {
  rows.forEach((row, index) => {
    const originalIndex = stockRows.indexOf(row);

    setTimeout(() => {
      loadMiniChart(row, originalIndex);
    }, index * 220);
  });
}

function loadMiniChart(row, originalIndex) {
  const cacheKey = row.code;
  const sparkKey = `${safeId(row.code)}-${originalIndex}`;
  const card = document.getElementById(`spark-${sparkKey}`);

  if (!card) return;

  if (miniChartCache.has(cacheKey)) {
    const cache = miniChartCache.get(cacheKey);

    card.innerHTML = renderSparkline(
      cache.prices,
      cache.openPrice
    );

    return;
  }

  const callbackName =
    `handleMiniChart_${safeCallbackId(row.code)}_${originalIndex}_${Date.now()}`;

  const script = document.createElement("script");

  window[callbackName] = function(payload) {
    if (
      payload &&
      payload.success &&
      Array.isArray(payload.prices) &&
      payload.prices.length >= 2
    ) {
      const sparkData = {
        prices: payload.prices,
        openPrice: payload.openPrice
      };

      miniChartCache.set(cacheKey, sparkData);

      card.innerHTML = renderSparkline(
        sparkData.prices,
        sparkData.openPrice
      );
    } else {
      card.innerHTML = `<div class="spark-empty">—</div>`;
    }

    delete window[callbackName];
    script.remove();
  };

  script.onerror = function() {
    card.innerHTML = `<div class="spark-empty">—</div>`;
    delete window[callbackName];
    script.remove();
  };

  script.src =
    `${GAS_WEB_APP_URL}?action=mini` +
    `&code=${encodeURIComponent(row.code)}` +
    `&callback=${encodeURIComponent(callbackName)}` +
    `&_=${Date.now()}`;

  document.body.appendChild(script);
}

function selectStock(stock) {
  selectedStock = stock;

  chartTitle.textContent =
    `價格線圖｜${stock.name || stock.code}`;

  chartSubTitle.textContent =
    `${stock.code}｜現價 ${decimal(stock.price)}｜昨收 ${decimal(stock.previousClose)}`;

  loadChartData(stock, selectedRange);
}

function setChartLoading(message) {
  chartLoading.textContent = message;
  chartLoading.classList.remove("hidden");
}

function hideChartLoading() {
  chartLoading.classList.add("hidden");
}

function loadChartData(stock, range = "1D") {
  if (!stock) return;

  selectedRange = range;
  updateRangeButtonState(range);

  const cacheKey = `${stock.code}_${range}`;

  if (chartCache.has(cacheKey)) {
    drawChart(chartCache.get(cacheKey), stock, range);
    return;
  }

  setChartLoading("價格線圖載入中...");

  if (chartJsonpScript) {
    chartJsonpScript.remove();
  }

  if (chartJsonpTimer) {
    clearTimeout(chartJsonpTimer);
  }

  window.handleChartData = function(payload) {
    clearTimeout(chartJsonpTimer);

    if (
      !payload ||
      !payload.success ||
      !Array.isArray(payload.points) ||
      !payload.points.length
    ) {
      setChartLoading(payload?.message || "暫時無法取得價格線圖");
      destroyChart();
      return;
    }

    chartCache.set(cacheKey, payload);
    drawChart(payload, stock, range);
  };

  chartJsonpScript = document.createElement("script");
  chartJsonpScript.src =
    `${GAS_WEB_APP_URL}?action=chart` +
    `&code=${encodeURIComponent(stock.code)}` +
    `&range=${encodeURIComponent(range)}` +
    `&callback=handleChartData` +
    `&_=${Date.now()}`;

  chartJsonpScript.onerror = function() {
    clearTimeout(chartJsonpTimer);
    setChartLoading("價格線圖讀取失敗");
    destroyChart();
  };

  chartJsonpTimer = setTimeout(() => {
    setChartLoading("價格線圖讀取逾時");
    destroyChart();
  }, 15000);

  document.body.appendChild(chartJsonpScript);
}

function destroyChart() {
  if (stockChart) {
    stockChart.destroy();
    stockChart = null;
  }
}

function drawChart(payload, stock, range) {
  hideChartLoading();
  destroyChart();

  const labels = payload.points.map(point => point.label);
  const prices = payload.points.map(point => point.price);
  const ctx = chartCanvas.getContext("2d");

  const datasets = [{
    label: `${stock.name || stock.code} ${range} 價格`,
    data: prices,
    borderColor: "rgba(125, 231, 255, 0.95)",
    backgroundColor: "rgba(125, 231, 255, 0.12)",
    borderWidth: 2,
    pointRadius: labels.length > 60 ? 0 : 2,
    pointHoverRadius: 4,
    tension: 0.26,
    fill: true
  }];

  if (isValidNumber(payload.openPrice)) {
    datasets.push({
      label: "開盤價",
      data: labels.map(() => Number(payload.openPrice)),
      borderColor: "rgba(238, 238, 238, 0.82)",
      backgroundColor: "transparent",
      borderWidth: 1.4,
      borderDash: [6, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      fill: false
    });
  }

  stockChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.dataset.label === "開盤價") {
                return `開盤價：${decimal(context.parsed.y)}`;
              }

              return `價格：${decimal(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(220, 235, 250, 0.72)",
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,

            callback: function(value, index) {
              const label = labels[index] || "";

              if (range === "1D") {
                const time = label.split(" ")[1] || "";
                const minute = time.split(":")[1] || "";

                return minute === "00"
                  ? time
                  : "";
              }

              if (range === "5D") {
                return label.split(" ")[0];
              }

              if (range === "1M") {
                return label;
              }

              if (range === "3M") {
                return index % 5 === 0 ? label : "";
              }

              return label;
            }
          },

          afterBuildTicks: function(axis) {
            const originalTicks = axis.ticks;

            if (range === "5D") {
              const seenDates = new Set();

              axis.ticks = originalTicks.filter(tick => {
                const label = labels[tick.value] || "";
                const dateOnly = label.split(" ")[0];

                if (seenDates.has(dateOnly)) {
                  return false;
                }

                seenDates.add(dateOnly);
                return true;
              });
            }

            if (range === "3M") {
              axis.ticks = originalTicks.filter((tick, index) => {
                return index % 5 === 0;
              });
            }
          },

          grid: {
            color: "rgba(255, 255, 255, 0.06)"
          }
        },

        y: {
          ticks: {
            color: "rgba(220, 235, 250, 0.72)"
          },
          grid: {
            color: "rgba(255, 255, 255, 0.06)"
          }
        }
      }
    }
  });
}

function updateRangeButtonState(range) {
  chartRangeButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.range === range
    );
  });
}

chartRangeButtons.forEach(button => {
  button.addEventListener("click", () => {
    const range = button.dataset.range;

    if (!selectedStock) return;

    loadChartData(selectedStock, range);
  });
});

function loadInsightsData() {
  setInsightsStatus("wait", "搜尋今日新聞並產生 AI 分析中，約需數十秒...");

  loadInsightsBtn.disabled = true;
  loadInsightsBtn.style.opacity = "0.72";

  portfolioInsightContent.innerHTML = `<div class="empty-insight">分析產生中...</div>`;
  newsOverviewContent.innerHTML = `<div class="empty-insight">新聞整理中...</div>`;
  stockInsightCards.innerHTML = `<div class="empty-wide">AI 個股建議整理中...</div>`;
  newsCards.innerHTML = `<div class="empty-wide">新聞抓取中...</div>`;

  if (insightsJsonpScript) {
    insightsJsonpScript.remove();
  }

  if (insightsJsonpTimer) {
    clearTimeout(insightsJsonpTimer);
  }

  window.handleInsightsData = function(payload) {
    clearTimeout(insightsJsonpTimer);
    loadInsightsBtn.disabled = false;
    loadInsightsBtn.style.opacity = "1";

    if (!payload || !payload.success) {
      const message = payload?.message || "情報分析失敗，請稍後再試。";
      setInsightsStatus("red", message);
      portfolioInsightContent.innerHTML = `<div class="empty-insight">${escapeHtml(message)}</div>`;
      newsOverviewContent.innerHTML = `<div class="empty-insight">尚未取得新聞概覽。</div>`;
      stockInsightCards.innerHTML = `<div class="empty-wide">尚未產生 AI 個股分析。</div>`;
      newsCards.innerHTML = `<div class="empty-wide">尚未取得新聞資料。</div>`;
      return;
    }

    const aiMessage = payload.aiAvailable
      ? "新聞與 AI 分析完成。"
      : "今日新聞已載入；AI 尚未設定 API 金鑰，因此先顯示新聞資料。";

    setInsightsStatus(payload.aiAvailable ? "green" : "wait", aiMessage);

    renderNewsOverview(payload);
    renderPortfolioInsight(payload.aiAnalysis?.portfolio || null, payload.aiAvailable, payload.aiMessage || "");
    renderStockInsights(payload.aiAnalysis?.stocks || [], payload.aiAvailable, payload.aiMessage || "");
    renderNewsCards(payload.newsGroups || []);
  };

  insightsJsonpScript = document.createElement("script");
  insightsJsonpScript.src =
    `${GAS_WEB_APP_URL}?action=insights&callback=handleInsightsData&_=${Date.now()}`;

  insightsJsonpScript.onerror = function() {
    clearTimeout(insightsJsonpTimer);
    loadInsightsBtn.disabled = false;
    loadInsightsBtn.style.opacity = "1";
    setInsightsStatus("red", "情報分析載入失敗，請檢查 Apps Script 部署版本。");
  };

  insightsJsonpTimer = setTimeout(() => {
    loadInsightsBtn.disabled = false;
    loadInsightsBtn.style.opacity = "1";
    setInsightsStatus("red", "情報分析逾時，新聞量較多時可再重試一次。");
  }, 90000);

  document.body.appendChild(insightsJsonpScript);
}

function renderNewsOverview(payload) {
  const groups = payload.newsGroups || [];
  const totalNews = groups.reduce((sum, group) => sum + (group.news || []).length, 0);
  const stocksWithNews = groups.filter(group => (group.news || []).length > 0).length;
  const analyzedCount = payload.aiAnalysis?.stocks?.length || 0;

  newsOverviewContent.innerHTML = `
    <div class="news-kpi-grid">
      <div class="news-kpi">
        <span>抓到新聞</span>
        <strong>${totalNews}</strong>
      </div>
      <div class="news-kpi">
        <span>有新聞持股</span>
        <strong>${stocksWithNews}</strong>
      </div>
      <div class="news-kpi">
        <span>AI 判讀檔數</span>
        <strong>${analyzedCount}</strong>
      </div>
    </div>
  `;
}

function renderPortfolioInsight(portfolio, aiAvailable, aiMessage) {
  if (!aiAvailable || !portfolio) {
    portfolioInsightContent.innerHTML = `
      <div class="empty-insight">
        ${escapeHtml(aiMessage || "AI 分析尚未啟用。")}
      </div>
    `;
    return;
  }

  const riskLevel = escapeHtml(portfolio.riskLevel || "待判讀");
  const summary = escapeHtml(portfolio.summary || "尚無總結。");
  const opportunities = Array.isArray(portfolio.opportunities) ? portfolio.opportunities : [];
  const risks = Array.isArray(portfolio.risks) ? portfolio.risks : [];

  portfolioInsightContent.innerHTML = `
    <div class="overview-meta">
      <span class="overview-pill">風險層級：${riskLevel}</span>
    </div>

    <div class="overview-summary">
      ${summary}
    </div>

    <div class="overview-list">
      <div><strong>機會：</strong>${opportunities.map(item => escapeHtml(item)).join("、") || "尚無"}</div>
      <div><strong>風險：</strong>${risks.map(item => escapeHtml(item)).join("、") || "尚無"}</div>
    </div>
  `;
}

function renderStockInsights(stocks, aiAvailable, aiMessage) {
  if (!aiAvailable || !stocks.length) {
    stockInsightCards.innerHTML = `
      <div class="empty-wide">
        ${escapeHtml(aiMessage || "AI 個股分析尚未啟用。")}
      </div>
    `;
    return;
  }

  stockInsightCards.innerHTML = stocks.map(stock => {
    const sentimentClass = mapSentimentClass(stock.newsSentiment);
    const stanceClass = mapStanceClass(stock.stance);

    return `
      <article class="stock-ai-card">
        <div class="stock-ai-top">
          <div>
            <h4>${escapeHtml(stock.name || stock.code || "個股")}</h4>
            <div class="stock-ai-code">${escapeHtml(stock.code || "")}</div>
          </div>

          <div class="ai-badges">
            <span class="ai-badge ${stanceClass}">${escapeHtml(stock.stance || "觀察")}</span>
            <span class="ai-badge ${sentimentClass}">${escapeHtml(stock.newsSentiment || "中性")}</span>
          </div>
        </div>

        <div class="stock-ai-copy">
          <div><strong>新聞摘要：</strong>${escapeHtml(stock.newsDigest || "尚無摘要")}</div>
          <div><strong>個股建議：</strong>${escapeHtml(stock.suggestion || "尚無建議")}</div>
          <div><strong>觀察重點：</strong>${escapeHtml(stock.reason || "尚無")}</div>
        </div>
      </article>
    `;
  }).join("");
}

function mapSentimentClass(sentiment) {
  const text = String(sentiment || "");
  if (text.includes("利多")) return "positive-news";
  if (text.includes("利空")) return "negative-news";
  return "neutral-news";
}

function mapStanceClass(stance) {
  const text = String(stance || "");
  if (text.includes("偏多") || text.includes("看多")) return "bullish";
  if (text.includes("保守") || text.includes("偏空") || text.includes("看空")) return "bearish";
  return "watch";
}

function renderNewsCards(groups) {
  if (!groups.length) {
    newsCards.innerHTML = `<div class="empty-wide">今日尚未取得持股相關新聞。</div>`;
    return;
  }

  newsCards.innerHTML = groups.map(group => {
    const items = Array.isArray(group.news) ? group.news : [];

    return `
      <article class="news-card">
        <div class="news-card-head">
          <strong>${escapeHtml(group.name || group.code || "個股")}</strong>
          <span class="news-stock-chip">${escapeHtml(group.code || "")}</span>
        </div>

        ${
          items.length
            ? items.map(item => `
                <div class="news-item">
                  <a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer">
                    ${escapeHtml(item.title || "新聞標題")}
                  </a>
                  <div class="news-meta">
                    <span>${escapeHtml(item.source || "未知來源")}</span>
                    <span>${escapeHtml(item.publishedAtDisplay || "")}</span>
                  </div>
                </div>
              `).join("")
            : `<div class="empty-insight">今日尚無符合條件的新聞。</div>`
        }
      </article>
    `;
  }).join("");
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", toggleTheme);
}

applyTheme(getSavedTheme());

searchInput.addEventListener("input", applySearch);

refreshBtn.addEventListener("click", () => {
  chartCache.clear();
  miniChartCache.clear();
  loadPortfolioData();
});

loadInsightsBtn.addEventListener("click", loadInsightsData);

loadPortfolioData();
