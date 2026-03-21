/**
 * 아파트 실거래 트래커 v5 — 면적 ㎡→평 변환, 동 정보 포함
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://hogangnono.com';

// 공급면적(㎡) → 전용면적(㎡) 매핑 (공시가격 데이터 기반)
const AREA_MAP = {
  '5dt68': { // 우성
    '74':  { supply: 74,  exclusive: 55.14 },
    '77':  { supply: 77,  exclusive: 57.27 },
    '86':  { supply: 86,  exclusive: 69.12 },
    '103': { supply: 103, exclusive: 84.97 },
    '122': { supply: 122, exclusive: 101.98 },
    '153': { supply: 153, exclusive: 129.72 },
    '188': { supply: 188, exclusive: 162.57 },
  },
  '5ds32': { // 라이프 — 전용면적은 추후 확인, 일단 공급면적만
    '66':  { supply: 66 },
    '91':  { supply: 91 },
    '105': { supply: 105 },
    '123': { supply: 123 },
    '152': { supply: 152 },
    '187': { supply: 187 },
  }
};

const COMPLEXES = [
  { hash: '5dt68', name: '상록마을3단지우성', alias: '상록우성',
    address: '성남시 분당구 내정로 55 (정자동)', totalUnits: 1762, dongs: '301~328동', builtYear: '1997', areaCount: 7 },
  { hash: '5ds32', name: '상록마을1,2단지라이프', alias: '상록라이프',
    address: '성남시 분당구 정자로 56 (정자동)', totalUnits: 466, dongs: '101~110, 201~205동', builtYear: '1997', areaCount: 6 }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Referer': 'https://hogangnono.com/'
};

const TRADE_TYPES = [{ code: 0, name: '매매' }, { code: 1, name: '전세' }];
const PY = 3.3058; // 1평 = 3.3058㎡

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(ep) {
  try {
    const res = await fetch(`${API_BASE}${ep}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const d = await res.json();
    return d.status === 'error' ? null : (d.data || d);
  } catch { return null; }
}

function fmtPrice(m) {
  if (!m) return '';
  const e = Math.floor(m / 10000), r = m % 10000;
  if (e > 0 && r > 0) return `${e}억 ${r.toLocaleString()}`;
  if (e > 0) return `${e}억`;
  return `${m.toLocaleString()}만`;
}

function areaLabel(hash, areaType) {
  const info = AREA_MAP[hash]?.[areaType];
  if (!info) return { sqm: Number(areaType), pyeong: Math.round(Number(areaType) / PY), label: `${areaType}㎡` };
  const sqm = info.exclusive || info.supply;
  const py = Math.round(sqm / PY);
  if (info.exclusive) {
    return { sqm: info.supply, exclusiveSqm: info.exclusive, pyeong: py, label: `전용 ${info.exclusive}㎡ (${py}평)` };
  }
  return { sqm: info.supply, pyeong: Math.round(info.supply / PY), label: `${info.supply}㎡ (${Math.round(info.supply / PY)}평)` };
}

async function main() {
  log('크롤러 v5 시작');
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} ━━━`);
    const allTrades = [];

    for (let areaNo = 0; areaNo < cx.areaCount; areaNo++) {
      for (const tt of TRADE_TYPES) {
        const data = await api(`/api/v2/apts/${cx.hash}/trade-real?tradeType=${tt.code}&areaNo=${areaNo}`);
        const trades = data?.data || [];
        if (trades.length > 0) {
          const raw = trades[0].areaType || '?';
          const al = areaLabel(cx.hash, raw);
          log(`  ${tt.name} ${al.label}: ${trades.length}건`);
          for (const t of trades) {
            if (t.isCancelled) continue;
            const ai = areaLabel(cx.hash, t.areaType);
            allTrades.push({
              tradeType: tt.name,
              price: t.price || 0,
              deposit: t.deposit || 0,
              floor: t.floor,
              dong: t.dong || '',
              areaSqm: ai.sqm,
              exclusiveSqm: ai.exclusiveSqm || null,
              pyeong: ai.pyeong,
              areaLabel: ai.label,
              areaRaw: t.areaType,
              date: t.date,
              dateAdded: t.dateAdded
            });
          }
        }
        await sleep(200);
      }
    }

    allTrades.sort((a, b) => new Date(b.date) - new Date(a.date));
    const sales = allTrades.filter(t => t.tradeType === '매매');
    const jeonse = allTrades.filter(t => t.tradeType === '전세');
    const areas = [...new Map(allTrades.map(t => [t.areaRaw, { raw: t.areaRaw, label: t.areaLabel, pyeong: t.pyeong, sqm: t.areaSqm }])).values()]
      .sort((a, b) => a.sqm - b.sqm);

    results.push({
      name: cx.name, alias: cx.alias, hash: cx.hash,
      address: cx.address, totalUnits: cx.totalUnits, dongs: cx.dongs, builtYear: cx.builtYear,
      areas,
      latestSale: sales[0] ? { price: fmtPrice(sales[0].price), priceRaw: sales[0].price,
        floor: sales[0].floor, dong: sales[0].dong, area: sales[0].areaLabel, pyeong: sales[0].pyeong, date: sales[0].date } : null,
      latestJeonse: jeonse[0] ? { price: fmtPrice(jeonse[0].deposit), priceRaw: jeonse[0].deposit,
        floor: jeonse[0].floor, area: jeonse[0].areaLabel, pyeong: jeonse[0].pyeong, date: jeonse[0].date } : null,
      trades: allTrades.map(t => ({
        ...t,
        priceFormatted: t.tradeType === '매매' ? fmtPrice(t.price) : fmtPrice(t.deposit),
        dateStr: t.date ? new Date(t.date).toISOString().split('T')[0].replace(/-/g, '.') : ''
      })),
      count: { sale: sales.length, jeonse: jeonse.length, total: allTrades.length }
    });

    log(`✅ ${cx.alias}: ${allTrades.length}건 | 평형: ${areas.map(a => a.label).join(', ')}`);
    await sleep(500);
  }

  const output = { updatedAt: new Date().toISOString(), source: 'hogangnono', complexes: results };
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장 완료 (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
