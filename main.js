import { MouseDistortion } from "./index.js";

// ─── 使用範例 ─────────────────────────────────────────────────

const distortion = new MouseDistortion(
    document.querySelector(".hero"),
    document.querySelector(".hero-video"),
    { aberration: 0.3, relaxation: 0.95 }, // 選填，不傳則使用 DEFAULTS
);
