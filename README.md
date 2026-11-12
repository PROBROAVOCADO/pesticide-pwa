# 田間用藥 PWA v1.6.9

線上站台：https://pesticide.probroavocado.com

純靜態網站，無需建置。整個資料夾內容上傳 GitHub 儲存庫根目錄即可。
GitHub Pages 保持 Deploy from a branch → main → / (root)。

## 檔案分類

| 位置 | 用途 |
| --- | --- |
| index.html | 網站入口 |
| manifest.json、sw.js、CNAME | 安裝設定、離線快取及網域，必須保留根目錄 |
| assets/js/ | 主程式、畫面、用量計算、資料儲存與採收期邏輯 |
| assets/css/ | 畫面樣式 |
| assets/icons/ | 網站及手機安裝圖示 |
| data/ranges/ | 防檢署使用範圍資料快照 |
| tests/ | 自動化測試，不影響網站運作 |
| scripts/ | 維護資料的工具 |
| package.json | 測試與資料更新指令 |

## 從舊結構更新

請上傳本資料夾內的全部檔案與子資料夾，保持層級，不要將外層資料夾一起包成網站的子目錄。
舊版根目錄的 app.js、views.js、calc.js、calc-state.js、db.js、moa.js、records.js、range-catalog.js、styles.css、圖示與 *.test.js，以及舊 ranges/ 可刪除；新版已分類到上表位置。
不要刪除根目錄的 index.html、manifest.json、sw.js 或 CNAME。
若暫時留下舊檔，不會被新版入口使用，但建議清理避免混淆。

上傳後連網重新開啟 App；離線快取會更新，若仍是舊版，關閉後再開啟。
新版會顯示 v1.6.9 更新摘要。不要清除網站資料，土地和施作紀錄保存在原瀏覽器中。

## 本次更新

- 從「記一筆施作」記錄藥劑、資材或兩者一起使用，填到一半可稍後接續。
- 土地管理可設定用水量及常用組合。新增紀錄時帶入土地用水量，可依當次實際情況修改。
- 採收提醒會列出待確認的藥劑。舊紀錄依當時保存的採收天數顯示，缺資料的藥劑列為待確認。
- 施作紀錄可按藥名或日期搜尋，備份包含土地、常用組合、釘選藥劑與紀錄。

## 維護

執行 npm test 測試；執行 npm run update:ranges 更新官方資料快照。
發布時同步更新 assets/js/app.js 的 VERSION、index.html 頁首、assets/js/views.js 更新摘要與 sw.js 快取版本。
瀏覽器儲存識別、資料庫與站台網址維持原設定，檔案分類不會更換本機紀錄的儲存位置。
