/**
 * 아파트 매물 트래커 v3 — 호갱노노 API
 * 
 * 데이터 소스: hogangnono.com/api/v2
 * - 실거래가 (매매/전세/월세)
 * - 지역 시세 비교
 * - 평형별 정보
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://hogangnono.com';

const COMPLEXES = [
  {
    hash: '5dt68',
    name: '상록마을3단지우성',
    alias: '상록우성',
    naverComplexNo: '2645',
    address: '경기도 성남시 분당구 내정로 55 (정자동 121)',
    totalUnits: 1762,
    dongs: '301~328동 (304 제외)',
    builtYear: '1997'
  },
  {
    hash: '5ds32',
    name: '상록마을1,2단지라이프',
    alias: '상록라이프',
    naverComplexNo: '2623',
    address: '경기도 성남시 분당구 정자로 56 (정자동 124)',
    totalUnits: 466,
    dongs: '101~110, 201~205동 (104,204 제외)',
    builtYear: '1997'
  }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://hogangnono.com/'
};

// tradeType: 0=매매, 1=전세, 2=월세
const TRADE_TYPES = [
  { code: 0, name: '매매' },
  { code: 1, name: '전세' },
  { code: 2, name: '월세' }
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiFetch(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      log(`  ⚠ ${endpoint} → ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data.status === 'error') {
      log(`  ⚠ ${endpoint} → ${data.message}`);
      return null;
    }
    return data.data || data;
  } catch (err) {
    log(`  ✗ ${endpoint} → ${err.message}`);
    return null;
  }
}

// ─── 실거래가 수집 ──────────────────────────────────────
async function getTrades(hash, tradeType) {
  const data = await apiFetch(`/api/v2/apts/${hash}/trade-real?tradeType=${tradeType}&areaNo=0`);
  if (!data?.data) return [];

  return data.data.map(t => ({
    id: t.id,
    tradeType: TRADE_TYPES.find(tt => tt.code === tradeType)?.name || '',
    price: t.price || 0,          // 매매가 (만원)
    deposit: t.deposit || 0,      // 보증금 (만원)
    rent: t.rent || 0,            // 월세 (만원)
    floor: t.floor,
    dong: t.dong || '',
    areaType: t.areaType || '',   // 평형 (ex: "74")
    date: t.date,
    dateAdded: t.dateAdded,
    isCancelled: t.isCancelled || false,
    useRenewal: t.useRenewal || 0,
    method: t.method || ''
  }));
}

// ─── 지역 시세 비교 ─────────────────────────────────────
async function getRegionRange(hash) {
  const data = await apiFetch(`/api/apt/regionRange?apt=${hash}&areaNo=0`);
  return data || null;
}

// ─── 매물 현황 (호갱노노에 등록된 매물) ────────────────
async function getItems(hash) {
  const data = await apiFetch(`/api/v2/apts/${hash}/items`);
  return data || { aptItems: [], aptItemTotalCount: 0 };
}

async function getItemSummary(hash) {
  const data = await apiFetch(`/api/v2/apts/${hash}/item-summary`);
  return data || { areaItemSummaries: [], tradeCount: 0, depositCount: 0, rentCount: 0 };
}

// ─── 가격 포맷팅 ────────────────────────────────────────
function formatPrice(manwon) {
  if (!manwon || manwon === 0) return '';
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (eok > 0 && rest > 0) return `${eok}억 ${rest.toLocaleString()}`;
  if (eok > 0) return `${eok}억`;
  return `${manwon.toLocaleString()}만`;
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  log('크롤러 v3 시작 (호갱노노 API)');

  const results = [];

  for (const complex of COMPLEXES) {
    log(`\n━━━ ${complex.name} (${complex.hash}) ━━━`);

    // 실거래가 수집 (매매/전세/월세)
    const allTrades = [];
    for (const tt of TRADE_TYPES) {
      log(`  ${tt.name} 실거래가 조회...`);
      const trades = await getTrades(complex.hash, tt.code);
      log(`  ✓ ${tt.name}: ${trades.length}건`);
      allTrades.push(...trades);
      await sleep(500);
    }

    // 지역 시세 비교
    log('  지역 시세 조회...');
    const regionRange = await getRegionRange(complex.hash);
    await sleep(300);

    // 매물 현황
    log('  매물 현황 조회...');
    const items = await getItems(complex.hash);
    const itemSummary = await getItemSummary(complex.hash);
    await sleep(300);

    // 가격 통계 계산
    const saleTrades = allTrades.filter(t => t.tradeType === '매매' && !t.isCancelled);
    const jeonseTrads = allTrades.filter(t => t.tradeType === '전세' && !t.isCancelled);
    const rentTrades = allTrades.filter(t => t.tradeType === '월세' && !t.isCancelled);

    const latestSale = saleTrades[0];
    const latestJeonse = jeonseTrads[0];

    results.push({
      name: complex.name,
      alias: complex.alias,
      hash: complex.hash,
      naverComplexNo: complex.naverComplexNo,
      address: complex.address,
      totalUnits: complex.totalUnits,
      dongs: complex.dongs,
      builtYear: complex.builtYear,
      
      // 최근 실거래 요약
      latestTrades: {
        sale: latestSale ? {
          price: formatPrice(latestSale.price),
          priceRaw: latestSale.price,
          floor: latestSale.floor,
          area: latestSale.areaType,
          date: latestSale.date,
          dong: latestSale.dong
        } : null,
        jeonse: latestJeonse ? {
          price: formatPrice(latestJeonse.deposit),
          priceRaw: latestJeonse.deposit,
          floor: latestJeonse.floor,
          area: latestJeonse.areaType,
          date: latestJeonse.date
        } : null
      },

      // 전체 실거래 내역
      trades: allTrades.map(t => ({
        ...t,
        priceFormatted: t.tradeType === '매매' ? formatPrice(t.price) :
                        t.tradeType === '전세' ? formatPrice(t.deposit) :
                        `${formatPrice(t.deposit)}/${t.rent}만`,
        dateFormatted: t.date ? new Date(t.date).toISOString().split('T')[0] : ''
      })),

      tradeCount: {
        sale: saleTrades.length,
        jeonse: jeonseTrads.length,
        monthly: rentTrades.length
      },

      // 매물 현황
      items: items.aptItems || [],
      itemCount: items.aptItemTotalCount || 0,
      itemSummary: {
        trade: itemSummary.tradeCount || 0,
        deposit: itemSummary.depositCount || 0,
        rent: itemSummary.rentCount || 0
      },

      // 지역 비교
      regionRange: regionRange ? {
        dong: regionRange.dong,
        sigungu: regionRange.sigungu
      } : null,

      scrapedAt: new Date().toISOString()
    });

    log(`✅ ${complex.alias}: 실거래 ${allTrades.length}건 (매매${saleTrades.length}/전세${jeonseTrads.length}/월세${rentTrades.length})`);
    await sleep(1000);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'hogangnono',
    complexes: results
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n데이터 저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
  log('크롤러 종료');
}

main().catch(err => {
  console.error('크롤러 에러:', err);
  process.exit(1);
});
