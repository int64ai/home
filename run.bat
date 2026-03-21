@echo off
:loop
cd /d %USERPROFILE%\bundang-home
node scripts/scrape.js
git add public/data.json
git commit -m "📊 매물 업데이트 %date% %time%"
git push
timeout /t 1800
goto loop
