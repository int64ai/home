const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');

const debugLog = [];
function log(msg) { console.log(msg); debugLog.push(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test(label, url, headers = {}) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    ...headers
  };
  try {
    const res = await fetch(url, { headers: defaultHeaders, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const text = await res.text();
    log(`[${label}] ${res.status} (${text.length}b) ${url}`);
    log(`  headers: ${JSON.stringify(Object.fromEntries(res.headers))}`);
    log(`  body: ${text.slice(0, 300)}`);
    return { status: res.status, size: text.length, body: text.slice(0, 500) };
  } catch (err) {
    log(`[${label}] ERR: ${err.message} ${url}`);
    return { status: 0, error: err.message };
  }
}

async function main() {
  log('=== 네이버 부동산 접근 테스트 ===');

  // 테스트 1: HTML 페이지
  const r1 = await test('html', 'https://fin.land.naver.com/complexes/2645');
  await sleep(1000);

  // 테스트 2: API with Referer (HTML 먼저 접근 후)
  const r2 = await test('api-referer', 'https://fin.land.naver.com/front-api/v1/complex/pyeongList?complexNumber=2645', {
    'Accept': 'application/json',
    'Referer': 'https://fin.land.naver.com/complexes/2645'
  });
  await sleep(1000);

  // 테스트 3: API without prefix
  const r3 = await test('api-noprefix', 'https://fin.land.naver.com/front-api/v1/complex?complexNumber=2645', {
    'Accept': 'application/json',
    'Referer': 'https://fin.land.naver.com/'
  });
  await sleep(1000);

  // 테스트 4: 구 land.naver.com API
  const r4 = await test('old-api', 'https://new.land.naver.com/api/articles/complex/2645?tradeType=B1&page=1&spc=20', {
    'Accept': 'application/json'
  });
  await sleep(1000);

  // 테스트 5: fin API with cookie-like auth
  const r5 = await test('api-full-headers', 'https://fin.land.naver.com/front-api/v1/complex/article/list?complexNumber=2645&tradeType=B1&page=1&sizePerPage=20', {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://fin.land.naver.com/complexes/2645?tab=article&tradeType=B1',
    'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  });
  await sleep(1000);

  // 테스트 6: 호갱노노 (비교용 - 이건 작동하는 거 확인됨)
  const r6 = await test('hogangnono', 'https://hogangnono.com/api/v2/apts/5dt68/trade-real?tradeType=0&areaNo=0', {
    'Accept': 'application/json'
  });

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'debug_access_test',
    tests: { html: r1, apiReferer: r2, apiNoPrefix: r3, oldApi: r4, apiFullHeaders: r5, hogangnono: r6 },
    debugLog: debugLog.slice(-100),
    complexes: [], blocked: false
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log('\n저장 완료');
}

main().catch(err => { console.error(err); process.exit(1); });
