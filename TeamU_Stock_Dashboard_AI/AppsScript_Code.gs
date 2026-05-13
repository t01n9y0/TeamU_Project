function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback || "handleStockData";
  const action = params.action || "portfolio";

  let data;

  if (action === "chart") {
    data = buildChartData(params.code || "", params.range || "1D");
  } else if (action === "mini") {
    data = buildMiniChartData(params.code || "");
  } else if (action === "insights") {
    data = buildInsightsData();
  } else {
    data = buildPortfolioData();
  }

  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}


/* ==================================================
   主表資料
================================================== */

function buildPortfolioData() {
  const target = findBestPortfolioSheet();

  if (!target.success) {
    return {
      success: false,
      message: target.message,
      rows: []
    };
  }

  const values = target.values;
  const headerRowIndex = target.headerRowIndex;
  const headers = target.headers;
  const dataRows = values.slice(headerRowIndex + 1);

  const col = {
    code: headers.indexOf("國際代號"),
    shares: headers.indexOf("持股數"),
    avg: headers.indexOf("成交均價"),
    cost: headers.indexOf("投資成本")
  };

  const rawRows = dataRows
    .map(row => ({
      code: String(row[col.code] || "").trim(),
      shares: toNumber(row[col.shares]),
      avg: toNumber(row[col.avg]),
      cost: toNumber(row[col.cost])
    }))
    .filter(row =>
      row.code &&
      row.shares > 0 &&
      row.avg > 0 &&
      row.cost > 0
    );

  const misQuoteMap = fetchMisRealtimeQuotes(
    rawRows.map(row => row.code)
  );

  const needFallbackCodes = rawRows
    .filter(row => {
      const stockNo = extractStockNo(row.code);
      const quote = misQuoteMap[stockNo] || {};
      return !isValidQuoteNumber(quote.price);
    })
    .map(row => row.code);

  const yahooFallbackMap = needFallbackCodes.length
    ? fetchYahooLatestQuotesFromCharts(needFallbackCodes)
    : {};

  const companyMap = fetchCompanyNameMap();

  let quoteOkCount = 0;

  const rows = rawRows.map(row => {
    const stockNo = extractStockNo(row.code);

    const misQuote = misQuoteMap[stockNo] || {};
    const fallbackQuote = yahooFallbackMap[stockNo] || {};
    const company = companyMap[stockNo] || {};

    const price =
      isValidQuoteNumber(misQuote.price)
        ? Number(misQuote.price)
        : isValidQuoteNumber(fallbackQuote.price)
          ? Number(fallbackQuote.price)
          : null;

    const previousClose =
      isValidQuoteNumber(misQuote.previousClose)
        ? Number(misQuote.previousClose)
        : isValidQuoteNumber(fallbackQuote.previousClose)
          ? Number(fallbackQuote.previousClose)
          : null;

    if (price !== null) {
      quoteOkCount += 1;
    }

    const grossMarket = price !== null
      ? row.shares * price
      : null;

    const estimatedSellFee = grossMarket !== null
      ? calculateBrokerFee(grossMarket)
      : null;

    const estimatedSellTax = grossMarket !== null
      ? calculateTransactionTax(grossMarket)
      : null;

    const market = grossMarket !== null
      ? grossMarket - estimatedSellFee - estimatedSellTax
      : null;

    const profit = market !== null
      ? market - row.cost
      : null;

    const rate = profit !== null && row.cost
      ? (profit / row.cost) * 100
      : null;

    return {
      code: row.code,
      stockNo,
      name:
        misQuote.name ||
        company.shortName ||
        stockNo,
      shares: row.shares,
      avg: row.avg,
      cost: row.cost,
      price,
      previousClose,

      grossMarket,
      estimatedSellFee,
      estimatedSellTax,

      market,
      profit,
      rate,
      marketType: isOTC(row.code) ? "TPEX" : "TWSE"
    };
  });

  return {
    success: true,
    sheetName: target.sheetName,
    updatedAt: new Date().toISOString(),
    quoteOkCount,
    rows
  };
}


/* ==================================================
   成本試算：預估賣出手續費與交易稅
   - 一般台股證券交易稅：0.3%
   - 手續費：0.1425%，不足 20 元以 20 元計
================================================== */

