# 設計：MouseDistortion 支援圖片來源

日期：2026-07-10

## 目標

讓 `MouseDistortion` 效果除了 `<video>` 之外，也能直接套用在 `<img>` 上，
使用方式盡量不變（自動偵測來源型別）。

## API

維持單一類別，簽名不變（僅參數命名通用化）：

```js
new MouseDistortion(container, sourceEl, options?)
```

- `sourceEl` 可以是 `<video>` 或 `<img>`。
- 依 `sourceEl.tagName` 自動判斷紋理型別，使用者不需傳額外旗標。

## `index.js` 核心改動

1. **命名重構**：`videoEl` → `sourceEl`、`this.video` → `this.source`，語意上不再限定影片。
2. **紋理建立**：依型別分支
   - `VIDEO` → `THREE.VideoTexture`（每幀自動更新，維持現狀）
   - `IMG` → `THREE.Texture`，載入完成後設一次 `needsUpdate = true`
   - filter / mipmap 設定沿用現有（`LinearFilter`、關閉 mipmap）。
3. **尺寸來源**：新增 `_getSourceSize()` 工具
   - video → `videoWidth` / `videoHeight`
   - img → `naturalWidth` / `naturalHeight`
   - 回退預設 16 / 9（沿用現有 fallback）。
   `_getCoverScale()` 改用此工具，不再直接讀 `videoWidth`。
4. **載入事件**：
   - video → 沿用 `loadeddata`，重算 cover scale。
   - img → 監聽 `load`，重算 cover scale 並設 `texture.needsUpdate = true`；
     若圖片在建構時已 `complete`（快取情況），則立即執行同一段邏輯，避免 `load` 不觸發。
5. 隱藏原始元素的 `opacity = 0` 對 img / video 皆適用，維持不變。

## 文件與範例

- `README.md`：說明從「專為影片背景」擴充為「影片或圖片背景」；補一段 `<img>` 用法；
  更新建構子參數名為 `sourceEl`。
- `index.html` / `main.js`：新增一個以 `assets/img1.png` 為來源的 `<img>` hero 範例。

## 範圍界線（YAGNI）

- **不**處理動態 GIF 的逐幀更新（`THREE.Texture` 對 GIF 僅取第一幀）。若未來需要，
  可將 GIF 當 video 類來源以每幀更新處理，屬另一個工作。
- 不改動擾動場、shader、事件與 `destroy()` 的既有邏輯。

## 測試 / 驗證

手動於瀏覽器驗證：
- video hero 效果與改動前一致。
- img hero 顯示圖片並可觸發滑鼠擾動與色差。
- 縮放視窗時兩者 cover 行為正確。
- 圖片快取後重新整理仍正確顯示（`complete` 分支）。
