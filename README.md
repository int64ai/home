# 🏠 네이버 부동산 매물 트래커

상록우성 · 상록라이프 (성남시 분당구 정자동) 아파트 매물을 30분마다 자동으로 수집하여 보여주는 대시보드.

## 구조

```
├── .github/workflows/scrape.yml   ← 30분 크론 (GitHub Actions)
├── scripts/scrape.js              ← Playwright 크롤러
├── public/
│   ├── index.html                 ← 대시보드 웹페이지
│   └── data.json                  ← 크롤링 데이터 (자동 업데이트)
├── package.json
└── vercel.json
```

## 설정

1. Vercel에 연결 (Output Directory: `public`)
2. GitHub Actions 권한: Settings → Actions → Workflow permissions → Read and write
3. Actions 탭에서 수동 실행 또는 30분 자동 크론 대기