function calculateBrokerFee(amount) {
  const fee = Math.floor(Number(amount || 0) * 0.001425);
  return Math.max(fee, 20);
}

function calculateTransactionTax(amount) {
  return Math.floor(Number(amount || 0) * 0.003);
}


/* ==================================================
   自動找持股工作表
================================================== */

function findBestPortfolioSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();

  const requiredHeaders = [
    "國際代號",
    "持股數",
    "成交均價",
    "投資成本"
  ];

  const bonusHeaders = [
    "股名",
    "現價",
    "帳面收入",
    "帳面市值",
    "損益",
    "損益率"
  ];

  const candidates = [];

  sheets.forEach(sheet => {
    const values = sheet.getDataRange().getDisplayValues();

    for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
      const normalizedRow = values[rowIndex].map(cell =>
        normalizeText(cell)
      );

      const hasAllRequired = requiredHeaders.every(header =>
        normalizedRow.includes(normalizeText(header))
      );

      if (!hasAllRequired) continue;

      const bonusScore = bonusHeaders.reduce((score, header) => {
        return score +
          (normalizedRow.includes(normalizeText(header)) ? 1 : 0);
      }, 0);

      const headers = normalizedRow;

      const col = {
        code: headers.indexOf("國際代號"),
        shares: headers.indexOf("持股數"),
        avg: headers.indexOf("成交均價"),
        cost: headers.indexOf("投資成本")
      };

      const positiveRows = values
        .slice(rowIndex + 1)
        .filter(row => {
          const code = String(row[col.code] || "").trim();
          const shares = toNumber(row[col.shares]);
          const avg = toNumber(row[col.avg]);
          const cost = toNumber(row[col.cost]);

          return code && shares > 0 && avg > 0 && cost > 0;
        }).length;

      candidates.push({
        sheet,
        sheetName: sheet.getName(),
        values,
        headerRowIndex: rowIndex,
        headers,
        bonusScore,
        positiveRows
      });
    }
  });

  if (!candidates.length) {
    return {
      success: false,
      message: "找不到必要欄位：國際代號、持股數、成交均價、投資成本"
    };
  }

  candidates.sort((a, b) => {
    if (b.bonusScore !== a.bonusScore) {
      return b.bonusScore - a.bonusScore;
    }

    return b.positiveRows - a.positiveRows;
  });

  const best = candidates[0];

  return {
    success: true,
    sheet: best.sheet,
    sheetName: best.sheetName,
    values: best.values,
    headerRowIndex: best.headerRowIndex,
    headers: best.headers
  };
}


/* ==================================================
   台股即時報價 MIS
================================================== */

function fetchMisRealtimeQuotes(codes) {
  if (!codes.length) return {};

  const channels = codes
    .map(code => toMisChannel(code))
    .filter(Boolean);

  if (!channels.length) return {};

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Referer": "https://mis.twse.com.tw/stock/index.jsp"
  };

  try {
    const initResponse = UrlFetchApp.fetch(
      "https://mis.twse.com.tw/stock/index.jsp",
      {
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true,
        headers
      }
    );

    const cookie = extractCookieHeader(initResponse);

    const apiHeaders = Object.assign({}, headers);

    if (cookie) {
      apiHeaders["Cookie"] = cookie;
    }

    const url =
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp" +
      "?ex_ch=" + encodeURIComponent(channels.join("|")) +
      "&json=1&delay=0&_=" + new Date().getTime();

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      headers: apiHeaders
    });

    const json = JSON.parse(response.getContentText("UTF-8"));
    const list = json && json.msgArray ? json.msgArray : [];

    const result = {};

    list.forEach(item => {
      const stockNo = String(item.c || "").trim();

      if (!stockNo) return;

      const price =
        cleanPrice(item.z) ||
        cleanPrice(item.pz) ||
        cleanPrice(item.y) ||
        null;

      const previousClose =
        cleanPrice(item.y) ||
        null;

      result[stockNo] = {
        name: item.n || item.nf || "",
        price,
        previousClose
      };
    });

    return result;
  } catch (error) {
    return {};
  }
}


/* ==================================================
   Yahoo Chart 備援現價
================================================== */

