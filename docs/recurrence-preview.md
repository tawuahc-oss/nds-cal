# 重複活動核對與日期預覽

核對日期：2026-11-03（香港）。本 chat 負責重複活動及管理介面；備份交由另一個 chat 處理。

## 實際狀態

目前工作目錄是 Desktop/nds-cal，而非原清單的 Documents/nds-cal。
Git origin 指向 tawuahc-oss/nds-cal。核對時 Git 僅追蹤 README.md 及四個舊測試頁；
Worker、新首頁、資產及測試等仍是未追蹤檔案。因此本機功能不代表 GitHub 已同步。
沒有更動 church-calendar。

Cloudflare 唯讀核對：
- 正式 nds-cal Worker 回報程式版本 v5；100% 使用版本 38ab9f40-e857-42a6-945f-11c0e02ed8ba。
- DB 綁定 ba8f9aca-0e73-4880-b7f6-161b4b94bac7，與 wrangler.jsonc 相符。
- ADMIN_USERNAME、ADMIN_PASSWORD_HASH 是 Secret 綁定，未讀取其值。
- 正式程式已有 ordinal weekday helper，但未有 /api/admin/calendar-events 或日期預覽路由。
- 正式 D1 的「每月聚會測試」：start_at=2026-11-02、frequency=monthly、interval_value=1、by_weekday=1MO、day_of_month=NULL，沒有結束日期或次數上限。
- 正式 D1 尚無 admin_credentials 表；部署本機 v6 前須按 migrations.md 處理新增表。

上述 D1 查詢全部唯讀，changes=0、rows_written=0。沒有更改正式活動、帳戶或資料庫結構。
直接呼叫公開 API 的網絡測試失敗，因此未將公開 API 在線端到端測試標記為通過。

## 本機已存在的功能

本機 worker.js 的 health 版本是 v6。已有登入、分類與普通活動 CRUD、
整合 event/rule 交易儲存、系列與單次例外 API，以及改密碼與一次性復原碼程式。
首頁已有整合管理介面、月份切換、分類篩選、日夜模式、農曆與節氣程式。
這些是程式碼及自動測試核對結果，不代表已完成正式環境或各裝置視覺驗收。
PDF、Drive、自動備份與還原由另一個 chat 負責，這裡不作完成判定。

## 本次新增

在活動表格選擇重複規則後，可按「預覽未來一年日期」。
預覽使用 Worker 同一套 validateRecurrence / expandSeries；不儲存活動。
開始日期必須符合所選規則。範圍包含開始當日，最多 366 天，顯示首 12 次及範圍內總次數。
預覽不包含已保存的單次修改／取消；舊系列的例外請用「單次活動／恢復」查看。
修改表格會清除舊預覽，過期的網絡回應不會覆蓋新表格結果。

範例：開始 2026-11-02 → 每月 → 每月第幾個星期幾 → 第一個 → 星期一。
首六次：2026-11-02、2026-12-07、2027-01-04、2027-02-01、2027-03-01、2027-04-05。
「每月與開始日期同一日」則是每月 2 日，兩者不同。

API：POST /api/admin/recurrence-preview，需 Bearer 管理員工作階段。
JSON body 為 {event, rule}，格式與整合儲存 API 相同。
回傳 {from, to, total, starts}；starts 最多 12 個，total 為此範圍的總次數。
此路由不需新資料表。

## 本機驗證及操作

1. 安裝 Node.js 與 npm，進入本專案後執行 npm ci。
2. 執行 npm test：本階段 26 項通過，涵蓋原有 CRUD、系列例外、登入限制、農曆及新增日期預覽。
3. 執行 npm run preview，開啟 http://127.0.0.1:8081/?preview=1。
   此模式使用記憶體測試資料；帳號 preview-admin、密碼 preview-only 僅供本機測試。
   正常首頁與 npm start 連接正式 API，切勿當作隔離測試環境。
4. 於本機測試登入、點選日期、新增活動、設定第一個星期一、按預覽，再測試儲存及單次例外。
5. 執行 npm run build。dist 僅包含公開首頁及允許的資產，不包含舊測試頁。

## 上線尚需完成

先由備份 chat 完成備份與還原驗證，再按 migrations.md 準備遷移。
本階段沒有執行 migration、部署、Git 提交或 push。
必須先部署支援整合儲存及預覽的 Worker，再發布對應前端；舊 v5 無法支援新表格完整流程。
發布前須做手機／平板／電腦視覺驗收、正式 API 登入與 CRUD 驗收，
並由帳戶持有人主動更換曾曝光密碼。請勿把測試密碼或真實憑證加入正式設定。
