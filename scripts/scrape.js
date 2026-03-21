/**
 * 네이버 부동산 크롤러
 * fin.land.naver.com에서 특정 아파트 단지의 매물 정보를 수집
 * 
 * 전략:
 * 1. Playwright로 브라우저 접속 → 세션 쿠키 확보
 * 2. 검색 API로 단지 번호 조회
 * 3. 단지 상세 / 매물 목록 API 호출
 * 4. data.json으로 저장
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ─── 설정 ───────────────────────────────────────────────
const TARGET_COMPLEXES = [
  { keyword: '상록마을우성', alias: '상록우성 (3단지)', complexNumber: '2645', region: '분당구 정자동' },
  { keyword: '상록마을라이프', alias: '상록라이프 (1,2단지)', complexNumber: '2623', region: '분당구 정자동' }
];

const DATA_PATH = path.join(__dirname, '..', 'public', 'data.json');
const BASE_URL = 'https://fin.land.naver.com';

// ─── 유틸 ───────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  log('크롤러 시작');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });

  const page = await context.newPage();

  // API 응답 수집기
  const apiResponses = new Map();
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('front-api') && res.status() === 200) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await res.json();
          const key = new URL(url).pathname;
          apiResponses.set(key, body);
        }
      } catch (e) { /* ignore */ }
    }
  });

  // 1. 메인 페이지 로드 → 세션 확보
  log('메인 페이지 로드...');
  await page.goto(`${BASE_URL}/map`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000); // SPA 로드 대기
  log(`URL: ${page.url()}`);

  // 2. 각 단지별 데이터 수집
  const results = [];

  for (const target of TARGET_COMPLEXES) {
    log(`\n━━━ ${target.keyword} 검색 시작 ━━━`);
    const complexData = await scrapeComplex(page, context, target);
    if (complexData) {
      results.push(complexData);
      log(`✅ ${target.keyword}: ${complexData.articles?.length || 0}개 매물 수집`);
    } else {
      log(`❌ ${target.keyword}: 데이터 수집 실패`);
      results.push({
        name: target.keyword,
        error: '데이터 수집 실패',
        scrapedAt: new Date().toISOString()
      });
    }
    await sleep(2000); // 단지 간 딜레이
  }

  // 3. 데이터 저장
  const output = {
    updatedAt: new Date().toISOString(),
    complexes: results
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`\n데이터 저장 완료: ${DATA_PATH}`);

  await browser.close();
  log('크롤러 종료');
}

// ─── 단지별 스크래핑 ────────────────────────────────────
async function scrapeComplex(page, context, target) {
  try {
    // Step 1: 단지 번호가 설정에 있으면 검색 스킵
    let complexInfo;
    if (target.complexNumber) {
      log(`  단지 번호 직접 사용: ${target.complexNumber}`);
      complexInfo = { complexNumber: target.complexNumber, complexName: target.keyword };
    } else {
      complexInfo = await searchComplex(page, target.keyword);
      if (!complexInfo) {
        log(`  검색 결과 없음: ${target.keyword}`);
        return null;
      }
    }
    log(`  단지 발견: ${complexInfo.complexName} (No.${complexInfo.complexNumber})`);

    // Step 2: 단지 상세 정보 가져오기
    const detail = await getComplexDetail(page, complexInfo.complexNumber);

    // Step 3: 매물 목록 가져오기
    const articles = await getArticles(page, complexInfo.complexNumber);

    return {
      name: complexInfo.complexName,
      complexNumber: complexInfo.complexNumber,
      address: complexInfo.address || detail?.address || '',
      totalUnits: detail?.totalHouseholdCount || complexInfo.totalHouseholdCount || null,
      builtYear: detail?.useApprovalYearMonth || complexInfo.useApprovalYearMonth || null,
      floorAreaRatio: detail?.floorAreaRatio || null,
      buildingCoverageRatio: detail?.buildingCoverageRatio || null,
      articles: articles || [],
      articleCount: {
        sale: articles?.filter(a => a.tradeType === '매매').length || 0,
        jeonse: articles?.filter(a => a.tradeType === '전세').length || 0,
        monthly: articles?.filter(a => a.tradeType === '월세').length || 0
      },
      scrapedAt: new Date().toISOString()
    };
  } catch (err) {
    log(`  에러: ${err.message}`);
    return null;
  }
}

