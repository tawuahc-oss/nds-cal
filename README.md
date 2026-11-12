# NDS Church Calendar (nds-cal)

教會月曆、同一介面的活動／分類／重複規則管理，以及年度 PDF 封存。

- 正式月曆：https://nds-cal.tawuahc.workers.dev/
- API 健康檢查：https://nds-cal.tawuahc.workers.dev/api/health
- 資料庫：Cloudflare D1 nds-cal，binding DB；此 Worker 不使用 Supabase。
- 時區：Asia/Hong_Kong。
- 原 church-calendar 網站不會由此專案部署或修改。

## 開始

需要 Node.js 24+。

    npm ci
    npm test
    npm run build
    npm start

npm start 與 npm run preview 均使用隔離測試資料。開啟 http://127.0.0.1:8081/。

## 說明

- [管理員操作及年度封存](docs/OPERATIONS.md)
- [新電腦、測試、部署及回復](docs/DEVELOPMENT.md)
- [資料庫 migration 計畫](docs/migrations.md)
- [資料表結構](docs/schema.sql)

worker.js 是唯一正式後端原始碼。舊測試 HTML 保留供開發比較，不包含於 dist 公開發佈包。
備份、機密、本機資料及 node_modules 都被 .gitignore 排除。

## 公開資料故障備援

正常連線保留既有管理員登入及編輯。公開月程在 D1 故障時改讀獨立 KV 副本，標示唯讀及保存時間；管理員 API 不會改讀備份，也不能離線修改。預先保存去年、今年及明年，其他成功讀取的年份可另行保存。修改後背景刷新預設三個年份，公開讀取最多每 15 分鐘補新；有同步延遲，備份不含內部備註。

瀏覽器以 Service Worker 保存公開介面及已讀取的日期範圍，全站暫時連不上時，曾完成快取的裝置仍可閱讀。不保證新裝置、清除快取或未保存日期可離線閱讀。管理員登入及備註不會快取。服務恢復後重新整理，仍用原有帳戶編輯。獨立平台的月程備用站另由週報 repository 的 calendar-backup 維護。
