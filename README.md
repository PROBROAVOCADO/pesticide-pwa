# 田間用藥 PWA

查詢農業部公開的殺菌劑、殺蟲劑登記資料，並依作物、施用面積與實際用水量逐項試算藥量。

線上版：https://pesticide.probroavocado.com

## 這是純靜態網站，沒有建置步驟

所有檔案都是瀏覽器直接讀得懂的原生格式。把整個資料夾的檔案丟到 GitHub，
Pages 設定成 **Deploy from a branch → main → / (root)** 就會直接生效，
不需要 npm、不需要 GitHub Actions。

## 檔案

| 檔案 | 內容 |
| --- | --- |
| `index.html` | 頁面骨架、PWA meta、字型與樣式連結 |
| `styles.css` | 全站樣式 |
| `app.js` | 主程式：狀態、畫面組裝、事件處理 |
| `calc.js` | 單位換算與用量試算（面積用藥量與稀釋倍數的交叉檢核） |
| `moa.js` | 農業部 API 存取與欄位處理 |
| `sw.js` | Service Worker，離線外殼 |
| `manifest.json` | PWA 安裝資訊 |
| `CNAME` | 自訂網域，GitHub Pages 逐字比對，不要改動格式 |
| `icon-192.png` `icon-512.png` `favicon.svg` | 圖示 |
| `package.json` `calc.test.js` | 只用來跑測試，跟網站運作完全無關 |

`app.js` 用 `<script type="module">` 載入，瀏覽器會自己處理 `import`。

## 在電腦預覽

不能直接用檔案總管點開 `index.html` —— ES modules 需要透過 HTTP 才能載入。
裝了 Node.js 的話，在這個資料夾執行：

```
npx serve
```

然後開它顯示的網址。VS Code 的 Live Server 擴充套件也可以。

## 跑測試

計算的部分有 37 個單元測試，涵蓋官方資料的各種雜格式。不需要安裝任何套件：

```
node --test
```

## 發版流程

1. 改 `app.js` 裡的 `VERSION`。
2. 改 `sw.js` 裡的 `CACHE` 版本號（**一定要改**，否則使用者拿到的還是舊檔案）。
3. 更新 `app.js` 裡 `modalHtml()` 的 release 說明文字。
4. 把改過的檔案上傳到 GitHub。

## 資料來源與限制

- 農業部「農藥資料查詢」公開資料，每週更新。
- 動植物防疫檢疫署「農藥資訊服務網」核准使用範圍。
- 試算是單位換算工具，不判斷混配相容性、藥害或現場施藥條件；實際施用以產品中文標示與最新公告為準。

## 資料保存在哪裡

使用者的資料只存在自己的手機瀏覽器裡，不上傳任何後台。
儲存空間綁在**網域加路徑**上，所以 `pesticide.probroavocado.com` 一旦上線就不要再改，
改網址等於把所有使用者的紀錄清空。`localStorage` 的鍵一律加 `field-meds:` 前綴，
避免和同帳號的其他 GitHub Pages 站台互相干擾。

## 待辦

- [x] 用藥量與稀釋倍數交叉檢核，並反推合理用水量區間。
- [ ] 土地管理（名稱／面積／單位／主要作物），以 IndexedDB 保存在本機。
- [ ] 藥劑與使用範圍離線快取 —— 目前 `sw.js` 不快取跨網域請求，沒訊號時查不到任何藥劑。
- [ ] 施作紀錄與本機行事曆，含「複製完整紀錄」與「加入手機行事曆」。
- [ ] 同桶混用與分開施用兩套獨立流程。
- [ ] 字型目前從 Google Fonts 載入，離線時會退回系統字型，考慮改為自帶字型。