// ─── 검색 API ───────────────────────────────────────────
async function searchComplex(page, keyword) {
  log(`  검색 API 호출: ${keyword}`);
  
  const result = await page.evaluate(async (kw) => {
    try {
      const res = await fetch(`/front-api/v1/search/autocomplete/complexes?keyword=${encodeURIComponent(kw)}&size=10&page=0`);
      if (!res.ok) return { error: res.status };
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  }, keyword);

  if (result.error) {
    log(`  검색 API 에러: ${result.error}`);
    // Fallback: DOM 검색 시도
    return await searchComplexByDOM(page, keyword);
  }

  // 검색 결과에서 첫 번째 매칭 추출
  const complexes = result.complexes || result.result?.complexes || result.data?.complexes || [];
  if (complexes.length > 0) {
    return complexes[0];
  }

  // 응답 구조가 다를 수 있음
  if (Array.isArray(result)) {
    return result[0];
  }

  log(`  검색 결과 파싱 실패. 응답: ${JSON.stringify(result).substring(0, 200)}`);
  return await searchComplexByDOM(page, keyword);
}

// ─── DOM 기반 검색 (Fallback) ───────────────────────────
async function searchComplexByDOM(page, keyword) {
  log(`  DOM 검색 시도: ${keyword}`);

  // 검색창 열기
  try {
    await page.click('button:has-text("단지, 지역")', { timeout: 5000 });
  } catch {
    // 이미 열려있을 수 있음
  }
  await sleep(500);

  const input = await page.$('#header-search');
  if (!input) {
    log('  검색 입력창 없음');
    return null;
  }

  // 기존 텍스트 지우기
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await sleep(300);

  // 타이핑
  await page.keyboard.type(keyword, { delay: 120 });
  await sleep(3000);

  // 자동완성 목록에서 첫 번째 아파트 결과 클릭
  const suggestion = await page.$('[class*="SearchSuggestion"] [class*="item"]:first-child, [class*="autocomplete"] li:first-child, [class*="result"] li:first-child');
  if (suggestion) {
    const text = await suggestion.textContent();
    log(`  자동완성 결과: ${text?.trim().substring(0, 50)}`);
    await suggestion.click();
    await sleep(2000);

    // URL에서 단지 번호 추출 시도
    const url = page.url();
    const match = url.match(/complexNumber=(\d+)/);
    if (match) {
      return {
        complexNumber: match[1],
        complexName: keyword
      };
    }
  }

  // 매물 패널에서 정보 추출 시도
  const panelData = await page.evaluate(() => {
    const nameEl = document.querySelector('[class*="ComplexName"], [class*="complex-name"], [class*="title"]');
    const addrEl = document.querySelector('[class*="ComplexAddress"], [class*="address"]');
    return {
      name: nameEl?.textContent?.trim(),
      address: addrEl?.textContent?.trim()
    };
  });

  if (panelData.name) {
    return { complexName: panelData.name, address: panelData.address };
  }

  return null;
}

// ─── 단지 상세 정보 ────────────────────────────────────
async function getComplexDetail(page, complexNumber) {
  if (!complexNumber) return null;
  log(`  단지 상세 조회: ${complexNumber}`);

  const result = await page.evaluate(async (cn) => {
    const endpoints = [
      `/front-api/v1/complex/detail?complexNumber=${cn}`,
      `/front-api/v1/complex/${cn}`,
      `/front-api/v1/complex/info?complexNumber=${cn}`,
      `/front-api/v1/complex/complexDetail?complexNumber=${cn}`,
      `/front-api/v1/complex/overview?complexNumber=${cn}`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const data = await res.json();
          return { endpoint: ep, data };
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }, complexNumber);

  if (result) {
    log(`  상세 엔드포인트: ${result.endpoint}`);
    return result.data;
  }
  return null;
}

// ─── 매물 목록 ──────────────────────────────────────────
async function getArticles(page, complexNumber) {
  if (!complexNumber) return [];
  log(`  매물 목록 조회: ${complexNumber}`);

  const result = await page.evaluate(async (cn) => {
    const endpoints = [
      `/front-api/v1/article/list?complexNumber=${cn}&tradeType=&page=0&size=50`,
      `/front-api/v1/complex/${cn}/articles?page=0&size=50`,
      `/front-api/v1/article/complexArticles?complexNumber=${cn}&page=0&size=50`,
      `/front-api/v1/article/articleList?complexNumber=${cn}&orderType=prc&page=0&size=50`,
      `/front-api/v1/article/articles?complexNumber=${cn}&realEstateType=APT&page=0&size=50`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const data = await res.json();
          return { endpoint: ep, data };
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }, complexNumber);

  if (result) {
    log(`  매물 엔드포인트: ${result.endpoint}`);
    const data = result.data;

    // 응답 구조 파싱 (구조를 모르므로 여러 패턴 시도)
    const articles = data.articles || data.articleList || data.result?.articles || data.data?.articles || data.list || [];

    return articles.map(a => ({
      articleId: a.articleNumber || a.articleId || a.id,
      tradeType: a.tradeTypeName || a.tradeType || '',
      price: a.dealOrWarrantPrc || a.price || a.formattedPrice || '',
      deposit: a.warrantPrc || a.deposit || '',
      monthlyRent: a.rentPrc || a.monthlyRent || '',
      area: a.exclusiveArea || a.area || '',
      supplyArea: a.supplyArea || a.areaTotal || '',
      pyeong: a.exclusivePyeong || a.pyeongName || '',
      floor: a.floorInfo || a.floor || '',
      direction: a.directionName || a.direction || '',
      description: a.articleFeatureDesc || a.description || '',
      confirmDate: a.articleConfirmYmd || a.confirmDate || '',
      realtor: a.realtorName || a.agentName || ''
    }));
  }

  // API 실패 시 DOM에서 직접 추출
  log('  매물 API 실패, DOM 스크래핑 시도...');
  return await scrapeArticlesFromDOM(page, complexNumber);
}

// ─── DOM 기반 매물 추출 ─────────────────────────────────
async function scrapeArticlesFromDOM(page, complexNumber) {
  if (!complexNumber) return [];

  // 단지 페이지로 직접 이동하여 매물 패널 열기
  log('  단지 페이지 직접 이동 시도...');
  try {
    // 지도에서 단지 클릭 후 매물 패널이 열리는 URL 패턴 시도
    await page.goto(`${BASE_URL}/map?complexNumber=${complexNumber}`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await sleep(5000); // SPA 렌더링 대기

    // 매물 목록 패널에서 데이터 추출
    const articles = await page.evaluate(() => {
      const items = document.querySelectorAll(
        '[class*="ArticleItem"], [class*="article-item"], [class*="list-item"], ' +
        '[class*="ArticleListItem"], [class*="SaleItem"], [class*="article_item"]'
      );
      
      if (items.length === 0) {
        // 대안: 전체 텍스트에서 매물 패턴 추출
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n').filter(l => l.trim());
        
        // 가격 패턴 찾기 (ex: "매매 6억 2,000", "전세 3억")
        const pricePattern = /(매매|전세|월세)\s*(\d+억?\s*[\d,]*만?)/g;
        const found = [];
        for (const line of lines) {
          const matches = line.matchAll(pricePattern);
          for (const m of matches) {
            found.push({ tradeType: m[1], price: m[2], description: line.trim().substring(0, 100) });
          }
        }
        return found;
      }

      return Array.from(items).map(item => {
        const getText = (selectors) => {
          for (const s of selectors) {
            const el = item.querySelector(s);
            if (el) return el.textContent?.trim();
          }
          return '';
        };

        return {
          tradeType: getText(['[class*="trade-type"]', '[class*="TradeType"]', '[class*="type"]']),
          price: getText(['[class*="price"]', '[class*="Price"]', '[class*="amount"]']),
          area: getText(['[class*="area"]', '[class*="Area"]', '[class*="size"]']),
          floor: getText(['[class*="floor"]', '[class*="Floor"]']),
          description: getText(['[class*="desc"]', '[class*="Desc"]', '[class*="feature"]'])
        };
      });
    });

    log(`  DOM에서 ${articles.length}개 매물 추출`);
    return articles;
  } catch (err) {
    log(`  DOM 스크래핑 실패: ${err.message}`);
    return [];
  }
}

// ─── 실행 ───────────────────────────────────────────────
main().catch(err => {
  console.error('크롤러 에러:', err);
  process.exit(1);
});