function fetchYahooLatestQuotesFromCharts(codes) {
  const requests = codes.map(code => {
    const symbol = toYahooSymbol(code);

    return {
      code,
      url:
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=1d&interval=5m&includePrePost=false&events=div%2Csplits`,
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    };
  });

  const result = {};

  try {
    const responses = UrlFetchApp.fetchAll(requests);

    responses.forEach((response, index) => {
      const code = requests[index].code;
      const stockNo = extractStockNo(code);

      try {
        const json = JSON.parse(response.getContentText("UTF-8"));

        const chartResult =
          json &&
          json.chart &&
          json.chart.result &&
          json.chart.result[0];

        if (!chartResult) return;

        const meta = chartResult.meta || {};

        const quotes =
          chartResult.indicators &&
          chartResult.indicators.quote &&
          chartResult.indicators.quote[0];

        const closes = quotes && quotes.close
          ? quotes.close
          : [];

        let latestClose = null;

        for (let i = closes.length - 1; i >= 0; i--) {
          const close = Number(closes[i]);

          if (Number.isFinite(close) && close > 0) {
            latestClose = close;
            break;
          }
        }

        const price =
          cleanPrice(meta.regularMarketPrice) ||
          cleanPrice(latestClose) ||
          null;

        const previousClose =
          cleanPrice(meta.chartPreviousClose) ||
          cleanPrice(meta.previousClose) ||
          cleanPrice(meta.regularMarketPreviousClose) ||
          null;

        result[stockNo] = {
          price,
          previousClose
        };
      } catch (error) {
        // 單檔失敗不影響其他股票
      }
    });
  } catch (error) {
    // 批次失敗則保留空物件
  }

  return result;
}


/* ==================================================
   Session Cookie
================================================== */

function extractCookieHeader(response) {
  const headers = response.getAllHeaders();
  const setCookie = headers["Set-Cookie"] || headers["set-cookie"];

  if (!setCookie) return "";

  const cookies = Array.isArray(setCookie)
    ? setCookie
    : [setCookie];

  return cookies
    .map(cookie => String(cookie).split(";")[0])
    .filter(Boolean)
    .join("; ");
}


/* ==================================================
   公司名稱備援
================================================== */

function fetchCompanyNameMap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("company_name_map_v1");

  if (cached) {
    return JSON.parse(cached);
  }

  const urls = [
    "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
    "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv"
  ];

  const map = {};

  urls.forEach(url => {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const csv = response.getContentText("UTF-8");
      const rows = Utilities.parseCsv(csv || "");

      rows.slice(1).forEach(row => {
        const code = String(row[1] || "").trim();
        const shortName = String(row[3] || "").trim();

        if (code && shortName) {
          map[code] = {
            shortName
          };
        }
      });
    } catch (error) {
      // 公司名稱抓取失敗時，不中斷主流程
    }
  });

  cache.put(
    "company_name_map_v1",
    JSON.stringify(map),
    21600
  );

  return map;
}


/* ==================================================
   表格右側當日小線圖
================================================== */

function buildMiniChartData(code) {
  const chart = fetchYahooChart(code, "1D");

  if (!chart.success) {
    return {
      success: false,
      message: chart.message || "暫時無法取得當日線圖",
      prices: [],
      openPrice: null
    };
  }

  return {
    success: true,
    prices: chart.points.map(point => point.price),
    openPrice: chart.openPrice || null
  };
}


/* ==================================================
   下方大線圖
================================================== */

function buildChartData(code, range) {
  return fetchYahooChart(code, range);
}


/* ==================================================
   Yahoo Chart 線圖資料
================================================== */

function fetchYahooChart(code, range) {
  const symbol = toYahooSymbol(code);

  if (!symbol) {
    return {
      success: false,
      message: "無法辨識股票代號",
      points: [],
      openPrice: null
    };
  }

  const chartConfig = getChartConfig(range);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(chartConfig.range)}` +
    `&interval=${encodeURIComponent(chartConfig.interval)}` +
    `&includePrePost=false&events=div%2Csplits`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    });

    const json = JSON.parse(response.getContentText("UTF-8"));

    const result =
      json &&
      json.chart &&
      json.chart.result &&
      json.chart.result[0];

    if (!result) {
      return {
        success: false,
        message: "暫時無法取得線圖資料",
        points: [],
        openPrice: null
      };
    }

    const timestamps = result.timestamp || [];

    const quotes =
      result.indicators &&
      result.indicators.quote &&
      result.indicators.quote[0];

    const closes = quotes && quotes.close
      ? quotes.close
      : [];

    const opens = quotes && quotes.open
      ? quotes.open
      : [];

    const points = [];

    let openPrice = null;

    for (let i = 0; i < opens.length; i++) {
      const open = Number(opens[i]);

      if (Number.isFinite(open) && open > 0) {
        openPrice = open;
        break;
      }
    }

    if (!openPrice) {
      for (let i = 0; i < closes.length; i++) {
        const close = Number(closes[i]);

        if (Number.isFinite(close) && close > 0) {
          openPrice = close;
          break;
        }
      }
    }

    if (
      !openPrice &&
      result.meta &&
      Number.isFinite(Number(result.meta.regularMarketOpen)) &&
      Number(result.meta.regularMarketOpen) > 0
    ) {
      openPrice = Number(result.meta.regularMarketOpen);
    }

    timestamps.forEach((timestamp, index) => {
      const price = closes[index];

      if (
        price === null ||
        price === undefined ||
        !Number.isFinite(Number(price))
      ) {
        return;
      }

      points.push({
        label: formatChartLabel(timestamp, range),
        price: Number(price)
      });
    });

    return {
      success: points.length > 0,
      message: points.length > 0
        ? ""
        : "暫時無法取得線圖資料",
      symbol,
      range,
      openPrice,
      points
    };
  } catch (error) {
    return {
      success: false,
      message: "線圖資料讀取失敗",
      points: [],
      openPrice: null
    };
  }
}


