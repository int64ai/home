/**
 * 네이버 부동산 크롤러 v2 — Playwright 없이 순수 HTTP
 * 
 * 전략:
 * 1. fin.land.naver.com 메인에서 세션 쿠키 확보
 * 2. front-api로 단지 상세 + 매물 조회
 * 3. data.json 저장
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const BASE_URL = 'https://fin.land.naver.com';

const TARGET_COMPLEXES = [
  { keyword: '상록마을우성', alias: '상록우성 (3단지)', complexNumber: '2645', region: '분당구 정자동' },
  { keyword: '상록마을라이프', alias: '상록라이프 (1,2단지)', complexNumber: '2623', region: '분당구 정자동' }
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://fin.land.naver.com/map',
  'Origin': 'https://fin.land.naver.com',
  'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin'
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 쿠키 관리 ──────────────────────────────────────────
let cookies = '';

async function initSession() {
  log('세션 초기화...');
  try {
    const res = await fetch(BASE_URL, {
      headers: { 'User-Agent': HEADERS['User-Agent'] },
      redirect: 'follow'
    });
    
    // Set-Cookie 헤더에서 쿠키 추출
    const setCookies = res.headers.getSetCookie?.() || [];
    cookies = setCookies.map(c => c.split(';')[0]).join('; ');
    log(`세션 쿠키: ${cookies ? cookies.substring(0, 80) + '...' : '없음'}`);
    log(`세션 응답: ${res.status} → ${res.url}`);
    return true;
  } catch (err) {
    log(`세션 초기화 실패: ${err.message}`);
    return false;
  }
}

// ─── API 호출 ───────────────────────────────────────────
async function apiGet(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Cookie: cookies }
    });
    log(`  GET ${endpoint} → ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    log(`  GET ${endpoint} → 에러: ${err.message}`);
    return null;
  }
}

async function apiPost(endpoint, body) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookies, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    log(`  POST ${endpoint} → ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    log(`  POST ${endpoint} → 에러: ${err.message}`);
    return null;
  }
}

// ─── 단지 정보 조회 (엔드포인트 탐색) ──────────────────
async function getComplexDetail(complexNumber) {
  log(`단지 상세 조회: ${complexNumber}`);
  
  const endpoints = [
    `/front-api/v1/complex/overview?complexNumber=${complexNumber}`,
    `/front-api/v1/complex/detail?complexNumber=${complexNumber}`,
    `/front-api/v1/complex/complexDetail?complexNumber=${complexNumber}`,
    `/front-api/v1/complex/info?complexNumber=${complexNumber}`,
    `/front-api/v1/complex/${complexNumber}`
  ];

  for (const ep of endpoints) {
    const data = await apiGet(ep);
    if (data && !data.error && !data.detailCode) {
      log(`  ✅ 단지 상세 성공: ${ep}`);
      return data;
    }
    await sleep(300);
  }
  return null;
}

// ─── 매물 목록 조회 (엔드포인트 탐색) ──────────────────
async function getArticles(complexNumber) {
  log(`매물 목록 조회: ${complexNumber}`);

  const endpoints = [
    `/front-api/v1/article/list?complexNumber=${complexNumber}&tradeType=&page=0&size=50`,
    `/front-api/v1/article/articleList?complexNumber=${complexNumber}&page=0&size=50`,
    `/front-api/v1/article/complexArticles?complexNumber=${complexNumber}&page=0&size=50`,
    `/front-api/v1/article/articles?complexNumber=${complexNumber}&realEstateType=APT&page=0&size=50`,
    `/front-api/v1/complex/${complexNumber}/articles?page=0&size=50`
  ];

  for (const ep of endpoints) {
    const data = await apiGet(ep);
    if (data && !data.error && !data.detailCode) {
      log(`  ✅ 매물 목록 성공: ${ep}`);
      return parseArticles(data);
    }
    await sleep(300);
  }

  // POST 방식도 시도
  const postEndpoints = [
    { ep: '/front-api/v1/article/list', body: { complexNumber, page: 0, size: 50 } },
    { ep: '/front-api/v1/article/complexArticles', body: { complexNumber, page: 0, size: 50 } }
  ];

  for (const { ep, body } of postEndpoints) {
    const data = await apiPost(ep, body);
    if (data && !data.error && !data.detailCode) {
      log(`  ✅ 매물 목록 성공 (POST): ${ep}`);
      return parseArticles(data);
    }
    await sleep(300);
  }

  return [];
}

// ─── 매물 데이터 파싱 ───────────────────────────────────
function parseArticles(data) {
  // 응답 구조 탐색 — 구조를 모르므로 여러 패턴
  const articles = data.articles || data.articleList || data.result?.articles || 
                   data.data?.articles || data.list || data.body?.articles ||
                   (Array.isArray(data) ? data : []);

  if (!Array.isArray(articles)) {
    log(`  매물 파싱 실패 — 응답 키: ${Object.keys(data).join(', ')}`);
    // 한 단계 더 깊이 탐색
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) {
        log(`  발견된 배열 키: ${key} (${val.length}개)`);
        return mapArticles(val);
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const subkey of Object.keys(val)) {
          if (Array.isArray(val[subkey]) && val[subkey].length > 0) {
            log(`  발견된 배열 키: ${key}.${subkey} (${val[subkey].length}개)`);
            return mapArticles(val[subkey]);
          }
        }
      }
    }
    return [];
  }

  return mapArticles(articles);
}

function mapArticles(articles) {
  return articles.map(a => ({
    articleId: a.articleNumber || a.articleId || a.id || '',
    tradeType: a.tradeTypeName || a.tradeType || '',
    price: a.dealOrWarrantPrc || a.price || a.formattedPrice || '',
    deposit: a.warrantPrc || a.deposit || '',
    monthlyRent: a.rentPrc || a.monthlyRent || '',
    area: a.exclusiveArea || a.area || '',
    supplyArea: a.supplyArea || '',
    pyeong: a.exclusivePyeong || a.pyeongName || a.pyeong || '',
    floor: a.floorInfo || a.floor || '',
    direction: a.directionName || a.direction || '',
    description: a.articleFeatureDesc || a.description || a.articleDesc || '',
    confirmDate: a.articleConfirmYmd || a.confirmDate || '',
    realtor: a.realtorName || a.agentName || ''
  }));
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  log('크롤러 v2 시작 (HTTP 직접 호출)');

  await initSession();

  const results = [];

  for (const target of TARGET_COMPLEXES) {
    log(`\n━━━ ${target.keyword} (${target.complexNumber}) ━━━`);
    
    const detail = await getComplexDetail(target.complexNumber);
    await sleep(500);
    const articles = await getArticles(target.complexNumber);
    
    const saleCount = articles.filter(a => a.tradeType.includes('매매')).length;
    const jeonseCount = articles.filter(a => a.tradeType.includes('전세')).length;
    const monthlyCount = articles.filter(a => a.tradeType.includes('월세')).length;

    results.push({
      name: detail?.complexName || target.keyword,
      alias: target.alias,
      complexNumber: target.complexNumber,
      address: detail?.address || detail?.roadAddress || `성남시 분당구 정자동`,
      totalUnits: detail?.totalHouseholdCount || detail?.householdCount || null,
      builtYear: detail?.useApprovalYearMonth || detail?.approvalDate || null,
      detail: detail ? {
        floorAreaRatio: detail.floorAreaRatio,
        buildingCoverageRatio: detail.buildingCoverageRatio,
        parkingCount: detail.parkingCount || detail.totalParkingCount,
        heatingType: detail.heatingType || detail.heatingMethodName
      } : null,
      articles,
      articleCount: { sale: saleCount, jeonse: jeonseCount, monthly: monthlyCount },
      scrapedAt: new Date().toISOString()
    });

    log(`✅ ${target.keyword}: 상세=${detail ? 'O' : 'X'}, 매물=${articles.length}개 (매매${saleCount}/전세${jeonseCount}/월세${monthlyCount})`);
    await sleep(1000);
  }

  const output = { updatedAt: new Date().toISOString(), complexes: results };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n데이터 저장: ${DATA_PATH}`);
  log('크롤러 종료');
}

main().catch(err => {
  console.error('크롤러 에러:', err);
  process.exit(1);
});
