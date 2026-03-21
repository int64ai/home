const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://fin.land.naver.com/front-api/v1';

const COMPLEXES = [
  { no: '2645', name: '상록마을3단지우성', alias: '상록우성' },
  { no: '2623', name: '상록마을1,2단지라이프', alias: '상록라이프' }
];

// B1=전세, A1=매매
const TRADE_TYPES = [
  { code: 'B1', name: '전세' },
  { code: 'A1', name: '매매' }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://fin.land.naver.com/'
};
const MAX_429_RETRIES = 10;

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPrice(n) {
  if (!n) return '';
  const v = typeof n === 'string' ? Number(n.replace(/,/g, '')) : n;
  const e = Math.floor(v / 10000), r = v % 10000;
  if (e > 0 && r > 0) return `${e}억 ${r.toLocaleString()}`;
  if (e > 0) return `${e}억`;
  return `${v.toLocaleString()}만`;
}

async function api(endpoint, retry = 0) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) {
    if (retry >= MAX_429_RETRIES) {
      throw new Error(`429 retry limit exceeded: ${endpoint}`);
    }
    log(`  ⚠ 429 — 2초 대기 후 재시도 (${retry + 1}/${MAX_429_RETRIES})`);
    await sleep(2000);
    return api(endpoint, retry + 1);
  }
  if (!res.ok) { log(`  ⚠ ${res.status}: ${endpoint}`); return null; }
  const data = await res.json();
  return data.result !== undefined ? data.result : data;
}

async function getArticles(complexNo, tradeType, maxPages = 5) {
  const articles = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await api(`/complex/article/list?complexNumber=${complexNo}&tradeType=${tradeType}&page=${page}&sizePerPage=20`);
    if (!data || !Array.isArray(data) || data.length === 0) break;
    articles.push(...data);
    log(`    p${page}: ${data.length}건`);
    if (data.length < 20) break;
    await sleep(1500);
  }
  return articles;
}

function parseArticle(a, tradeTypeName) {
  const isSale = tradeTypeName === '매매';
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
    direction: a.direction || '',
    description: a.articleFeatureDescription || '',
    realtor: a.realtorName || '',
    cpName: a.cpName || '',
    confirmDate: a.articleConfirmYmd || '',
    tags: a.tagList || []
  };
}

async function main() {
  log('매물 크롤러 시작 (네이버 부동산 API)');
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} (${cx.no}) ━━━`);
    // 평형 목록
    const pyeongs = await api(`/complex/pyeongList?complexNumber=${cx.no}`) || [];
    await sleep(1500);

    const allArticles = [];
    for (const tt of TRADE_TYPES) {
      log(`  ${tt.name} 매물 조회...`);
      const raw = await getArticles(cx.no, tt.code);
      allArticles.push(...raw.map(a => parseArticle(a, tt.name)));
      await sleep(2000);
    }

    const jeonse = allArticles.filter(a => a.tradeType === '전세');
    const sale = allArticles.filter(a => a.tradeType === '매매');
    results.push({
      name: cx.name, alias: cx.alias, complexNo: cx.no,
      pyeongs: Array.isArray(pyeongs) ? pyeongs.map(p => ({
        name: p.pyeongName, exclusive: p.exclusiveArea, supply: p.supplyArea
      })) : [],
      articles: allArticles,
      count: { total: allArticles.length, jeonse: jeonse.length, sale: sale.length }
    });

    log(`✅ ${cx.alias}: ${allArticles.length}건 (전세 ${jeonse.length} / 매매 ${sale.length})`);
    await sleep(2000);
  }

  const output = { updatedAt: new Date().toISOString(), source: 'naver_land', complexes: results };
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
