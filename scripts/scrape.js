const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');

const COMPLEXES = [
  { no: '2645', name: '상록마을3단지우성', alias: '상록우성' },
  { no: '2623', name: '상록마을1,2단지라이프', alias: '상록라이프' }
];

const TRADE_TYPES = [
  { code: 'B1', name: '전세', tab: 'tradeType=B1' },
  { code: 'A1', name: '매매', tab: 'tradeType=A1' }
];

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeRawArticle(raw) {
  const src = raw?.representativeArticleInfo || raw || {};
  const priceInfo = src.priceInfo || {};
  const articleDetail = src.articleDetail || {};
  const brokerInfo = src.brokerInfo || {};
  const spaceInfo = src.spaceInfo || {};
  const verificationInfo = src.verificationInfo || {};

  return {
    articleNumber: src.articleNumber || '',
    tradeType: src.tradeType || '',
    dealPrice: priceInfo.dealPrice ?? src.dealPrice ?? 0,
    warrantyAmount: priceInfo.warrantyPrice ?? src.warrantyAmount ?? 0,
    rentAmount: priceInfo.rentPrice ?? src.rentAmount ?? 0,
    floorInfo: articleDetail.floorInfo || src.floorInfo || '',
    buildingName: src.complexName || src.buildingName || '',
    dongName: src.dongName || '',
    exclusiveArea: spaceInfo.exclusiveSpace ?? src.exclusiveArea ?? '',
    direction: articleDetail.direction || src.direction || '',
    articleFeatureDescription: articleDetail.articleFeatureDescription || src.articleFeatureDescription || '',
    realtorName: brokerInfo.brokerageName || src.realtorName || '',
    cpName: brokerInfo.brokerName || src.cpName || '',
    articleConfirmYmd: verificationInfo.articleConfirmDate || src.articleConfirmYmd || '',
    tagList: src.tagList || []
  };
}

function extractArticlesFromPayload(payload) {
  if (Array.isArray(payload?.result?.list)) {
    return payload.result.list.map(normalizeRawArticle);
  }
  if (Array.isArray(payload?.result)) {
    return payload.result.map(normalizeRawArticle);
  }
  if (Array.isArray(payload)) {
    return payload.map(normalizeRawArticle);
  }
  return [];
}