/* ==================================================
   AI 情報中心：近 3 日新聞 + Gemini 分析
================================================== */

function buildInsightsData() {
  const portfolio = buildPortfolioData();

  if (!portfolio.success) {
    return {
      success: false,
      message: portfolio.message || "持股資料讀取失敗。"
    };
  }

  const rows = portfolio.rows || [];
  const newsGroups = fetchRecentPortfolioNews(rows, 3);
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return {
      success: true,
      aiAvailable: false,
      aiMessage: "已抓取近 3 日新聞，但尚未設定 GEMINI_API_KEY。",
      newsGroups,
      portfolioRows: rows,
      aiAnalysis: null
    };
  }

  const analysis = callGeminiPortfolioAnalysis(rows, newsGroups, apiKey);

  if (!analysis.success) {
    return {
      success: true,
      aiAvailable: false,
      aiMessage: analysis.message || "Gemini 分析失敗，但新聞資料已載入。",
      newsGroups,
      portfolioRows: rows,
      aiAnalysis: null
    };
  }

  return {
    success: true,
    aiAvailable: true,
    aiMessage: "",
    newsGroups,
    portfolioRows: rows,
    aiAnalysis: analysis.data
  };
}


/* ==================================================
   近 3 日持股新聞
   每檔股票多組關鍵字搜尋，合併去重後保留最多 5 則
================================================== */

