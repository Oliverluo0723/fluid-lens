import { MouseDistortion } from "./index.js";

// ─── 使用範例 ─────────────────────────────────────────────────

// 影片來源
const videoDistortion = new MouseDistortion(
    document.querySelector(".hero-video").parentElement,
    document.querySelector(".hero-video"),
    { aberration: 0.3, relaxation: 0.95 }, // 選填，不傳則使用 DEFAULTS
);

// 圖片來源（用法完全相同，第二個參數改傳 <img> 即可）
const imageDistortion = new MouseDistortion(
    document.querySelector(".hero-img").parentElement,
    document.querySelector(".hero-img"),
);
