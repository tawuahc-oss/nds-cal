# 資料庫變更與還原

## 2026-11-03 基線

正式 Worker：nds-cal，D1：nds-cal，綁定：DB。
修改前版本：38ab9f40-e857-42a6-945f-11c0e02ed8ba。
完整 Worker、設定及 SQL／JSON 資料備份已放在 .local-backups/，不會提交 Git。
已用 Node SQLite 還原 SQL，核對所有資料表筆數及 foreign_key_check。
Google Drive 只保存不含登入工作階段、密碼雜湊及內部稽核資料的活動備份。

## 0001 管理員自助改密碼及復原碼

新增一張 admin_credentials 單例資料表；不修改任何既有活動表或資料。
資料表初始為空，登入仍使用原有 Cloudflare Secrets。
只有管理員在網站主動提交改密碼／產生復原碼，才會儲存覆寫值。
現有 Secrets 不會被程式修改。

部署順序：備份 → 本機測試 migration → 套用 CREATE TABLE IF NOT EXISTS →
部署使用此表的 Worker → 驗證公開 API 與未授權保護。
此 migration 可重複執行。舊 Worker 不讀取新表，因此可回退程式而保留表。
**若有人已在新網站改過密碼，不可直接回退到忽略此表的舊 Worker**，
否則會重新接受舊 Secret 密碼；應先安排維護並明確選擇有效帳密。

復原：先在本機副本還原並驗證，再於維護時段套用。
不要直接把整份備份匯入仍在服務的正式資料庫。還原前另做一次最新備份。
日常活動還原不應還原登入工作階段；還原後重新登入。