function fetchRecentPortfolioNews(rows, days) {
  const requests = [];

  rows.forEach(row => {
    const stockNo = row.stockNo || extractStockNo(row.code);
    const stockName = row.name || stockNo;

    const queries = [
      `"${stockName}" 股票 when:${days}d`,
      `"${stockName}" 股價 when:${days}d`,
      `"${stockName}" ${stockNo} when:${days}d`,
      `"${stockNo}" "${stockName}" when:${days}d`
    ];

    queries.forEach(query => {
      requests.push({
        code: row.code,
        stockNo,
        name: stockName,
        url:
          "https://news.google.com/rss/search?q=" +
          encodeURIComponent(query) +
          "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });
    });
  });

  const groupedMap = {};

  rows.forEach(row => {
    groupedMap[row.code] = {
      code: row.code,
      stockNo: row.stockNo || extractStockNo(row.code),
      name: row.name || row.stockNo || row.code,
      news: []
    };
  });

  try {
    const responses = UrlFetchApp.fetchAll(requests);

    responses.forEach((response, index) => {
      const meta = requests[index];
      const xmlText = response.getContentText("UTF-8");

      const items = parseGoogleNewsRss(xmlText)
        .filter(item => isWithinRecentDays(item.publishedAt, days))
        .filter(item => isRelevantNewsItem(item, meta.name, meta.stockNo));

      groupedMap[meta.code].news.push(...items);
    });
  } catch (error) {
    // 若新聞批次抓取失敗，保留空新聞陣列
  }

  Object.keys(groupedMap).forEach(code => {
    const news = groupedMap[code].news || [];

    const deduped = dedupeNewsItems(news)
      .sort((a, b) => {
        const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5);

    groupedMap[code].news = deduped;
  });

  return Object.values(groupedMap);
}


function parseGoogleNewsRss(xmlText) {
  try {
    const doc = XmlService.parse(xmlText);
    const root = doc.getRootElement();
    const channel = root.getChild("channel");

    if (!channel) return [];

    const items = channel.getChildren("item");
    const result = [];

    items.forEach(item => {
      const title = getXmlText(item, "title");
      const link = getXmlText(item, "link");
      const pubDateRaw = getXmlText(item, "pubDate");
      const source = getXmlText(item, "source") || "Google News";
      const description = stripHtml(getXmlText(item, "description"));
      const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;

      if (!title || !link) {
        return;
      }

      result.push({
        title,
        link,
        source,
        description,
        publishedAt: publishedAt ? publishedAt.toISOString() : "",
        publishedAtDisplay: publishedAt
          ? Utilities.formatDate(publishedAt, "Asia/Taipei", "MM/dd HH:mm")
          : ""
      });
    });

    return result;
  } catch (error) {
    return [];
  }
}


function getXmlText(element, childName) {
  const child = element.getChild(childName);
  return child ? child.getText() : "";
}


function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function isWithinRecentDays(dateValue, days) {
  if (!dateValue) return false;

  const targetDate = new Date(dateValue);

  if (isNaN(targetDate.getTime())) {
    return false;
  }

  const now = new Date();
  const diffMs = now.getTime() - targetDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays >= 0 && diffDays <= days;
}


function isRelevantNewsItem(item, stockName, stockNo) {
  const text = [
    item.title || "",
    item.description || ""
  ].join(" ");

  return (
    text.includes(stockName) ||
    text.includes(stockNo)
  );
}


function dedupeNewsItems(items) {
  const seen = new Set();
  const result = [];

  items.forEach(item => {
    const titleKey = normalizeNewsText(item.title);
    const linkKey = String(item.link || "").trim();
    const key = titleKey || linkKey;

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(item);
  });

  return result;
}


function normalizeNewsText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[｜|－—–\-_]/g, "")
    .trim()
    .toLowerCase();
}


/* ==================================================
   Gemini API
================================================== */

function getGeminiApiKey() {
  return PropertiesService
    .getScriptProperties()
    .getProperty("GEMINI_API_KEY");
}


function getGeminiModel() {
  return PropertiesService
    .getScriptProperties()
    .getProperty("GEMINI_MODEL") || "gemini-2.5-flash";
}


function callGeminiPortfolioAnalysis(rows, newsGroups, apiKey) {
  const model = getGeminiModel();

  const compactRows = rows.map(row => ({
    code: row.code,
    name: row.name,
    shares: row.shares,
    avg: row.avg,
    cost: row.cost,
    price: row.price,
    market: row.market,
    profit: row.profit,
    rate: row.rate
  }));

  const compactNews = newsGroups.map(group => ({
    code: group.code,
    name: group.name,
    news: (group.news || []).map(item => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAtDisplay
    }))
  }));

  const prompt = `
你是一個「台股持股資訊整理助手」。
請只根據我提供的持股資料與近 3 日新聞標題做分析，不可捏造事件，不可補充未提供的新聞內容。
若某檔股票新聞不足，請直接說明「近 3 日新聞較少」或「缺乏明確消息面」。
請輸出 JSON，不要加入 Markdown，不要加入額外說明。

【持股資料】
${JSON.stringify(compactRows)}

【近 3 日新聞】
${JSON.stringify(compactNews)}

【輸出格式】
{
  "portfolio": {
    "riskLevel": "低|中|高",
    "summary": "80到160字整體持股分析",
    "opportunities": ["機會1", "機會2", "機會3"],
    "risks": ["風險1", "風險2", "風險3"]
  },
  "stocks": [
    {
      "code": "國際代號",
      "name": "股名",
      "stance": "偏多觀察|中性觀察|保守觀察",
      "newsSentiment": "利多|中性|利空",
      "newsDigest": "40到100字新聞摘要",
      "suggestion": "40到100字個股建議",
      "reason": "30到80字判斷依據"
    }
  ]
}
`.trim();

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json"
    }
  };

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      muteHttpExceptions: true,
      contentType: "application/json",
      payload: JSON.stringify(payload)
    });

    const status = response.getResponseCode();
    const body = response.getContentText("UTF-8");
    const json = JSON.parse(body);

    if (status < 200 || status >= 300) {
      const detail =
        json &&
        json.error &&
        json.error.message
          ? json.error.message
          : "未知錯誤";

      return {
        success: false,
        message: `Gemini API 回傳錯誤：${status}｜${detail}`
      };
    }

    const text = extractGeminiText(json);

    if (!text) {
      return {
        success: false,
        message: "Gemini 回傳內容為空。"
      };
    }

    const parsed = safeParseJson(text);

    if (!parsed) {
      return {
        success: false,
        message: "Gemini 回傳內容無法解析為 JSON。"
      };
    }

    return {
      success: true,
      data: parsed
    };
  } catch (error) {
    return {
      success: false,
      message: `Gemini 分析請求失敗：${error.message || error}`
    };
  }
}


