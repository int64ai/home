/**
 * 아파트 매물 트래커 v7 — 아실(asil.kr) API
 * 
 * 아실 = 네이버 부동산과 동일 KISO 데이터 소스
 * GitHub Actions에서 차단 없이 작동
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://realty.asil.kr/api_asil';

const COMPLEXES = [
  { bldcode: '6254', name: '상록마을3단지우성', alias: '상록우성',
    address: '성남시 분당구 내정로 55 (정자동)', totalUnits: 1762, builtYear: '1997' },
  { bldcode: '6252', name: '상록마을1차라이프', alias: '상록라이프1차',
    address: '성남시 분당구 정자로 56 (정자동)', totalUnits: 466, builtYear: '1997' },
  { bldcode: '50356', name: '상록마을2차라이프', alias: '상록라이프2차',
    address: '성남시 분당구 정자로 56 (정자동)', totalUnits: 0, builtYear: '1997' }
];

const BDONG_CD = '4113510300'; // 정자동

// A01=매매, B01=전세
const TRADE_TYPES = [
  { code: 'B01', name: '전세' },
  { code: 'A01', name: '매매' }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Referer': 'https://asil.kr/'
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPrice(val) {
  if (!val) return '';
  const n = typeof val === 'string' ? Number(val.replace(/,/g, '')) : val;
  if (isNaN(n) || n === 0) return '';
  const e = Math.floor(n / 10000), r = n % 10000;
  if (e > 0 && r > 0) return `${e}억 ${r.toLocaleString()}`;
  if (e > 0) return `${e}억`;
  return `${n.toLocaleString()}만`;
}

async function fetchArticles(bldcode, tradeType) {
  const articles = [];
  let page = 1;
  const maxPages = 5;

  while (page <= maxPages) {
    const url = `${API_BASE}/offers_list.aspx?bdong_cd=${BDONG_CD}&asil_bldcode=${bldcode}&srch_dealtype=${tradeType}&now_page=${page}`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        log(`  ⚠ ${res.status}: page ${page}`);
        break;
      }
      const data = await res.json();
      
      // 아실 API: 결과 없으면 {"result":"0"}, 있으면 {"list_result":[...]}
      const items = data?.list_result || [];
      
      if (!items.length) break;
      articles.push(...items);
      log(`  p${page}: ${items.length}건`);

      // 다음 페이지
      const hasNext = items.some(i => i.next_flag);
      if (!hasNext || items.length < 20) break;
      
      page++;
      await sleep(500);
    } catch (err) {
      log(`  ✗ page ${page}: ${err.message}`);
      break;
    }
  }
  return articles;
}

async function fetchDetail(mmUid) {
  try {
    const res = await fetch(`${API_BASE}/data_sale_of_detail.aspx?mm_uid=${mmUid}`, {
      headers: HEADERS, signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function parseArticle(r, tradeTypeName) {
  const priceRaw = tradeTypeName === '매매'
    ? Number(String(r.DEAL_AMT || 0).replace(/,/g, ''))
    : Number(String(r.WRRNT_AMT || 0).replace(/,/g, ''));
  const rentRaw = Number(String(r.LEASE_AMT || 0).replace(/,/g, ''));

  return {
    tradeType: r.DEALTYPE_NM || tradeTypeName,
    articleId: r.mm_uid || '',
    price: fmtPrice(priceRaw),
    priceRaw,
    rent: rentRaw > 0 ? fmtPrice(rentRaw) : '',
    rentRaw,
    floor: r.CORES_FLR_CNT || '',
    totalFloor: r.TOT_FLR_CNT || '',
    dong: r.DONG_NM || '',
    exclusiveArea: r.EXCLS_SPC || '',
    supplyArea: r.SPLY_SPC || '',
    pyeong: r.EXCLS_SPC ? Math.round(Number(r.EXCLS_SPC) / 3.3058) : '',
    direction: '',
    description: r.FETR_DESC || '',
    realtor: r.BRKG_NM || '',
    realtorTel: r.BRKG_TEL || '',
    confirmDate: r.SVC_DATE_STRT || '',
    buildingName: r.BLDNM || ''
  };
}

async function main() {
  log('매물 크롤러 v7 시작 (아실 API)');
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} (bldcode=${cx.bldcode}) ━━━`);
    const allArticles = [];

    for (const tt of TRADE_TYPES) {
      log(`  ${tt.name} 매물 조회...`);
      const rawList = await fetchArticles(cx.bldcode, tt.code);
      log(`  ✓ ${tt.name}: ${rawList.length}건`);

      for (const raw of rawList) {
        allArticles.push(parseArticle(raw, tt.name));
      }
      await sleep(800);
    }

    const jeonse = allArticles.filter(a => a.tradeType === '전세');
    const sale = allArticles.filter(a => a.tradeType === '매매');

    results.push({
      name: cx.name, alias: cx.alias, bldcode: cx.bldcode,
      address: cx.address, totalUnits: cx.totalUnits, builtYear: cx.builtYear,
      articles: allArticles,
      count: { total: allArticles.length, jeonse: jeonse.length, sale: sale.length },
      scrapedAt: new Date().toISOString()
    });

    log(`✅ ${cx.alias}: 매물 ${allArticles.length}건 (전세 ${jeonse.length} / 매매 ${sale.length})`);
    await sleep(1000);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'asil',
    sourceLabel: '아실 (네이버 부동산 동일 데이터)',
    complexes: results
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
