@echo off
setlocal

:loop
cd /d "%USERPROFILE%\bundang-home" || goto wait

echo [INFO] Sync with remote...
git pull --rebase
if errorlevel 1 (
  echo [WARN] git pull --rebase failed. Skip this cycle.
  goto wait
)

echo [INFO] Run scraper...
node scripts/scrape.js
if errorlevel 1 (
  echo [WARN] Scraper failed. Skip push.
  goto wait
)

echo [INFO] Validate data.json...
node -e "const d=require('./public/data.json'); if(!d||!Array.isArray(d.complexes)||d.complexes.length===0) process.exit(1); const ok=d.complexes.every(c=>c&&c.count&&typeof c.count.total==='number'&&Array.isArray(c.articles)&&c.articles.length===c.count.total); if(!ok) process.exit(1);"
if errorlevel 1 (
  echo [WARN] Validation failed. Skip push.
  goto wait
)

git add public/data.json
git diff --cached --quiet
if %errorlevel%==0 (
  echo [INFO] No data change. Nothing to commit.
  goto wait
)
if errorlevel 2 (
  echo [WARN] git diff failed. Skip push.
  goto wait
)

echo [INFO] Commit and push...
git commit -m "data: update listings %date% %time%"
if errorlevel 1 (
  echo [WARN] Commit failed. Skip push.
  goto wait
)

git push
if errorlevel 1 (
  echo [WARN] Push failed. Check Git auth/network.
)

:wait
timeout /t 1800 >nul
goto loop