function extractGeminiText(json) {
  const candidates = json && Array.isArray(json.candidates)
    ? json.candidates
    : [];

  if (!candidates.length) {
    return "";
  }

  const content = candidates[0].content || {};
  const parts = Array.isArray(content.parts)
    ? content.parts
    : [];

  return parts
    .map(part => part.text || "")
    .join("")
    .trim();
}


function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    try {
      const cleaned = String(text)
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      return JSON.parse(cleaned);
    } catch (secondError) {
      return null;
    }
  }
}


/* ==================================================
   線圖區間
================================================== */

function getChartConfig(range) {
  switch (range) {
    case "5D":
      return {
        range: "5d",
        interval: "15m"
      };

    case "1M":
      return {
        range: "1mo",
        interval: "1d"
      };

    case "3M":
      return {
        range: "3mo",
        interval: "1d"
      };

    case "1D":
    default:
      return {
        range: "1d",
        interval: "5m"
      };
  }
}


/* ==================================================
   台股代號轉換
================================================== */

function toMisChannel(code) {
  const stockNo = extractStockNo(code);

  if (!stockNo) return "";

  return isOTC(code)
    ? `otc_${stockNo}.tw`
    : `tse_${stockNo}.tw`;
}


function toYahooSymbol(code) {
  const stockNo = extractStockNo(code);

  if (!stockNo) return "";

  return isOTC(code)
    ? `${stockNo}.TWO`
    : `${stockNo}.TW`;
}


/* ==================================================
   圖表日期格式
================================================== */

function formatChartLabel(timestamp, range) {
  const date = new Date(Number(timestamp) * 1000);

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  if (range === "1D" || range === "5D") {
    return `${month}/${day} ${hour}:${minute}`;
  }

  return `${month}/${day}`;
}


/* ==================================================
   通用工具
================================================== */

function extractStockNo(code) {
  const match = String(code).match(/(\d{4,6})/);
  return match ? match[1] : "";
}


function isOTC(code) {
  const text = String(code).toUpperCase();

  return (
    text.includes(".TWO") ||
    text.includes("TPEX") ||
    text.includes("OTC")
  );
}


function normalizeText(value) {
  return String(value || "")
    .replace(/\s/g, "")
    .trim();
}


function toNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .trim();

  const num = Number(cleaned);

  return Number.isFinite(num)
    ? num
    : 0;
}


function cleanPrice(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (!text || text === "-" || text === "--") {
    return null;
  }

  const num = Number(text);

  return Number.isFinite(num) && num > 0
    ? num
    : null;
}


function isValidQuoteNumber(value) {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}
