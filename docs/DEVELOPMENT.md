# 新電腦安裝、測試及部署

## 一份完整專案

主要 Git 工作區是 Desktop/nds-cal，原 Documents/nds-cal 的檔案保持原樣。
根目錄 worker.js 是唯一的正式 Worker 原始碼；wrangler.jsonc 綁定同一個 D1。
請不要再從 Documents 的舊 Worker 部署，否則會覆蓋新功能及本機 CORS。
原 church-calendar repository／網站沒有修改，也沒有匯入其活動資料。

需要 Node.js 24 或更新版本與 Git：

    git clone https://github.com/tawuahc-oss/nds-cal.git
    cd nds-cal
    npm ci
    npm test
    npm run build

已鎖定套件版本及 lockfile。農曆套件、中文字型及授權檔均隨專案保存，
執行網站不需臨時依賴第三方 CDN。字型下載與 Python 轉換只供維護更新，
一般開發與新電腦安裝不需要 Python。

## 本機

    npm start

npm start 與 npm run preview 均啟動隔離測試。

    npm run preview

http://127.0.0.1:8081/?preview=1 是獨立的記憶體資料庫測試環境。
測試帳戶只存在 scripts/preview.mjs，不能登入正式 API。
關閉測試伺服器便會捨棄全部測試資料。

## 部署前

1. 保存目前 Worker 版本 ID 及 SQL／JSON 備份，先做本機還原驗證。
2. npm test、npm run build、npm run worker:check。
3. 詳閱 docs/migrations.md。
4. Wrangler 登入授權後套用 migrations，再部署：

       npx wrangler login
       npx wrangler d1 migrations apply DB --remote
       npx wrangler deploy
       npm run check:live

5. Worker 會同時發布 dist 網頁及 API。開啟 https://nds-cal.tawuahc.workers.dev/。
   dist 僅包含公開頁面與明確允許的資產，不包含開發測試頁、Worker、
   備份、node_modules 或機密設定。
6. 在正式頁用自己的帳密測試：登入、普通活動、重複系列、單次例外、登出、
   年度 PDF 及 JSON。未完成這個驗收前，不宣稱已正式開放其他同工使用。

## GitHub Actions

checks.yml 在 push／PR 上測試及打包，不需要任何雲端機密。
deploy.yml 是手動啟動的部署流程；需先設定 Pages 使用 GitHub Actions，
及 production environment 的最小權限 CLOUDFLARE_API_TOKEN Secret。
目前不預設每天／每週自動備份，也不需要 Google 授權金鑰。
未設定 Secret 前，部署工作會明確失敗，不能誤報成功。
只有 nds-cal 是部署目標，不可更改 church-calendar。

## 回復

先讀取 Wrangler 的目前指令：

    npx wrangler rollback --help

回復程式與還原資料是兩件事。程式回復不會回復已更改的 D1 活動。
改密碼功能上線並使用後，不可直接回退到忽略 admin_credentials 的舊版本。
遇到事故先停寫、另做最新備份，在本機驗證修復再套用。

## 免費方案與維護

50–200 名訪客／日通常適合此規模，但仍需以實際 Metrics 監察。
目前單次公開查詢最多 366 天、每次最多 2,000 個展開活動；管理清單以每頁 200 筆分頁讀取。
不能把「每天瀏覽人數」直接當成 API 請求或 D1 讀取列數。
PBKDF2-SHA256 使用 100,000 次運算；本機測試不代表 Cloudflare Free 的 CPU
配額已通過壓力測試。不要為省 CPU 降低雜湊強度；如遇 CPU 錯誤應先量測再選方案。
政府目前只公布部分年份的假期，年度更新時執行 npm run update:holidays，
測試後提交新資料。網站會標示尚未收錄的年份。

官方參考：
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://www.1823.gov.hk/common/ical/gc/tc.ics
- https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
