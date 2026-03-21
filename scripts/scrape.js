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

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://fin.land.naver.com/complexes/2645'
};

const debugLog = [];
function log(msg) { console.log(msg); debugLog.push(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rawFetch(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    log(`[${res.status}] ${endpoint} → ${text.slice(0, 500)}`);
    return { status: res.status, text, json: res.status === 200 ? JSON.parse(text) : null };
  } catch (err) {
    log(`[ERR] ${endpoint} → ${err.message}`);
    return { status: 0, text: err.message, json: null };
  }
}

async function main() {
  log('=== 매물 크롤러 v6.1 디버그 ===');
  
  // 테스트 1: 기본 페이지 접근
  log('\n--- 테스트 1: 메인 페이지 ---');
  const mainPage = await rawFetch('/../complexes/2645');
  await sleep(500);

  // 테스트 2: 평형 목록
  log('\n--- 테스트 2: 평형 목록 ---');
  const pyeong = await rawFetch('/complex/pyeongList?complexNumber=2645');
  await sleep(500);

  // 테스트 3: 매물 개수
  log('\n--- 테스트 3: 매물 개수 ---');
  const countB1 = await rawFetch('/complex/article/count?complexNumber=2645&tradeType=B1');
  await sleep(500);
  const countA1 = await rawFetch('/complex/article/count?complexNumber=2645&tradeType=A1');
  await sleep(500);

  // 테스트 4: 매물 목록
  log('\n--- 테스트 4: 매물 목록 ---');
  const listB1 = await rawFetch('/complex/article/list?complexNumber=2645&tradeType=B1&page=1&sizePerPage=20');
  await sleep(500);

  // 테스트 5: 다른 엔드포인트들
  log('\n--- 테스트 5: 단지 기본정보 ---');
  const complexInfo = await rawFetch('/complex?complexNumber=2645');
  await sleep(500);

  // 테스트 6: 호가 정보
  log('\n--- 테스트 6: 호가 ---');
  const askingPrice = await rawFetch('/complex/askingPrice?complexNumber=2645&tradeType=B1');
  await sleep(500);

  // 테스트 7: 매물 count filter
  log('\n--- 테스트 7: count filter ---');
  const countFilter = await rawFetch('/complex/article/count/filter?complexNumber=2645&tradeType=B1');

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'naver_land_debug',
    debugLog: debugLog.slice(-100),
    responses: {
      pyeong: { status: pyeong.status, sample: pyeong.text?.slice(0, 500) },
      countB1: { status: countB1.status, sample: countB1.text?.slice(0, 500) },
      countA1: { status: countA1.status, sample: countA1.text?.slice(0, 500) },
      listB1: { status: listB1.status, sample: listB1.text?.slice(0, 500) },
      complexInfo: { status: complexInfo.status, sample: complexInfo.text?.slice(0, 500) },
      askingPrice: { status: askingPrice.status, sample: askingPrice.text?.slice(0, 500) },
      countFilter: { status: countFilter.status, sample: countFilter.text?.slice(0, 500) }
    },
    complexes: [],
    blocked: false
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log('\n디버그 데이터 저장 완료');
}

main().catch(err => { console.error(err); process.exit(1); });
