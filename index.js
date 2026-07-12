// MouseDistortion.js
import * as THREE from "three";

// 預設參數
const DEFAULTS = {
    gridSize: 20, // 擾動場的格子數（越高越細緻，但越耗效能）
    mouseRadius: 0.25, // 滑鼠影響範圍（相對於 gridSize 的比例）
    strength: 0.1, // 擾動強度
    relaxation: 0.925, // 擾動衰減速率（越接近 1，拖尾越長）
    displacement: 0.015, // UV 偏移幅度（控制畫面扭曲程度）
    aberration: 0.15, // 色差強度（RGB 三通道的分離程度）
};

export class MouseDistortion {
    /**
     * @param {HTMLElement} container - 放置 canvas 的容器元素
     * @param {HTMLVideoElement | HTMLImageElement} sourceEl - 作為紋理來源的影片或圖片元素
     * @param {typeof DEFAULTS} options - 選填，覆蓋預設參數
     */
    constructor(container, sourceEl, options = {}) {
        this.config = { ...DEFAULTS, ...options };
        this.container = container;
        this.source = sourceEl;

        // 追蹤滑鼠位置與速度
        this.mouse = { x: 0, y: 0, prevX: 0, prevY: 0, vX: 0, vY: 0 };

        this._init();
        this._bindEvents();
        this._startLoop();
    }

    // ─── 初始化 ───────────────────────────────────────────────

