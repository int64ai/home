/**
 * 아파트 실거래 트래커 v4 — 전 평형 수집, 월세 제외
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://hogangnono.com';

const COMPLEXES = [
  {
    hash: '5dt68', name: '상록마을3단지우성', alias: '상록우성',
    naverNo: '2645', address: '성남시 분당구 내정로 55 (정자동)',
    totalUnits: 1762, dongs: '301~328동', builtYear: '1997',
    areaCount: 7  // areaNo 0~6
  },
  {
    hash: '5ds32', name: '상록마을1,2단지라이프', alias: '상록라이프',
    naverNo: '2623', address: '성남시 분당구 정자로 56 (정자동)',
    totalUnits: 466, dongs: '101~110, 201~205동', builtYear: '1997',
    areaCount: 6  // areaNo 0~5
  }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://hogangnono.com/'
};

// 매매(0), 전세(1)만 수집 — 월세 제외
const TRADE_TYPES = [
  { code: 0, name: '매매' },
  { code: 1, name: '전세' }
];

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'error') return null;
    return data.data || data;
  } catch { return null; }
}

function fmtPrice(m) {
  if (!m) return '';
  const e = Math.floor(m / 10000), r = m % 10000;
  if (e > 0 && r > 0) return `${e}억 ${r.toLocaleString()}`;
  if (e > 0) return `${e}억`;
  return `${m.toLocaleString()}만`;
}

async function main() {
  log('크롤러 v4 시작');
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} (${cx.hash}) ━━━`);
    const allTrades = [];

    // 모든 평형 × 매매/전세 수집
    for (let areaNo = 0; areaNo < cx.areaCount; areaNo++) {
      for (const tt of TRADE_TYPES) {
        const data = await api(`/api/v2/apts/${cx.hash}/trade-real?tradeType=${tt.code}&areaNo=${areaNo}`);
        const trades = data?.data || [];
        if (trades.length > 0) {
          const area = trades[0].areaType || '?';
          log(`  ${tt.name} ${area}평 (areaNo=${areaNo}): ${trades.length}건`);
          for (const t of trades) {
            if (t.isCancelled) continue; // 취소 거래 제외
            allTrades.push({
              tradeType: tt.name,
              price: t.price || 0,
              deposit: t.deposit || 0,
              rent: t.rent || 0,
              floor: t.floor,
              dong: t.dong || '',
              area: t.areaType || '',
              date: t.date,
              dateAdded: t.dateAdded
            });
          }
        }
        await sleep(200);
      }
    }

    // 날짜 내림차순 정렬
    allTrades.sort((a, b) => new Date(b.date) - new Date(a.date));

    const sales = allTrades.filter(t => t.tradeType === '매매');
    const jeonse = allTrades.filter(t => t.tradeType === '전세');

    // 평형 목록 추출
    const areas = [...new Set(allTrades.map(t => t.area))].sort((a, b) => Number(a) - Number(b));

    results.push({
      name: cx.name, alias: cx.alias, hash: cx.hash,
      address: cx.address, totalUnits: cx.totalUnits,
      dongs: cx.dongs, builtYear: cx.builtYear,
      areas,
      latestSale: sales[0] ? {
        price: fmtPrice(sales[0].price), priceRaw: sales[0].price,
        floor: sales[0].floor, area: sales[0].area, dong: sales[0].dong,
        date: sales[0].date
      } : null,
      latestJeonse: jeonse[0] ? {
        price: fmtPrice(jeonse[0].deposit), priceRaw: jeonse[0].deposit,
        floor: jeonse[0].floor, area: jeonse[0].area,
        date: jeonse[0].date
      } : null,
      trades: allTrades.map(t => ({
        ...t,
        priceFormatted: t.tradeType === '매매' ? fmtPrice(t.price) : fmtPrice(t.deposit),
        dateStr: t.date ? new Date(t.date).toISOString().split('T')[0].replace(/-/g, '.') : ''
      })),
      count: { sale: sales.length, jeonse: jeonse.length, total: allTrades.length },
      scrapedAt: new Date().toISOString()
    });

    log(`✅ ${cx.alias}: ${allTrades.length}건 (매매${sales.length}/전세${jeonse.length}) | 평형: ${areas.join(', ')}`);
    await sleep(500);
  }

  const output = { updatedAt: new Date().toISOString(), source: 'hogangnono', complexes: results };
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
