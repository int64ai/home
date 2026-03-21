/**
 * 아파트 매물 트래커 v6 — 네이버 부동산 매물 API
 * 
 * 엔드포인트: fin.land.naver.com/front-api/v1/
 * - /complex/article/list — 매물 목록
 * - /complex/article/count — 매물 개수  
 * - /complex/pyeongList — 평형 목록
 * 
 * tradeType: A1=매매, B1=전세, B2=월세
 * 
 * ⚠ 클라우드 IP에서 429 차단 가능 — GitHub Actions는 IP 풀이 넓어서 통과 기대
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const API_BASE = 'https://fin.land.naver.com/front-api/v1';

const COMPLEXES = [
  { no: '2645', name: '상록마을3단지우성', alias: '상록우성',
    address: '성남시 분당구 내정로 55 (정자동)', totalUnits: 1762, builtYear: '1997' },
  { no: '2623', name: '상록마을1,2단지라이프', alias: '상록라이프',
    address: '성남시 분당구 정자로 56 (정자동)', totalUnits: 466, builtYear: '1997' }
];

const TRADE_TYPES = [
  { code: 'B1', name: '전세' },
  { code: 'A1', name: '매매' }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://fin.land.naver.com/complexes/2645'
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (res.status === 429) {
      log(`  ⚠ 429 차단: ${endpoint}`);
      return { error: '429', blocked: true };
    }
    if (!res.ok) {
      log(`  ⚠ ${res.status}: ${endpoint}`);
      return { error: res.status };
    }
    const data = await res.json();
    return data.result || data;
  } catch (err) {
    log(`  ✗ ${endpoint}: ${err.message}`);
    return { error: err.message };
  }
}

function fmtPrice(manwon) {
  if (!manwon) return '';
  const n = Number(String(manwon).replace(/,/g, ''));
  if (isNaN(n)) return String(manwon);
  const e = Math.floor(n / 10000), r = n % 10000;
  if (e > 0 && r > 0) return `${e}억 ${r.toLocaleString()}`;
  if (e > 0) return `${e}억`;
  return `${n.toLocaleString()}만`;
}

async function getPyeongList(complexNo) {
  const data = await api(`/complex/pyeongList?complexNumber=${complexNo}`);
  if (data?.error) return [];
  // data는 배열 — [{pyeongTypeNumber, pyeongName, exclusiveArea, supplyArea, ...}]
  return Array.isArray(data) ? data : [];
}

async function getArticleCount(complexNo, tradeType) {
  const data = await api(`/complex/article/count?complexNumber=${complexNo}&tradeType=${tradeType}`);
  if (data?.error) return 0;
  return data?.totalCount || data?.count || 0;
}

async function getArticleList(complexNo, tradeType, page = 1) {
  const data = await api(`/complex/article/list?complexNumber=${complexNo}&tradeType=${tradeType}&page=${page}&sizePerPage=50`);
  if (data?.error) return { articles: [], error: data.error };
  // data는 배열일 수도 {articles:[]}일 수도
  const articles = Array.isArray(data) ? data : (data?.articles || data?.list || []);
  return { articles };
}

async function main() {
  log('매물 크롤러 v6 시작 (네이버 부동산)');
  let blocked = false;
  const results = [];

  for (const cx of COMPLEXES) {
    log(`\n━━━ ${cx.alias} (No.${cx.no}) ━━━`);

    // 1. 평형 목록
    log('  평형 목록 조회...');
    const pyeongList = await getPyeongList(cx.no);
    if (pyeongList.length > 0) {
      log(`  ✓ ${pyeongList.length}개 평형`);
    } else {
      log('  ⚠ 평형 목록 없음 (차단 또는 에러)');
    }
    await sleep(1000);

    // 2. 매물 목록 (전세 → 매매)
    const allArticles = [];
    for (const tt of TRADE_TYPES) {
      log(`  ${tt.name} 매물 조회...`);
      
      // 매물 개수 먼저
      const count = await getArticleCount(cx.no, tt.code);
      await sleep(800);
      
      if (typeof count === 'object' && count?.blocked) {
        blocked = true;
        log(`  ✗ ${tt.name}: 429 차단됨`);
        continue;
      }
      log(`  ${tt.name} 매물: ${count}건`);

      // 매물 목록 (최대 3페이지 = 150건)
      let page = 1;
      let fetched = 0;
      while (page <= 3) {
        const { articles, error } = await getArticleList(cx.no, tt.code, page);
        if (error === '429') { blocked = true; break; }
        if (!articles.length) break;
        
        for (const a of articles) {
          allArticles.push({
            tradeType: tt.name,
            articleNo: a.articleNumber || a.articleNo || '',
            articleName: a.articleName || '',
            price: tt.code === 'A1' 
              ? fmtPrice(a.dealPrice || a.price)
              : fmtPrice(a.warrantyAmount || a.deposit),
            priceRaw: tt.code === 'A1' 
              ? Number(String(a.dealPrice || a.price || 0).replace(/,/g, ''))
              : Number(String(a.warrantyAmount || a.deposit || 0).replace(/,/g, '')),
            rent: tt.code === 'B1' ? 0 : (a.rentAmount || a.rent || 0),
            floor: a.floorInfo || a.floor || '',
            dong: a.buildingName || a.dongName || '',
            area: a.exclusiveArea || a.supplyArea || '',
            pyeongName: a.pyeongName || '',
            direction: a.direction || '',
            description: a.articleFeatureDescription || a.description || '',
            realtorName: a.realtorName || a.cpName || '',
            confirmDate: a.articleConfirmYmd || '',
            tags: a.tagList || []
          });
        }
        
        fetched += articles.length;
        log(`    p${page}: ${articles.length}건 (총 ${fetched}건)`);
        page++;
        await sleep(1000);
      }
    }

    // 평형 정보 정리
    const pyeongs = pyeongList.map(p => ({
      typeNo: p.pyeongTypeNumber,
      name: p.pyeongName || '',
      exclusive: p.exclusiveArea,
      supply: p.supplyArea,
      pyeong: p.pyeongName ? parseInt(p.pyeongName) : Math.round((p.exclusiveArea || p.supplyArea || 0) / 3.3058)
    }));

    const jeonse = allArticles.filter(a => a.tradeType === '전세');
    const sale = allArticles.filter(a => a.tradeType === '매매');

    results.push({
      name: cx.name, alias: cx.alias, complexNo: cx.no,
      address: cx.address, totalUnits: cx.totalUnits, builtYear: cx.builtYear,
      pyeongs,
      articles: allArticles,
      count: { total: allArticles.length, jeonse: jeonse.length, sale: sale.length },
      scrapedAt: new Date().toISOString()
    });

    log(`✅ ${cx.alias}: 매물 ${allArticles.length}건 (전세 ${jeonse.length} / 매매 ${sale.length})`);
    await sleep(1500);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'naver_land',
    blocked,
    complexes: results
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n저장: ${DATA_PATH} (${(JSON.stringify(output).length / 1024).toFixed(1)}KB)`);
  
  if (blocked) {
    log('⚠ 일부 요청이 429 차단됨 — IP가 차단 목록일 수 있음');
    // 차단되어도 exit 0 — 다음 실행에서 다시 시도
  }
  log('크롤러 종료');
}

main().catch(err => { console.error('에러:', err); process.exit(1); });