    _init() {
        const { offsetWidth: w, offsetHeight: h } = this.container;
        this.width = w;
        this.height = h;

        // Three.js 基本設定
        this.scene = new THREE.Scene();

        // 使用正交相機，讓平面幾何體剛好鋪滿畫面（無透視變形）
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        this.camera.position.z = 1;

        // 建立 WebGL 渲染器並插入容器
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.classList.add("hero-canvas");
        this.container.appendChild(this.renderer.domElement);

        // 將來源（影片或圖片）轉為 GPU 紋理，並隱藏原始元素
        this.texture = this._createSourceTexture();
        this.source.style.opacity = "0";

        // 建立低解析度的擾動場紋理
        this.dataTexture = this._createDataTexture();

        // 建立 Shader，負責讀取擾動場並套用位移與色差
        const { displacement, aberration } = this.config;
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: this.texture }, // 來源紋理（影片或圖片）
                uDataTexture: { value: this.dataTexture }, // 擾動場紋理
            },
            vertexShader: `
                varying vec2 vUv;
                void main(){
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform sampler2D uDataTexture;
                varying vec2 vUv;

                void main(){
                    // 從擾動場取出目前位置的位移向量（rg = xy 方向）
                    vec4 offset = texture2D(uDataTexture, vUv);

                    // 計算 UV 偏移量與色差偏移量
                    vec2 shift = ${displacement} * offset.rg;
                    vec2 split = shift * ${aberration};

                    // RGB 三通道各自從略微不同的位置採樣，產生稜鏡色差效果
                    float r = texture2D(uTexture, vUv - shift + split).r;
                    float g = texture2D(uTexture, vUv - shift).g;
                    float b = texture2D(uTexture, vUv - shift - split).b;

                    gl_FragColor = vec4(r, g, b, 1.0);
                }
            `,
        });

        // 建立鋪滿畫面的平面，並套用 Shader 材質
        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(...this._getCoverScale()),
            this.material,
        );
        this.scene.add(this.mesh);

        // 來源尺寸就緒後重算縮放比例，確保 cover 行為正確
        const onSourceReady = () => {
            this.mesh.geometry.dispose();
            this.mesh.geometry = new THREE.PlaneGeometry(
                ...this._getCoverScale(),
            );
            // 圖片為靜態紋理，載入後需手動標記更新（影片由 VideoTexture 每幀處理）
            if (!this._isVideo()) this.texture.needsUpdate = true;
        };

        if (this._isVideo()) {
            this.source.addEventListener("loadeddata", onSourceReady);
        } else if (this.source.complete && this.source.naturalWidth) {
            onSourceReady(); // 圖片已快取，load 事件不會再觸發
        } else {
            this.source.addEventListener("load", onSourceReady);
        }
    }

    // 來源是否為影片元素
    _isVideo() {
        return this.source.tagName === "VIDEO";
    }

    /**
     * 依來源型別建立對應的 GPU 紋理
     * 影片使用 VideoTexture（每幀自動更新）；圖片使用一般 Texture
     */
    _createSourceTexture() {
        const texture = this._isVideo()
            ? new THREE.VideoTexture(this.source)
            : new THREE.Texture(this.source);
        texture.minFilter = texture.magFilter = THREE.LinearFilter; // 放大縮小時線性插值，畫面平滑
        texture.generateMipmaps = false; // 每幀更新或靜態圖片皆不需要 Mipmap
        // 圖片若在建構時已載入完成，立即標記一次更新
        if (!this._isVideo() && this.source.complete) texture.needsUpdate = true;
        return texture;
    }

    // ─── 工具方法 ─────────────────────────────────────────────

    /**
     * 建立擾動場紋理
     * 用低解析度的浮點數紋理儲存每個格子的位移向量
     * 格子數依容器長寬比動態調整，確保格子維持正方形
     */
    _createDataTexture() {
        const { gridSize } = this.config;
        const aspect = this.width / this.height;
        this.gridX = aspect >= 1 ? Math.round(gridSize * aspect) : gridSize;
        this.gridY = aspect >= 1 ? gridSize : Math.round(gridSize / aspect);

        const data = new Float32Array(this.gridX * this.gridY * 4); // RGBA，每格 4 個浮點數
        const texture = new THREE.DataTexture(
            data,
            this.gridX,
            this.gridY,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        texture.magFilter = texture.minFilter = THREE.NearestFilter; // 不插值，保留擾動場的原始格子感
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * 取得來源的原始尺寸
     * 影片使用 videoWidth/Height，圖片使用 naturalWidth/Height，未就緒時回退 16:9
     */
    _getSourceSize() {
        return this._isVideo()
            ? [this.source.videoWidth || 16, this.source.videoHeight || 9]
            : [this.source.naturalWidth || 16, this.source.naturalHeight || 9];
    }

    /**
     * 計算讓來源以 cover 方式填滿容器所需的平面縮放比例
     * 類似 CSS 的 object-fit: cover
     */
    _getCoverScale() {
        const [srcW, srcH] = this._getSourceSize();
        const sourceAspect = srcW / srcH;
        const containerAspect = this.width / this.height;
        const scaleX =
            containerAspect < sourceAspect ? sourceAspect / containerAspect : 1;
        const scaleY =
            containerAspect > sourceAspect ? containerAspect / sourceAspect : 1;
        return [2 * scaleX, 2 * scaleY]; // PlaneGeometry 預設寬高各為 1，乘 2 讓它對齊正交相機的 [-1, 1] 範圍
    }

    // ─── 每幀更新 ─────────────────────────────────────────────

    /**
     * 每幀更新擾動場：
     * 1. 所有格子的位移值乘以衰減係數，讓擾動自然消退
     * 2. 在滑鼠附近的格子，依距離加權寫入新的位移值
     */
    _updateDataTexture() {
        const { strength, relaxation, gridSize, mouseRadius } = this.config;
        const data = this.dataTexture.image.data;

        // 步驟 1：衰減
        for (let i = 0; i < data.length; i += 4) {
            data[i] *= relaxation; // x 方向位移
            data[i + 1] *= relaxation; // y 方向位移
        }

        // 步驟 2：在滑鼠影響範圍內寫入擾動
        const gridMouseX = this.gridX * this.mouse.x;
        const gridMouseY = this.gridY * (1 - this.mouse.y); // Y 軸翻轉（紋理座標從左下角開始）
        const maxDist = gridSize * mouseRadius;

        for (let i = 0; i < this.gridX; i++) {
            for (let j = 0; j < this.gridY; j++) {
                const distSq = (gridMouseX - i) ** 2 + (gridMouseY - j) ** 2;
                if (distSq >= maxDist * maxDist) continue; // 超出範圍則跳過

                const index = 4 * (i + this.gridX * j);
                const power = Math.min(10, maxDist / Math.sqrt(distSq)); // 越近影響越強，上限 10 倍
                data[index] += strength * 100 * this.mouse.vX * power; // x 方向
                data[index + 1] -= strength * 100 * this.mouse.vY * power; // y 方向（負號對應 Y 軸翻轉）
            }
        }

        // 滑鼠速度逐幀衰減，避免滑鼠停止後仍有殘留速度
        this.mouse.vX *= 0.9;
        this.mouse.vY *= 0.9;
        this.dataTexture.needsUpdate = true;
    }

    // ─── 事件綁定 ─────────────────────────────────────────────

    _bindEvents() {
        // 將滑鼠位置轉換為容器內的相對座標（0~1），並計算幀間速度
        this._onMouseMove = (e) => {
            const rect = this.container.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            this.mouse.vX = x - this.mouse.prevX;
            this.mouse.vY = y - this.mouse.prevY;
            this.mouse.prevX = this.mouse.x;
            this.mouse.prevY = this.mouse.y;
            this.mouse.x = x;
            this.mouse.y = y;
        };

        // 視窗縮放時重建幾何體、擾動場與渲染器尺寸
        this._onResize = () => {
            this.width = this.container.offsetWidth;
            this.height = this.container.offsetHeight;

            this.mesh.geometry.dispose();
            this.mesh.geometry = new THREE.PlaneGeometry(
                ...this._getCoverScale(),
            );

            this.dataTexture.dispose();
            this.dataTexture = this._createDataTexture();
            this.material.uniforms.uDataTexture.value = this.dataTexture;

            this.renderer.setSize(this.width, this.height);
        };

        this.container.addEventListener("mousemove", this._onMouseMove);
        window.addEventListener("resize", this._onResize);
    }

    // ─── 渲染迴圈 ─────────────────────────────────────────────

    _startLoop() {
        this.renderer.setAnimationLoop(() => {
            this._updateDataTexture();
            this.renderer.render(this.scene, this.camera);
        });
    }

    // ─── 清除 ─────────────────────────────────────────────────

    /**
     * 停止渲染、移除事件監聽、釋放 GPU 資源
     * 在 SPA 換頁或元件卸載時呼叫，避免記憶體洩漏
     */
    destroy() {
        this.renderer.setAnimationLoop(null);
        this.container.removeEventListener("mousemove", this._onMouseMove);
        window.removeEventListener("resize", this._onResize);
        this.renderer.dispose();
        this.container.removeChild(this.renderer.domElement);
    }
}