async function scrapeComplex(page, complexNo, tradeType) {
  const url = `https://fin.land.naver.com/complexes/${complexNo}?tab=article&${tradeType.tab}`;
  log(`  ${tradeType.name}: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  try {
    await page.waitForSelector('[class*="article"]', { timeout: 10000 });
  } catch {
    log('  매물 목록 미발견 — 0건이거나 셀렉터 변경');
  }

  let prevCount = 0;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    const count = await page.evaluate(() =>
      document.querySelectorAll('[class*="ItemInner"], [class*="articleItem"], [class*="item_article"]').length
    );
    if (count === prevCount && count > 0) break;
    prevCount = count;
  }

  const articles = await page.evaluate(() => {
    const items = [];
    const cards = document.querySelectorAll(
      '[class*="item_article"], [class*="ArticleItem"], [class*="articleRow"], article[class*="item"]'
    );

    if (cards.length === 0) {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const data = JSON.parse(nextData.textContent);
          return { source: 'nextdata', raw: JSON.stringify(data).slice(0, 5000) };
        } catch {
          return { source: 'empty', cards: 0 };
        }
      }
      return { source: 'empty', cards: 0 };
    }

    cards.forEach(card => {
      const getAllText = () => card.textContent?.trim() || '';
      items.push({
        text: getAllText().slice(0, 500),
        html: card.innerHTML.slice(0, 1000)
      });
    });

    return { source: 'dom', items };
  });

  return articles;
}

async function scrapeViaIntercept(page, complexNo, tradeType) {
  const url = `https://fin.land.naver.com/complexes/${complexNo}?tab=article&${tradeType.tab}`;
  log(`  ${tradeType.name} (browser fetch): ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await sleep(2000);

  const payloads = await page.evaluate(async ({ complexNoIn, tradeTypeCode }) => {
    const out = [];
    let lastInfo = [];
    for (let pageNo = 1; pageNo <= 5; pageNo++) {
      const res = await fetch('/front-api/v1/complex/article/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          size: 30,
          complexNumber: complexNoIn,
          tradeTypes: [tradeTypeCode],
          pyeongTypes: [],
          dongNumbers: [],
          userChannelType: 'PC',
          articleSortType: 'RANKING_DESC',
          lastInfo
        })
      });
      if (!res.ok) {
        out.push({ __errorStatus: res.status });
        break;
      }
      const json = await res.json();
      out.push(json);
      const result = json?.result || {};
      const list = Array.isArray(result.list) ? result.list : [];
      if (!result.hasNextPage || list.length === 0) break;
      lastInfo = Array.isArray(result.lastInfo) ? result.lastInfo : [];
      await new Promise(r => setTimeout(r, 800));
    }
    return out;
  }, { complexNoIn: complexNo, tradeTypeCode: tradeType.code });

  const errorPayload = payloads.find(p => p && p.__errorStatus);
  if (errorPayload) {
    log(`  ⚠ browser fetch 상태코드: ${errorPayload.__errorStatus}`);
  }

  const merged = [];
  payloads.forEach(p => merged.push(...extractArticlesFromPayload(p)));
  if (merged.length > 0) {
    return merged;
  }

  log('  ⚠ browser fetch 데이터 없음, DOM fallback 시도');
  const dom = await scrapeComplex(page, complexNo, tradeType);
  if (dom?.source === 'dom' && Array.isArray(dom.items) && dom.items.length > 0) {
    return dom.items.map((d, idx) => ({
      articleNumber: `DOM-${complexNo}-${tradeType.code}-${idx + 1}`,
      tradeType: tradeType.code,
      dealPrice: 0,
      warrantyAmount: 0,
      rentAmount: 0,
      floorInfo: '',
      buildingName: '',
      dongName: '',
      exclusiveArea: '',
      direction: '',
      articleFeatureDescription: d.text || '',
      realtorName: '',
      cpName: '',
      articleConfirmYmd: '',
      tagList: []
    }));
  }

  return [];
}

// priceRaw = 원(won) 단위. 600000000 = 6억원
function fmtPrice(won) {
  if (!won) return '';
  const v = typeof won === 'string' ? Number(won.replace(/,/g, '')) : won;
  if (isNaN(v) || v === 0) return '';
  const eok = Math.floor(v / 100000000);
  const man = Math.floor((v % 100000000) / 10000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  if (man > 0) return `${man.toLocaleString()}만`;
  return `${v.toLocaleString()}원`;
}

const DIR_MAP = { NN:'북', SS:'남', EE:'동', WW:'서', NE:'북동', NW:'북서', SE:'남동', SW:'남서', NS:'남북', EW:'동서' };

function parseArticle(a) {
  const tradeTypeCode = String(a.tradeType || '').toUpperCase();
  const isSale = tradeTypeCode === 'A1';
  const tradeTypeName = isSale ? '매매' : '전세';
  const priceRaw = isSale
    ? Number(String(a.dealPrice || 0).replace(/,/g, ''))
    : Number(String(a.warrantyAmount || 0).replace(/,/g, ''));
  return {
    tradeType: tradeTypeName,
    articleNo: a.articleNumber || '',
    price: fmtPrice(priceRaw),
    priceRaw,
    rent: !isSale && a.rentAmount ? fmtPrice(a.rentAmount) : '',
    floor: a.floorInfo || '',
    dong: a.buildingName || a.dongName || '',
    area: a.exclusiveArea || '',
    pyeong: a.exclusiveArea ? Math.round(Number(a.exclusiveArea) / 3.3058) : '',
    direction: DIR_MAP[a.direction] || a.direction || '',
    description: a.articleFeatureDescription || '',
    realtor: a.realtorName || '',
    cpName: a.cpName || '',
    confirmDate: a.articleConfirmYmd || '',
    tags: a.tagList || []
  };
}

async function main() {
  log('매물 크롤러 시작 (Playwright 브라우저 방식)');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} (${cx.no}) ━━━`);
    const allArticles = [];

    for (const tt of TRADE_TYPES) {
      const rawArticles = await scrapeViaIntercept(page, cx.no, tt);
      const filtered = rawArticles.filter(a => String(a.tradeType || '').toUpperCase() === tt.code);
      const parsed = filtered.map(a => parseArticle(a));
      allArticles.push(...parsed);
      log(`  ${tt.name}: ${parsed.length}건`);
      await sleep(3000);
    }

    const jeonse = allArticles.filter(a => a.tradeType === '전세');
    const sale = allArticles.filter(a => a.tradeType === '매매');

    results.push({
      name: cx.name, alias: cx.alias, complexNo: cx.no,
      articles: allArticles,
      count: { total: allArticles.length, jeonse: jeonse.length, sale: sale.length }
    });

    log(`✅ ${cx.alias}: ${allArticles.length}건 (전세 ${jeonse.length} / 매매 ${sale.length})`);
    await sleep(3000);
  }

  await browser.close();

  const output = { updatedAt: new Date().toISOString(), source: 'naver_land', complexes: results };
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
