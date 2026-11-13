// ============================================================
// TEMPLE RUN IRL - ULTRA-SMOOTH 60/120 FPS GRAPHICS ENGINE
// Same rich Reflex Run / Temple Run 2 painterly visuals across
// all 3 biomes, optimized with:
//   - Merged static BufferGeometries (~25x fewer WebGL draw calls)
//   - Pre-built Chunk, Trap & Coin Object Pools (0 GC stalls)
//   - Permanent single PointLight + renderer.compile() pre-warm
//     (0 shader recompilation freezes when jumping or dodging!)
//   - Frame-rate-independent exponential Jump & Left/Right motion
// ============================================================

class TempleGame {
    constructor() {
        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Track Configuration (3 lanes aligned 1:1 with pavement columns)
        this.laneWidth = 2.7;
        this.lanes = [-this.laneWidth, 0, this.laneWidth];
        this.currentLaneIndex = 1;
        this.targetPlayerX = 0;
        this.playerX = 0;
        this.playerY = 0;
        this.playerZ = 0;
        this.smoothBank = 0;

        // Player Physical Movement
        this.isJumping = false;
        this.isDucking = false;
        this.jumpProgress = 0;
        this.duckProgress = 0;
        this.jumpDuration = 0.58;
        this.duckDuration = 0.58;
        this.cameraMode = 'thirdPerson';
        this.startingBiome = 'MINE';

        // Continuous 1:1 Motion Tracking + Keyboard Hybrid Support
        this.isContinuousTracking = false;
        this.continuousTargetX = 0;
        this.continuousBodyY = 0;
        this.rawBodyDiffX = 0;
        this.rawBodyDiffY = 0;
        this.lastKeyboardSteerTime = -9999;

        // Constant Pace & Scoring
        this.baseSpeed = 22;
        this.speed = this.baseSpeed;
        this.maxSpeed = 48;
        this.distance = 0;
        this.score = 0;
        this.combo = 1;
        this.comboStreak = 0;
        this.lives = 3;
        this.maxLives = 3;

        // Game State
        this.isRunning = false;
        this.isGameOver = false;
        this.isPaused = false;
        this.lastTime = 0;

        // World Chunks & Zero-Allocation Object Pools
        this.chunkLength = 42;
        this.visibleChunks = 6;
        this.chunks = [];
        this.chunkPools = { TEMPLE: [], BRIDGE: [], MINE: [] };
        this.portalPool = [];
        this.activePortals = [];
        this.coinPool = [];
        this.coins = [];
        this.trapPool = {};
        this.animatedFlames = [];

        // Sequential Single-Trap Mechanic
        this.activeTrap = null;
        this.trapCooldownTimer = 1.2;
        this.trapSpawnCount = 0;
        this.lastTrapType = null;
        this.lastTrapMotion = null;
        this.reactionStartTime = 0;
        this.reactionTimes = [];

        // Assets
        this.playerGroup = null;
        this.materials = {};
        this.textures = {};
        this.sharedGeo = {};
        this.accentLight = null;
        this.fireUniforms = { uTime: { value: 2.4 } };

        // HUD Callbacks
        this.onHUDUpdate = null;
        this.onGameOver = null;
        this.onReflexCue = null;
        this.onReflexFeedback = null;
    }

    init(container, callbacks) {
        this.container = container;
        this.onHUDUpdate = callbacks.onHUDUpdate;
        this.onGameOver = callbacks.onGameOver;
        this.onReflexCue = callbacks.onReflexCue;
        this.onReflexFeedback = callbacks.onReflexFeedback;

        // 1. Scene & Atmospheric Haze
        this.scene = new THREE.Scene();
        // Vivid tropical aerial perspective matching TikTok Reflex Run: crisp cerulean horizon haze (never grey smog!)
        this.skyHazeHex = 0x8ccaf8;
        this.scene.background = this.srgb(0x2a8af0);
        this.scene.fog = new THREE.FogExp2(this.srgb(this.skyHazeHex), 0.0030);

        // 2. Camera
        this.camera = new THREE.PerspectiveCamera(
            70,
            this.container.clientWidth / this.container.clientHeight,
            0.15,
            340
        );

        // 3. High-Performance WebGL Renderer (capped 1.5x DPR, no dual-pass shadow map stalls)
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            stencil: false
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.renderer.shadowMap.enabled = false;
        this.container.appendChild(this.renderer.domElement);

        // 4. PBR Sky/Sun Reflection Environment
        this.createEnvironmentMap();

        // 5. High-Res Painterly Textures, Bump Maps & Merged Shared Geometries
        this.createProceduralTextures();
        this.createSharedGeometries();

        // 6. Sunlit Tropical Lighting + Single Permanent Accent PointLight (zero shader recompiles!)
        this.setupLighting();

        // 7. Painted Sky Dome, Clouds, Distant Cliffs & Stepped Mayan Pyramid
        this.buildSkyAndDistantMountains();

        // 8. 3rd-Person Explorer Avatar
        this.buildPlayerAvatar();

        // 9. Pre-allocate Chunk, Coin & Trap Pools + Pre-compile ALL GPU Shaders Upfront!
        this.initObjectPools();
        this.resetWorld();
        this.prewarmGPU();

        // 10. Listeners & Initial Render
        window.addEventListener('resize', () => this.onWindowResize());
        this.bindKeyboardControls();

        this.camera.position.set(0, 1.85, 0);
        this.camera.lookAt(0, 1.65, -22);
        this.renderer.render(this.scene, this.camera);
    }

    // ============================================================
    // FAST BUFFERGEOMETRY MERGER (COLLAPSES STATIC MESH DRAW CALLS)
    // ============================================================
    mergeGeos(geoList) {
        // Keep per-vertex colours (foliage ambient occlusion & hue variation) when any source carries them
        const anyColor = geoList.some((g) => !!g.attributes.color);
        const nonIndexed = geoList.map((g) => {
            const ni = g.index ? g.toNonIndexed() : g;
            if (!ni.attributes.uv) {
                const count = ni.attributes.position.count;
                ni.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
            }
            if (!ni.attributes.normal) {
                ni.computeVertexNormals();
            }
            return ni;
        });

        let totalVerts = 0;
        for (let i = 0; i < nonIndexed.length; i++) {
            totalVerts += nonIndexed[i].attributes.position.count;
        }

        const posArr = new Float32Array(totalVerts * 3);
        const normArr = new Float32Array(totalVerts * 3);
        const uvArr = new Float32Array(totalVerts * 2);
        const colArr = anyColor ? new Float32Array(totalVerts * 3).fill(1) : null;

        let vOffset = 0;
        for (let i = 0; i < nonIndexed.length; i++) {
            const g = nonIndexed[i];
            const p = g.attributes.position.array;
            const n = g.attributes.normal.array;
            const u = g.attributes.uv.array;
            const count = g.attributes.position.count;

            posArr.set(p, vOffset * 3);
            normArr.set(n, vOffset * 3);
            uvArr.set(u, vOffset * 2);
            if (colArr && g.attributes.color) colArr.set(g.attributes.color.array.subarray(0, count * 3), vOffset * 3);
            vOffset += count;

            if (g !== geoList[i]) g.dispose();
            geoList[i].dispose();
        }

        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
        merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
        if (colArr) merged.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
        merged.computeBoundingSphere();
        return merged;
    }

    transformGeo(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
        m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
        geo.applyMatrix4(m);
        return geo;
    }

    createEnvironmentMap() {
        try {
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            pmrem.compileCubemapShader();
            const envScene = new THREE.Scene();

            const envSkyGeo = new THREE.SphereGeometry(40, 16, 12);
            const envCanvas = document.createElement('canvas');
            envCanvas.width = 256;
            envCanvas.height = 128;
            const ectx = envCanvas.getContext('2d');
            const grad = ectx.createLinearGradient(0, 0, 0, 128);
            grad.addColorStop(0.0, '#125fd0');
            grad.addColorStop(0.42, '#5cb2f8');
            grad.addColorStop(0.52, '#d8eefc');
            grad.addColorStop(0.66, '#7a7456');
            grad.addColorStop(1.0, '#2c3d28');
            ectx.fillStyle = grad;
            ectx.fillRect(0, 0, 256, 128);
            ectx.fillStyle = 'rgba(255, 248, 225, 0.65)';
            ectx.beginPath();
            ectx.arc(170, 38, 12, 0, Math.PI * 2);
            ectx.fill();

            const envTex = new THREE.CanvasTexture(envCanvas);
            envTex.encoding = THREE.sRGBEncoding;
            const envMat = new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide });
            envScene.add(new THREE.Mesh(envSkyGeo, envMat));

            this.scene.environment = pmrem.fromScene(envScene, 0.03).texture;
            pmrem.dispose();
            envSkyGeo.dispose();
            envTex.dispose();
        } catch (e) {}
    }

    hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    srgb(hex) {
        return new THREE.Color(hex).convertSRGBToLinear();
    }

    // ============================================================
    // FAST TABLE-BASED NOISE (tileable 2D for textures, 3D for rock sculpting)
    // ============================================================
    getNoiseTable() {
        if (!this._noiseTab) {
            const tab = new Float32Array(256 * 256);
            for (let i = 0; i < tab.length; i++) {
                tab[i] = this.hash2((i & 255) + 0.37, (i >> 8) + 0.71);
            }
            this._noiseTab = tab;
        }
        return this._noiseTab;
    }

    // Tileable value noise: lattice wraps every `period` cells (period must be <= 256)
    tileNoise(x, y, period, seed = 0) {
        const tab = this._noiseTab || this.getNoiseTable();
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const so = seed * 59, sr = seed * 37;
        const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
        const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
        const r0 = ((y0 + sr) & 255) << 8, r1 = ((y1 + sr) & 255) << 8;
        const a = tab[r0 + ((x0 + so) & 255)];
        const b = tab[r0 + ((x1 + so) & 255)];
        const c = tab[r1 + ((x0 + so) & 255)];
        const d = tab[r1 + ((x1 + so) & 255)];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    // Tileable fBm over a [0..1) square (u, v) with `basePeriod` cells on the first octave
    tileFbm(u, v, basePeriod, octaves, seed = 0) {
        let sum = 0, amp = 0.5, norm = 0, p = basePeriod;
        for (let o = 0; o < octaves; o++) {
            sum += amp * this.tileNoise(u * p, v * p, p, seed + o * 7);
            norm += amp;
            amp *= 0.5;
            p *= 2;
        }
        return sum / norm;
    }

    // Pre-bake a tileable fBm field on an N x N grid (sampled bilinearly) -> ~4-16x cheaper texture synthesis
    bakeNoiseGrid(N, basePeriod, octaves, seed = 0) {
        const grid = new Float32Array(N * N);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                grid[y * N + x] = this.tileFbm(x / N, y / N, basePeriod, octaves, seed);
            }
        }
        return { grid, N };
    }

    sampleGrid(g, u, v) {
        const N = g.N, grid = g.grid;
        const fx = u * N, fy = v * N;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        let xa, xb, ya, yb;
        if ((N & (N - 1)) === 0) {
            const M = N - 1; // power-of-two fast path (bit-mask wrap, works for negatives)
            xa = x0 & M; xb = (x0 + 1) & M; ya = (y0 & M) * N; yb = ((y0 + 1) & M) * N;
        } else {
            xa = ((x0 % N) + N) % N; xb = (xa + 1) % N;
            ya = (((y0 % N) + N) % N) * N; yb = (((y0 + 1) % N + N) % N) * N;
        }
        const a = grid[ya + xa], b = grid[ya + xb];
        const c = grid[yb + xa], d = grid[yb + xb];
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }

    configureTex(canvas, repeatX, repeatY, isColor = true) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        if (isColor) tex.encoding = THREE.sRGBEncoding;
        const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
        tex.anisotropy = Math.min(8, maxAniso || 1);
        return tex;
    }

    // ============================================================
    // PAINTERLY TEMPLE RUN 2 / REFLEX RUN TEXTURES + BUMP MAPS
    // ============================================================
    createProceduralTextures() {
        // 1. ANCIENT WEATHERED MAYAN FLAGSTONE CAUSEWAY FLOOR (1024x1024 HD + mossy wall-base seam)
        const roadC = document.createElement('canvas');
        const roadB = document.createElement('canvas');
        roadC.width = roadB.width = 1024;
        roadC.height = roadB.height = 1024;
        const rc = roadC.getContext('2d');
        const rb = roadB.getContext('2d');

        rc.fillStyle = '#4a3a2a';
        rc.fillRect(0, 0, 1024, 1024);
        rb.fillStyle = '#202020';
        rb.fillRect(0, 0, 1024, 1024);

        const drawStoneBlock = (x, y, w, h, seed, palette) => {
            const pick = palette[Math.floor(this.hash2(seed, seed * 3.1) * palette.length)];
            const v = (this.hash2(seed * 1.7, y) - 0.5) * 22;
            const r = Math.min(255, Math.max(0, pick[0] + v));
            const g = Math.min(255, Math.max(0, pick[1] + v * 0.90));
            const b = Math.min(255, Math.max(0, pick[2] + v * 0.80));

            const pad = 4.5;
            // Hand-chiseled irregular stone polygon (eliminates ruler-straight grid boxes!)
            const pts = [
                [x + pad + this.hash2(seed, 1) * 3.5, y + pad + this.hash2(seed, 2) * 3.5],
                [x + w * 0.5, y + pad + (this.hash2(seed, 3) - 0.5) * 3.5],
                [x + w - pad - this.hash2(seed, 4) * 3.5, y + pad + this.hash2(seed, 5) * 3.5],
                [x + w - pad + (this.hash2(seed, 6) - 0.5) * 3.0, y + h * 0.5],
                [x + w - pad - this.hash2(seed, 7) * 3.5, y + h - pad - this.hash2(seed, 8) * 3.5],
                [x + w * 0.5, y + h - pad + (this.hash2(seed, 9) - 0.5) * 3.5],
                [x + pad + this.hash2(seed, 10) * 3.5, y + h - pad - this.hash2(seed, 11) * 3.5],
                [x + pad + (this.hash2(seed, 12) - 0.5) * 3.0, y + h * 0.5]
            ];
            const traceSlab = (ctx) => {
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
                ctx.closePath();
            };

            const grad = rc.createLinearGradient(x, y, x + w, y + h);
            grad.addColorStop(0, `rgb(${Math.min(255, r + 14)|0}, ${Math.min(255, g + 11)|0}, ${Math.min(255, b + 8)|0})`);
            grad.addColorStop(0.52, `rgb(${r|0}, ${g|0}, ${b|0})`);
            grad.addColorStop(1, `rgb(${Math.max(0, r - 18)|0}, ${Math.max(0, g - 16)|0}, ${Math.max(0, b - 13)|0})`);
            rc.fillStyle = grad;
            traceSlab(rc);
            rc.fill();

            rb.fillStyle = '#bcbcbc';
            traceSlab(rb);
            rb.fill();
            rb.fillStyle = '#e2e2e2';
            rb.fillRect(x + pad + 8, y + pad + 8, Math.max(4, w - (pad + 8) * 2), Math.max(4, h - (pad + 8) * 2));

            // Soft chiseled sunlit stone bevel + warm sandy recessed joint shadow
            rc.strokeStyle = 'rgba(255, 240, 214, 0.42)';
            rc.lineWidth = 3.2;
            rc.beginPath();
            rc.moveTo(pts[6][0] + 2, pts[6][1] - 2);
            rc.lineTo(pts[0][0] + 2, pts[0][1] + 2);
            rc.lineTo(pts[2][0] - 2, pts[2][1] + 2);
            rc.stroke();

            rc.strokeStyle = 'rgba(72, 52, 34, 0.46)';
            rc.beginPath();
            rc.moveTo(pts[2][0] - 2, pts[2][1] + 2);
            rc.lineTo(pts[4][0] - 2, pts[4][1] - 2);
            rc.lineTo(pts[6][0] + 2, pts[6][1] - 2);
            rc.stroke();

            // Natural sandstone mottling, weathered pits & dusty grain
            for (let n = 0; n < 32; n++) {
                const nx = x + pad + 8 + this.hash2(seed + n, 11) * Math.max(8, w - 28);
                const ny = y + pad + 8 + this.hash2(seed + n, 23) * Math.max(8, h - 28);
                const nr = 5 + this.hash2(seed + n, 37) * 24;
                const warm = this.hash2(seed + n, 51) > 0.46;
                rc.fillStyle = warm ? 'rgba(142, 92, 56, 0.11)' : 'rgba(248, 226, 194, 0.10)';
                rc.beginPath();
                rc.arc(nx, ny, nr, 0, Math.PI * 2);
                rc.fill();
            }

            // Jagged ancient fracture cracks across weathered flagstones
            if (this.hash2(seed, 91) > 0.34) {
                const cx1 = x + pad + 12 + this.hash2(seed, 92) * Math.max(10, w - 34);
                const cy1 = y + pad + 6;
                const cxm = cx1 + (this.hash2(seed, 94) - 0.5) * 42;
                const cym = y + h * (0.42 + this.hash2(seed, 95) * 0.18);
                const cx2 = cxm + (this.hash2(seed, 93) - 0.5) * 46;
                const cy2 = y + h - pad - 6;
                rc.strokeStyle = 'rgba(52, 34, 20, 0.52)';
                rc.lineWidth = 2.6;
                rc.beginPath();
                rc.moveTo(cx1, cy1);
                rc.lineTo(cxm, cym);
                rc.lineTo(cx2, cy2);
                rc.stroke();

                rb.strokeStyle = '#383838';
                rb.lineWidth = 3.5;
                rb.beginPath();
                rc.moveTo(cx1, cy1);
                rb.moveTo(cx1, cy1);
                rb.lineTo(cxm, cym);
                rb.lineTo(cx2, cy2);
                rb.stroke();
            }
        };

        const slabPalette = [
            [196, 158, 122],
            [208, 171, 134],
            [182, 144, 110],
            [214, 180, 144],
            [174, 138, 108]
        ];
        const trimPalette = [
            [138, 118, 96],
            [126, 108, 88]
        ];

        const rows = 6;
        const rowH = 1024 / rows;
        for (let r = 0; r < rows; r++) {
            const y = r * rowH;
            const splitL = 150 + ((r * 37) % 44);
            const splitR = 148 + ((r * 29) % 44);
            if (r % 2 === 0) {
                drawStoneBlock(32, y, 304, rowH, r * 10 + 1, slabPalette);
            } else {
                drawStoneBlock(32, y, splitL, rowH, r * 10 + 2, slabPalette);
                drawStoneBlock(32 + splitL, y, 304 - splitL, rowH, r * 10 + 3, slabPalette);
            }
            if (r % 3 === 1) {
                drawStoneBlock(370, y, 142, rowH, r * 10 + 8, slabPalette);
                drawStoneBlock(512, y, 142, rowH, r * 10 + 9, slabPalette);
            } else {
                drawStoneBlock(370, y, 284, rowH, r * 10 + 4, slabPalette);
            }
            if (r % 2 === 1) {
                drawStoneBlock(688, y, 304, rowH, r * 10 + 5, slabPalette);
            } else {
                drawStoneBlock(688, y, splitR, rowH, r * 10 + 6, slabPalette);
                drawStoneBlock(688 + splitR, y, 304 - splitR, rowH, r * 10 + 7, slabPalette);
            }
        }
        for (let r = 0; r < 10; r++) {
            const ch = 1024 / 10;
            drawStoneBlock(336, r * ch, 34, ch, 200 + r, trimPalette);
            drawStoneBlock(654, r * ch, 34, ch, 300 + r, trimPalette);
            drawStoneBlock(0, r * ch, 32, ch, 400 + r, trimPalette);
            drawStoneBlock(992, r * ch, 32, ch, 500 + r, trimPalette);
        }

        // Rich weathered soil, damp shadow & jungle moss creeping onto the floor at the bottom of both walls!
        const leftAO = rc.createLinearGradient(0, 0, 118, 0);
        leftAO.addColorStop(0, 'rgba(26, 22, 14, 0.68)');
        leftAO.addColorStop(0.45, 'rgba(42, 36, 22, 0.28)');
        leftAO.addColorStop(1, 'rgba(28, 18, 10, 0.0)');
        rc.fillStyle = leftAO;
        rc.fillRect(0, 0, 118, 1024);

        const rightAO = rc.createLinearGradient(1024, 0, 906, 0);
        rightAO.addColorStop(0, 'rgba(26, 22, 14, 0.68)');
        rightAO.addColorStop(0.45, 'rgba(42, 36, 22, 0.28)');
        rightAO.addColorStop(1, 'rgba(28, 18, 10, 0.0)');
        rc.fillStyle = rightAO;
        rc.fillRect(906, 0, 118, 1024);

        for (let m = 0; m < 120; m++) {
            const onEdge = m < 82;
            const mx = onEdge
                ? (m % 2 === 0 ? 10 + this.hash2(m, 1) * 58 : 956 + this.hash2(m, 2) * 58)
                : (m % 2 === 0 ? 338 + this.hash2(m, 3) * 30 : 656 + this.hash2(m, 4) * 30);
            const my = this.hash2(m, 5) * 1024;
            rc.fillStyle = m % 3 === 0 ? 'rgba(56, 98, 34, 0.52)' : 'rgba(82, 122, 46, 0.38)';
            rc.beginPath();
            rc.ellipse(mx, my, 7 + this.hash2(m, 6) * 16, 4 + this.hash2(m, 7) * 9, 0, 0, Math.PI * 2);
            rc.fill();
        }

        this.textures.road = this.configureTex(roadC, 1, 4.2, true);
        this.textures.roadBump = this.configureTex(roadB, 1, 4.2, false);

        // 2. AUTHENTIC TIKTOK WEATHERED DRIFTWOOD / ASH-TAUPE BRIDGE DECK (1024x1024 — Matches eae94aa6.jpg & 11d922c7.jpg!)
        const brC = document.createElement('canvas');
        const brB = document.createElement('canvas');
        brC.width = brB.width = 1024;
        brC.height = brB.height = 1024;
        const bc = brC.getContext('2d');
        const bb = brB.getContext('2d');

        // Deep chasm crevice darkness between hand-hewn planks
        bc.fillStyle = '#14100e';
        bc.fillRect(0, 0, 1024, 1024);
        bb.fillStyle = '#060606';
        bb.fillRect(0, 0, 1024, 1024);

        const plankCount = 24;
        const plankH = 1024 / plankCount;
        // Rich weathered driftwood / taupe-ash palette with authentic plank-to-plank contrast (sampled from eae94aa6.jpg & 11d922c7.jpg!)
        const woodTones = [
            [148, 130, 118],
            [122, 105, 95],
            [162, 144, 132],
            [110, 94, 85],
            [138, 120, 109],
            [154, 136, 124]
        ];

        for (let p = 0; p < plankCount; p++) {
            const py = p * plankH;
            const tone = woodTones[p % woodTones.length];
            const shift = (this.hash2(p, 7) - 0.5) * 24;
            const r = Math.min(255, Math.max(0, tone[0] + shift)) | 0;
            const g = Math.min(255, Math.max(0, tone[1] + shift * 0.92)) | 0;
            const b = Math.min(255, Math.max(0, tone[2] + shift * 0.88)) | 0;

            // Multi-point irregular hand-hewn plank edge profile (notched gaps & uneven splits just like eae94aa6.jpg!)
            const topPts = [];
            const botPts = [];
            for (let k = 0; k <= 6; k++) {
                const kx = 4 + (k / 6) * 1016;
                const edgeExtra = (k === 0 || k === 6) ? 2.8 : 0.0;
                topPts.push([kx, py + 2.6 + edgeExtra + this.hash2(p * 11 + k, 13) * 5.2]);
                botPts.push([kx, py + plankH - (2.4 + edgeExtra + this.hash2(p * 17 + k, 19) * 4.8)]);
            }

            const pGrad = bc.createLinearGradient(0, py, 0, py + plankH);
            pGrad.addColorStop(0, `rgb(${Math.min(255, r + 22)},${Math.min(255, g + 19)},${Math.min(255, b + 17)})`);
            pGrad.addColorStop(0.32, `rgb(${r},${g},${b})`);
            pGrad.addColorStop(1, `rgb(${Math.max(0, r - 28)},${Math.max(0, g - 25)},${Math.max(0, b - 22)})`);

            const tracePlank = (ctx) => {
                ctx.beginPath();
                ctx.moveTo(topPts[0][0], topPts[0][1]);
                for (let k = 1; k <= 6; k++) ctx.lineTo(topPts[k][0], topPts[k][1]);
                for (let k = 6; k >= 0; k--) ctx.lineTo(botPts[k][0], botPts[k][1]);
                ctx.closePath();
            };

            bc.fillStyle = pGrad;
            tracePlank(bc);
            bc.fill();

            bb.fillStyle = '#c0c0c0';
            tracePlank(bb);
            bb.fill();

            // Crisp sunlit beveled upper plank lip
            bc.strokeStyle = 'rgba(236, 222, 210, 0.46)';
            bc.lineWidth = 2.6;
            bc.beginPath();
            bc.moveTo(topPts[0][0], topPts[0][1] + 1.5);
            for (let k = 1; k <= 6; k++) bc.lineTo(topPts[k][0], topPts[k][1] + 1.5);
            bc.stroke();

            bb.strokeStyle = '#efefef';
            bb.lineWidth = 3.2;
            bb.beginPath();
            bb.moveTo(topPts[0][0], topPts[0][1] + 2);
            for (let k = 1; k <= 6; k++) bb.lineTo(topPts[k][0], topPts[k][1] + 2);
            bb.stroke();

            // High-contrast weathered horizontal wood-grain streaks + dark timber knots
            for (let s = 0; s < 14; s++) {
                const gy = py + 5 + (s / 14) * (plankH - 10);
                const darkGrain = (s % 2 === 0);
                bc.strokeStyle = darkGrain ? 'rgba(42, 33, 28, 0.42)' : 'rgba(224, 210, 198, 0.22)';
                bc.lineWidth = darkGrain ? 2.0 : 1.4;
                bc.beginPath();
                bc.moveTo(8, gy);
                bc.bezierCurveTo(
                    330, gy + (this.hash2(p, s) - 0.5) * 6.5,
                    690, gy - (this.hash2(s, p) - 0.5) * 6.5,
                    1016, gy
                );
                bc.stroke();

                if (darkGrain) {
                    bb.strokeStyle = '#7c7c7c';
                    bb.lineWidth = 1.8;
                    bb.beginPath();
                    bb.moveTo(8, gy);
                    bb.bezierCurveTo(330, gy + (this.hash2(p, s) - 0.5) * 6.5, 690, gy - (this.hash2(s, p) - 0.5) * 6.5, 1016, gy);
                    bb.stroke();
                }
            }

            // Weathered wood knot on alternating planks
            if (this.hash2(p, 31) > 0.38) {
                const kx = 140 + this.hash2(p, 33) * 740;
                const ky = py + plankH * (0.42 + this.hash2(p, 37) * 0.22);
                bc.fillStyle = 'rgba(46, 35, 28, 0.48)';
                bc.beginPath();
                bc.ellipse(kx, ky, 16 + (p % 3) * 6, 4.5, 0, 0, Math.PI * 2);
                bc.fill();
            }

            // Deep weathered split-check extending inward from plank ends (matches 11d922c7.jpg & eae94aa6.jpg!)
            if (this.hash2(p, 41) > 0.28) {
                const fromLeft = (p % 2 === 0);
                const sy = py + plankH * (0.36 + this.hash2(p, 43) * 0.30);
                const len = 210 + this.hash2(p, 47) * 320;
                bc.strokeStyle = 'rgba(18, 14, 11, 0.82)';
                bc.lineWidth = 3.0;
                bc.beginPath();
                if (fromLeft) {
                    bc.moveTo(4, sy);
                    bc.lineTo(len * 0.5, sy + 2.5);
                    bc.lineTo(len, sy - 1.5);
                } else {
                    bc.moveTo(1020, sy);
                    bc.lineTo(1020 - len * 0.5, sy - 2.5);
                    bc.lineTo(1020 - len, sy + 1.5);
                }
                bc.stroke();
            }
        }

        // Subtle sun-worn center foot-trail sheen + deep weathered umber/charcoal & damp moss along both post edges!
        const centerWear = bc.createLinearGradient(0, 0, 1024, 0);
        centerWear.addColorStop(0.0, 'rgba(24, 20, 17, 0.68)');
        centerWear.addColorStop(0.14, 'rgba(42, 35, 30, 0.28)');
        centerWear.addColorStop(0.32, 'rgba(235, 224, 214, 0.06)');
        centerWear.addColorStop(0.50, 'rgba(245, 236, 228, 0.12)');
        centerWear.addColorStop(0.68, 'rgba(235, 224, 214, 0.06)');
        centerWear.addColorStop(0.86, 'rgba(42, 35, 30, 0.28)');
        centerWear.addColorStop(1.0, 'rgba(24, 20, 17, 0.68)');
        bc.fillStyle = centerWear;
        bc.fillRect(0, 0, 1024, 1024);

        // Damp jungle moss patches creeping onto the plank ends right at the bottom of the side posts!
        for (let m = 0; m < 75; m++) {
            const mx = (m % 2 === 0) ? (8 + this.hash2(m, 61) * 56) : (960 + this.hash2(m, 67) * 56);
            const my = this.hash2(m, 71) * 1024;
            bc.fillStyle = m % 2 === 0 ? 'rgba(48, 96, 36, 0.46)' : 'rgba(72, 124, 46, 0.34)';
            bc.beginPath();
            bc.ellipse(mx, my, 9 + this.hash2(m, 73) * 18, 4 + this.hash2(m, 79) * 8, 0, 0, Math.PI * 2);
            bc.fill();
        }

        this.textures.bridge = this.configureTex(brC, 1, 3.4, true);
        this.textures.bridgeBump = this.configureTex(brB, 1, 3.4, false);

        // 2B. WEATHERED SILVERED-CHARCOAL DRIFTWOOD TIMBER FOR BRIDGE POSTS & LOG RAILS (256x256)
        const dwC = document.createElement('canvas');
        const dwB = document.createElement('canvas');
        dwC.width = dwB.width = 256;
        dwC.height = dwB.height = 256;
        const dc = dwC.getContext('2d');
        const db = dwB.getContext('2d');
        dc.fillStyle = '#584e47';
        dc.fillRect(0, 0, 256, 256);
        db.fillStyle = '#808080';
        db.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 42; i++) {
            const x = (i / 42) * 256;
            dc.strokeStyle = i % 3 === 0 ? '#2c2622' : (i % 3 === 1 ? '#8c8076' : '#463d37');
            dc.lineWidth = 3 + (i % 3) * 2;
            dc.beginPath();
            dc.moveTo(x, 0);
            dc.bezierCurveTo(x + 5, 85, x - 5, 170, x + 2, 256);
            dc.stroke();

            db.strokeStyle = i % 2 === 0 ? '#303030' : '#dcdcdc';
            db.lineWidth = 4;
            db.beginPath();
            db.moveTo(x, 0);
            db.bezierCurveTo(x + 5, 85, x - 5, 170, x + 2, 256);
            db.stroke();
        }
        this.textures.driftwoodPost = this.configureTex(dwC, 1.5, 1, true);
        this.textures.driftwoodPostBump = this.configureTex(dwB, 1.5, 1, false);

        // 3. SUBWAY SURFERS METROPOLIS RAILWAY BALLAST & INDIVIDUAL TRACK SLEEPERS (1024x1024)
        // (100% Matches Subway Surfers screenshots e6196d69.jpg, 9468adf5.jpg, 8b0a9d6b.jpg, f565e49c.jpg!)
        const mnC = document.createElement('canvas');
        const mnB = document.createElement('canvas');
        mnC.width = mnB.width = 1024;
        mnC.height = mnB.height = 1024;
        const mc = mnC.getContext('2d');
        const mb = mnB.getContext('2d');

        // Smooth dark blue-grey / slate railway ballast base (Subway Surfers signature ground!)
        mc.fillStyle = '#363d4a';
        mc.fillRect(0, 0, 1024, 1024);
        mb.fillStyle = '#606060';
        mb.fillRect(0, 0, 1024, 1024);

        // Fine multi-tone crushed granite / basalt aggregate speckles
        for (let i = 0; i < 2400; i++) {
            const gx = this.hash2(i, 1) * 1024;
            const gy = this.hash2(i, 2) * 1024;
            const gw = 2 + this.hash2(i, 3) * 6;
            const gh = 2 + this.hash2(i, 5) * 5;
            const pick = i % 5;
            mc.fillStyle = pick === 0 ? 'rgba(32, 38, 48, 0.55)'
                : (pick === 1 ? 'rgba(74, 85, 102, 0.40)'
                : (pick === 2 ? 'rgba(22, 26, 34, 0.60)'
                : (pick === 3 ? 'rgba(92, 105, 124, 0.35)' : 'rgba(46, 54, 68, 0.45)')));
            mc.fillRect(gx, gy, gw, gh);
        }

        // 3 Distinct Track Beds (Left Track: x ~ 184, Center Track: x ~ 512, Right Track: x ~ 840)
        // In Subway Surfers, each track has its OWN individual dark composite/concrete sleepers!
        const trackCenters = [184, 512, 840];
        const sleeperHalfW = 112; // 224px wide per track sleeper
        const tieCount = 16;
        const tieStep = 1024 / tieCount;

        // Soft longitudinal track-bed ballast shadow under each lane
        trackCenters.forEach(cx => {
            const trackGrd = mc.createLinearGradient(cx - sleeperHalfW - 24, 0, cx + sleeperHalfW + 24, 0);
            trackGrd.addColorStop(0.0, 'rgba(20, 24, 32, 0.0)');
            trackGrd.addColorStop(0.2, 'rgba(20, 24, 32, 0.35)');
            trackGrd.addColorStop(0.5, 'rgba(20, 24, 32, 0.50)');
            trackGrd.addColorStop(0.8, 'rgba(20, 24, 32, 0.35)');
            trackGrd.addColorStop(1.0, 'rgba(20, 24, 32, 0.0)');
            mc.fillStyle = trackGrd;
            mc.fillRect(cx - sleeperHalfW - 24, 0, sleeperHalfW * 2 + 48, 1024);
        });

        for (let t = 0; t < tieCount; t++) {
            const ty = t * tieStep + 14;
            trackCenters.forEach((cx) => {
                const sx = cx - sleeperHalfW;
                const sw = sleeperHalfW * 2;

                // Ground contact drop shadow for each individual sleeper
                mc.fillStyle = 'rgba(12, 15, 20, 0.65)';
                mc.fillRect(sx - 3, ty + 4, sw + 6, 36);

                // Dark charcoal-treated timber / concrete composite sleeper body
                mc.fillStyle = '#222730';
                mc.fillRect(sx, ty, sw, 32);

                // Top beveled highlight & wood/composite grain streaks
                mc.fillStyle = '#3c4554';
                mc.fillRect(sx + 2, ty + 2, sw - 4, 4);

                for (let g = 0; g < 3; g++) {
                    mc.fillStyle = 'rgba(18, 22, 28, 0.45)';
                    mc.fillRect(sx + 6, ty + 8 + g * 7, sw - 12, 2);
                }

                // Steel rail base plates & twin heavy mounting spikes under both rails of this track
                [-56, 56].forEach(railOff => {
                    const rx = cx + railOff;
                    mc.fillStyle = '#181c22';
                    mc.fillRect(rx - 15, ty - 2, 30, 36);
                    mc.fillStyle = '#4a5668';
                    mc.fillRect(rx - 13, ty, 26, 3);
                    // Chrome-steel spike heads
                    mc.fillStyle = '#8a9bb2';
                    mc.fillRect(rx - 10, ty + 5, 5, 5);
                    mc.fillRect(rx + 5, ty + 22, 5, 5);
                });

                // Bump map for 3D sleeper relief
                mb.fillStyle = '#dcdcdc';
                mb.fillRect(sx, ty, sw, 32);
            });
        }

        // Clean crisp road curb edge AO on left & right
        const mLeftAO = mc.createLinearGradient(0, 0, 48, 0);
        mLeftAO.addColorStop(0, 'rgba(16, 20, 26, 0.65)');
        mLeftAO.addColorStop(1, 'rgba(16, 20, 26, 0.0)');
        mc.fillStyle = mLeftAO;
        mc.fillRect(0, 0, 48, 1024);

        const mRightAO = mc.createLinearGradient(1024, 0, 976, 0);
        mRightAO.addColorStop(0, 'rgba(16, 20, 26, 0.65)');
        mRightAO.addColorStop(1, 'rgba(16, 20, 26, 0.0)');
        mc.fillStyle = mRightAO;
        mc.fillRect(976, 0, 48, 1024);

        this.textures.mineFloor = this.configureTex(mnC, 1, 4.0, true);
        this.textures.mineBump = this.configureTex(mnB, 1, 4.0, false);

        // 4. ANCIENT WEATHERED CHISELED TEMPLE ASHLAR MASONRY (512x512 — Cool Slate-Limestone & Warm Sandstone Blocks)
        const stC = document.createElement('canvas');
        const stB = document.createElement('canvas');
        stC.width = stB.width = 512;
        stC.height = stB.height = 512;
        const sc = stC.getContext('2d');
        const sb = stB.getContext('2d');

        sc.fillStyle = '#25282c';
        sc.fillRect(0, 0, 512, 512);
        sb.fillStyle = '#141414';
        sb.fillRect(0, 0, 512, 512);

        const courses = 6;
        const cH = 512 / courses;
        for (let r = 0; r < courses; r++) {
            const blocks = 3;
            const bW = 512 / blocks;
            const offset = (r % 2) * (bW * 0.5) + ((r * 19) % 17);
            for (let b = -1; b <= blocks; b++) {
                const bx = b * bW + offset;
                const by = r * cH;
                const seed = r * 11 + b * 7;
                const shade = 114 + (this.hash2(seed, 19) - 0.5) * 34;
                const cool = (this.hash2(seed, 29) - 0.5) * 12;
                const sg = sc.createLinearGradient(bx, by, bx + bW * 0.3, by + cH);
                sg.addColorStop(0, `rgb(${(shade + 14 - cool * 0.3)|0}, ${(shade + 15)|0}, ${(shade + 18 + cool)|0})`);
                sg.addColorStop(0.55, `rgb(${(shade - cool * 0.3)|0}, ${(shade + 2)|0}, ${(shade + 6 + cool)|0})`);
                sg.addColorStop(1, `rgb(${(shade - 18)|0}, ${(shade - 16)|0}, ${(shade - 12 + cool)|0})`);
                sc.fillStyle = sg;
                sc.fillRect(bx + 3.5, by + 3.5, bW - 7, cH - 7);

                sb.fillStyle = '#c4c4c4';
                sb.fillRect(bx + 4, by + 4, bW - 8, cH - 8);
                sb.fillStyle = '#e0e0e0';
                sb.fillRect(bx + 9, by + 9, bW - 18, cH - 18);

                // Pitted natural stone grain inside each ashlar block
                for (let g = 0; g < 16; g++) {
                    const gx = bx + 8 + this.hash2(seed + g, 41) * (bW - 20);
                    const gy = by + 8 + this.hash2(seed + g, 47) * (cH - 20);
                    sc.fillStyle = g % 2 === 0 ? 'rgba(34, 38, 44, 0.14)' : 'rgba(225, 232, 238, 0.12)';
                    sc.fillRect(gx, gy, 5 + (g % 4) * 4, 3 + (g % 3) * 3);
                }

                // Sunlit upper stone arris + dark bottom joint shadow
                sc.strokeStyle = 'rgba(222, 228, 234, 0.34)';
                sc.lineWidth = 2;
                sc.beginPath();
                sc.moveTo(bx + 5, by + cH - 5);
                sc.lineTo(bx + 5, by + 5);
                sc.lineTo(bx + bW - 5, by + 5);
                sc.stroke();

                if (this.hash2(seed, 71) > 0.42) {
                    sc.strokeStyle = 'rgba(26, 30, 34, 0.48)';
                    sc.lineWidth = 1.8;
                    sc.beginPath();
                    sc.moveTo(bx + bW * (0.28 + this.hash2(seed, 73) * 0.4), by + 4);
                    sc.lineTo(bx + bW * 0.46, by + cH * 0.55);
                    sc.lineTo(bx + bW * 0.39, by + cH - 4);
                    sc.stroke();
                }
            }
        }
        // Subtle vertical rainwater weathering streaks & natural joint moss (no polka-dot green circles!)
        for (let w = 0; w < 28; w++) {
            const wx = this.hash2(w, 83) * 512;
            const wy = this.hash2(w, 89) * 360;
            const wg = sc.createLinearGradient(0, wy, 0, wy + 130);
            wg.addColorStop(0, 'rgba(28, 36, 26, 0.24)');
            wg.addColorStop(1, 'rgba(28, 36, 26, 0.0)');
            sc.fillStyle = wg;
            sc.fillRect(wx, wy, 6 + (w % 4) * 4, 130);
        }
        for (let m = 0; m < 75; m++) {
            const mr = Math.floor(this.hash2(m, 31) * courses);
            const mx = this.hash2(m, 37) * 512;
            const my = mr * cH + (this.hash2(m, 43) - 0.5) * 8;
            sc.fillStyle = m % 2 === 0 ? 'rgba(48, 88, 34, 0.44)' : 'rgba(72, 112, 42, 0.32)';
            sc.fillRect(mx, my - 3, 10 + this.hash2(m, 49) * 22, 5 + (m % 3) * 2);
        }
        this.textures.masonry = this.configureTex(stC, 2, 1, true);
        this.textures.masonryBump = this.configureTex(stB, 2, 1, false);
        this.textures.pillarMasonry = this.configureTex(stC, 0.75, 3.2, true);
        this.textures.pillarMasonryBump = this.configureTex(stB, 0.75, 3.2, false);
        this.textures.parapet = this.configureTex(stC, 8, 0.7, true);
        this.textures.parapetBump = this.configureTex(stB, 8, 0.7, false);

        // 5. ANCIENT GOLDEN-OCHRE & MOSSY MAYAN LABYRINTH / TEMPLE RELIEF (512x512)
        const glC = document.createElement('canvas');
        const glB = document.createElement('canvas');
        glC.width = glB.width = 512;
        glC.height = glB.height = 512;
        const gc = glC.getContext('2d');
        const gb = glB.getContext('2d');

        gc.fillStyle = '#262018';
        gc.fillRect(0, 0, 512, 512);
        gb.fillStyle = '#181818';
        gb.fillRect(0, 0, 512, 512);

        for (let py = 0; py < 2; py++) {
            for (let px = 0; px < 2; px++) {
                const ox = px * 256, oy = py * 256;
                const stoneGrad = gc.createLinearGradient(ox, oy, ox + 256, oy + 256);
                stoneGrad.addColorStop(0, '#9e8864');
                stoneGrad.addColorStop(0.5, '#826e4e');
                stoneGrad.addColorStop(1, '#5e4e36');
                gc.fillStyle = stoneGrad;
                gc.fillRect(ox + 6, oy + 6, 244, 244);

                gb.fillStyle = '#c8c8c8';
                gb.fillRect(ox + 8, oy + 8, 240, 240);

                // Recessed dark Mayan labyrinth / step-fret temple carving (matches TikTok ancient reliefs!)
                gc.fillStyle = '#33281b';
                gc.fillRect(ox + 28, oy + 28, 200, 200);
                gb.fillStyle = '#363636';
                gb.fillRect(ox + 28, oy + 28, 200, 200);

                // Raised golden-sandstone labyrinth bands & central temple idol motif
                gc.strokeStyle = '#b89b67';
                gc.lineWidth = 14;
                gc.strokeRect(ox + 46, oy + 46, 164, 164);
                gc.strokeRect(ox + 78, oy + 78, 100, 100);
                gb.strokeStyle = '#e0e0e0';
                gb.lineWidth = 14;
                gb.strokeRect(ox + 46, oy + 46, 164, 164);
                gb.strokeRect(ox + 78, oy + 78, 100, 100);

                gc.fillStyle = '#c4a66e';
                gc.fillRect(ox + 106, oy + 106, 44, 44);
                gb.fillStyle = '#f0f0f0';
                gb.fillRect(ox + 106, oy + 106, 44, 44);

                // Heavy ancient jungle moss draping over top & corners of carved blocks
                for (let m = 0; m < 14; m++) {
                    const mx = ox + 14 + this.hash2(px * 30 + m, py + 5) * 228;
                    const my = oy + (m < 8 ? 10 + this.hash2(m, 9) * 45 : 210 + this.hash2(m, 11) * 35);
                    gc.fillStyle = m % 2 === 0 ? 'rgba(54, 98, 34, 0.55)' : 'rgba(76, 124, 42, 0.42)';
                    gc.beginPath();
                    gc.ellipse(mx, my, 16 + (m % 4) * 5, 9 + (m % 3) * 4, 0, 0, Math.PI * 2);
                    gc.fill();
                }
            }
        }
        this.textures.glyph = this.configureTex(glC, 1, 1, true);
        this.textures.glyphBump = this.configureTex(glB, 1, 1, false);

        // 6. REALISTIC FISSURED TROPICAL MAHOGANY BARK (512x512, organic bark plates, lichen & moss)
        const bkC = document.createElement('canvas');
        const bkB = document.createElement('canvas');
        bkC.width = bkB.width = 512;
        bkC.height = bkB.height = 512;
        const kc = bkC.getContext('2d');
        const kb = bkB.getContext('2d');

        kc.fillStyle = '#56311d';
        kc.fillRect(0, 0, 512, 512);
        kb.fillStyle = '#848484';
        kb.fillRect(0, 0, 512, 512);

        // Layered organic bark plates & fine fibrous ridges (UV.x runs along TubeGeometry length!)
        for (let i = 0; i < 110; i++) {
            const y = (i / 110) * 512 + (this.hash2(i, 12) - 0.5) * 4;
            const pick = i % 5;
            kc.strokeStyle = pick === 0 ? '#2b150b'
                : (pick === 1 ? '#6e4026'
                : (pick === 2 ? '#472615'
                : (pick === 3 ? '#7f4c2f' : '#3a1d0f')));
            kc.lineWidth = 1.6 + this.hash2(i, 19) * 3.4;
            kc.beginPath();
            kc.moveTo(0, y);
            kc.bezierCurveTo(
                170, y + (this.hash2(i, 21) - 0.5) * 18,
                340, y + (this.hash2(i, 27) - 0.5) * 18,
                512, y
            );
            kc.stroke();

            kb.strokeStyle = pick === 0 ? '#242424' : (pick === 3 ? '#dedede' : '#767676');
            kb.lineWidth = 2.4;
            kb.beginPath();
            kb.moveTo(0, y);
            kb.bezierCurveTo(
                170, y + (this.hash2(i, 21) - 0.5) * 18,
                340, y + (this.hash2(i, 27) - 0.5) * 18,
                512, y
            );
            kb.stroke();
        }
        // Subtle jungle moss & pale bark lichen patches near root crevices
        for (let k = 0; k < 44; k++) {
            const kx = this.hash2(k, 81) * 512;
            const ky = this.hash2(k, 83) * 512;
            kc.fillStyle = k % 3 === 0 ? 'rgba(58, 102, 40, 0.30)'
                : (k % 3 === 1 ? 'rgba(138, 124, 98, 0.16)' : 'rgba(32, 14, 6, 0.34)');
            kc.beginPath();
            kc.ellipse(kx, ky, 16 + (k % 5) * 5, 4 + (k % 3) * 2.2, 0, 0, Math.PI * 2);
            kc.fill();
        }
        this.textures.mahogany = this.configureTex(bkC, 2.5, 1.5, true);
        this.textures.mahoganyBump = this.configureTex(bkB, 2.5, 1.5, false);

        const lgC = document.createElement('canvas');
        lgC.width = lgC.height = 512;
        const lc = lgC.getContext('2d');
        lc.fillStyle = '#5e341c';
        lc.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 64; i++) {
            const x = (i / 64) * 512;
            lc.strokeStyle = i % 3 === 0 ? '#2e160a' : (i % 3 === 1 ? '#874f2e' : '#6c3c21');
            lc.lineWidth = 4 + (i % 4) * 2.2;
            lc.beginPath();
            lc.moveTo(x, 0);
            lc.bezierCurveTo(x + 14, 170, x - 14, 340, x + 3, 512);
            lc.stroke();
        }
        for (let k = 0; k < 26; k++) {
            const kx = this.hash2(k, 61) * 512;
            const ky = this.hash2(k, 67) * 512;
            lc.fillStyle = k % 3 === 0 ? 'rgba(54, 98, 36, 0.34)' : 'rgba(38, 16, 6, 0.42)';
            lc.beginPath();
            lc.ellipse(kx, ky, 7 + (k % 3) * 3, 18 + (k % 5) * 6, 0, 0, Math.PI * 2);
            lc.fill();
        }
        this.textures.darkBark = this.configureTex(lgC, 2, 1.5, true);

        // 6B. SAW-CUT GOLDEN HEARTWOOD LOG END-CAP & BRAIDED HEMP ROPE TEXTURES (matches TikTok swinging logs!)
        const leC = document.createElement('canvas');
        const leB = document.createElement('canvas');
        leC.width = leB.width = 256;
        leC.height = leB.height = 256;
        const lex = leC.getContext('2d');
        const leb = leB.getContext('2d');
        const endGrad = lex.createRadialGradient(128, 128, 6, 128, 128, 128);
        endGrad.addColorStop(0.0, '#b57b45');
        endGrad.addColorStop(0.22, '#e2ba82');
        endGrad.addColorStop(0.68, '#edd0a3');
        endGrad.addColorStop(0.86, '#cfa068');
        endGrad.addColorStop(0.93, '#542912');
        endGrad.addColorStop(1.0, '#361809');
        lex.fillStyle = endGrad;
        lex.fillRect(0, 0, 256, 256);
        leb.fillStyle = '#909090';
        leb.fillRect(0, 0, 256, 256);

        // Concentric annual tree growth rings + radial drying splits
        for (let r = 10; r < 114; r += 6.5) {
            lex.strokeStyle = r % 13 < 6 ? 'rgba(138, 86, 40, 0.48)' : 'rgba(176, 118, 62, 0.34)';
            lex.lineWidth = 2.0;
            lex.beginPath();
            for (let a = 0; a <= 40; a++) {
                const ang = (a / 40) * Math.PI * 2;
                const rad = r + Math.sin(ang * 4 + r * 0.2) * 1.8;
                const px = 128 + Math.cos(ang) * rad;
                const py = 128 + Math.sin(ang) * rad;
                if (a === 0) lex.moveTo(px, py);
                else lex.lineTo(px, py);
            }
            lex.closePath();
            lex.stroke();
            leb.strokeStyle = '#555555';
            leb.lineWidth = 2.0;
            leb.stroke();
        }
        [0.4, 2.35, 4.4].forEach((ang) => {
            lex.strokeStyle = 'rgba(62, 30, 12, 0.62)';
            lex.lineWidth = 2.6;
            lex.beginPath();
            lex.moveTo(128, 128);
            lex.lineTo(128 + Math.cos(ang) * 92, 128 + Math.sin(ang) * 92);
            lex.stroke();
            leb.strokeStyle = '#181818';
            leb.lineWidth = 3.5;
            leb.stroke();
        });
        this.textures.logEnd = this.configureTex(leC, 1, 1, true);
        this.textures.logEndBump = this.configureTex(leB, 1, 1, false);

        const rpC = document.createElement('canvas');
        const rpB = document.createElement('canvas');
        rpC.width = rpB.width = 128;
        rpC.height = rpB.height = 128;
        const rpx = rpC.getContext('2d');
        const rpb = rpB.getContext('2d');
        rpx.fillStyle = '#b88d52';
        rpx.fillRect(0, 0, 128, 128);
        rpb.fillStyle = '#808080';
        rpb.fillRect(0, 0, 128, 128);
        for (let s = -128; s < 256; s += 16) {
            rpx.strokeStyle = '#735024';
            rpx.lineWidth = 5;
            rpx.beginPath();
            rpx.moveTo(0, s);
            rpx.lineTo(128, s + 64);
            rpx.stroke();
            rpx.strokeStyle = '#e0ba7e';
            rpx.lineWidth = 4;
            rpx.beginPath();
            rpx.moveTo(0, s + 6);
            rpx.lineTo(128, s + 70);
            rpx.stroke();

            rpb.strokeStyle = '#282828';
            rpb.lineWidth = 5;
            rpb.beginPath();
            rpb.moveTo(0, s);
            rpb.lineTo(128, s + 64);
            rpb.stroke();
            rpb.strokeStyle = '#e6e6e6';
            rpb.lineWidth = 5;
            rpb.beginPath();
            rpb.moveTo(0, s + 6);
            rpb.lineTo(128, s + 70);
            rpb.stroke();
        }
        this.textures.rope = this.configureTex(rpC, 2, 6, true);
        this.textures.ropeBump = this.configureTex(rpB, 2, 6, false);

        // 7A. HD REALISTIC BOTANICAL RAINFOREST LEAF-BOUGH CLUSTER ATLAS (768x768 RGBA Alpha-Cutout!)
        const lbC = document.createElement('canvas');
        lbC.width = lbC.height = 768;
        const lbx = lbC.getContext('2d');
        lbx.clearRect(0, 0, 768, 768);
        lbx.save();
        lbx.scale(1.5, 1.5);

        const drawPointedLeaf = (ctx, x, y, len, wid, angle, baseHex, tipHex, veinHex) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            // Soft drop-shadow beneath each leaf for deep botanical cluster relief
            ctx.fillStyle = 'rgba(6, 20, 8, 0.28)';
            ctx.beginPath();
            ctx.moveTo(2, 3);
            ctx.bezierCurveTo(len * 0.28, -wid + 3, len * 0.74, -wid * 0.68 + 3, len + 2, 3);
            ctx.bezierCurveTo(len * 0.74, wid * 0.68 + 3, len * 0.28, wid + 3, 2, 3);
            ctx.closePath();
            ctx.fill();

            const g = ctx.createLinearGradient(0, -wid * 0.6, len, wid * 0.5);
            g.addColorStop(0, baseHex);
            g.addColorStop(0.58, tipHex);
            g.addColorStop(1, tipHex);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(len * 0.26, -wid, len * 0.72, -wid * 0.68, len, 0);
            ctx.bezierCurveTo(len * 0.72, wid * 0.68, len * 0.26, wid, 0, 0);
            ctx.closePath();
            ctx.fill();

            // Sunlit upper-half leaf sheen + translucent midrib & lateral veins (NO dark cartoon outline!)
            ctx.fillStyle = 'rgba(214, 228, 186, 0.11)';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(len * 0.26, -wid * 0.92, len * 0.72, -wid * 0.60, len * 0.96, 0);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = veinHex;
            ctx.lineWidth = 1.05;
            ctx.beginPath();
            ctx.moveTo(2, 0);
            ctx.lineTo(len * 0.90, 0);
            for (let v = 1; v <= 4; v++) {
                const vx = len * (v * 0.19);
                const vw = wid * (0.58 - v * 0.08);
                ctx.moveTo(vx, 0); ctx.lineTo(vx + len * 0.10, -vw);
                ctx.moveTo(vx, 0); ctx.lineTo(vx + len * 0.10, vw);
            }
            ctx.stroke();
            ctx.restore();
        };

        // Woody mahogany twigs & branchlets radiating organically inside the bough
        lbx.strokeStyle = '#3f2211';
        lbx.lineCap = 'round';
        [
            [256, 476, 256, 86, 6.5],
            [256, 375, 108, 192, 4.5],
            [256, 352, 404, 184, 4.5],
            [256, 244, 138, 98, 3.5],
            [256, 236, 378, 94, 3.5]
        ].forEach(([x1, y1, x2, y2, w]) => {
            lbx.lineWidth = w;
            lbx.beginPath();
            lbx.moveTo(x1, y1);
            lbx.quadraticCurveTo((x1 + x2) * 0.5 + 10, (y1 + y2) * 0.5, x2, y2);
            lbx.stroke();
        });

        // 4 rich natural rainforest foliage layers (deep emerald interior -> warm sunlit chartreuse-emerald outer leaves!)
        // Natural (non-cartoon) leaf colours: each leaf gets its own hue / saturation / lightness jitter,
        // deep shaded interior -> sunlit olive & yellow-green outer leaves, with the odd ageing yellow leaf.
        const hsl = (h, s, l) => `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
        for (let layer = 0; layer < 5; layer++) {
            const count = [34, 30, 28, 22, 14][layer];
            for (let i = 0; i < count; i++) {
                const seed = layer * 100 + i;
                const rad = (i / count) * Math.PI * 2 + this.hash2(seed, 1) * 0.55;
                const dist = 20 + this.hash2(seed, 2) * (layer >= 3 ? 138 : 166);
                const lx = 256 + Math.cos(rad) * dist * 0.94;
                const ly = 258 + Math.sin(rad) * dist * 0.90;
                const len = 58 + this.hash2(seed, 3) * 46;
                const wid = 15 + this.hash2(seed, 4) * 11;
                const ang = rad + (this.hash2(seed, 5) - 0.5) * 0.9;

                const aged = this.hash2(seed, 6) > 0.955;
                const hue = aged ? 58 + this.hash2(seed, 7) * 14 : 84 + this.hash2(seed, 7) * 30;
                const sat = aged ? 48 : 30 + this.hash2(seed, 8) * 24 + layer * 2;
                const lit = 12 + layer * 5.2 + this.hash2(seed, 9) * 7;
                const base = hsl(hue + 4, sat * 0.9, lit * 0.8);
                const tip = hsl(hue - 3, sat, Math.min(52, lit * 1.28));
                const vein = `hsla(${(hue - 10).toFixed(0)}, ${Math.min(70, sat + 14).toFixed(0)}%, ${Math.min(75, lit + 26).toFixed(0)}%, 0.38)`;
                drawPointedLeaf(lbx, lx, ly, len, wid, ang, base, tip, vein);
            }
        }
        lbx.restore();

        // Micro surface detail: subtle blotchy pigment variation & tiny speckles inside every opaque leaf pixel
        {
            const S = 768;
            const img = lbx.getImageData(0, 0, S, S);
            const d = img.data;
            const gLeaf = this.bakeNoiseGrid(256, 24, 3, 5);
            const leafTab = this.getNoiseTable();
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    const idx = (y * S + x) * 4;
                    if (d[idx + 3] < 8) continue;
                    const n = this.sampleGrid(gLeaf, x / S, y / S);
                    const m = 0.84 + n * 0.30 + (leafTab[(x & 255) | ((y & 255) << 8)] - 0.5) * 0.06;
                    d[idx] = Math.min(255, d[idx] * m * 1.02);
                    d[idx + 1] = Math.min(255, d[idx + 1] * m);
                    d[idx + 2] = Math.min(255, d[idx + 2] * m * 0.96);
                }
            }
            lbx.putImageData(img, 0, 0);
        }
        const leafBoughTex = new THREE.CanvasTexture(lbC);
        leafBoughTex.encoding = THREE.sRGBEncoding;
        leafBoughTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);
        this.textures.leafBough = leafBoughTex;

        // 7B. REALISTIC PINNATE TROPICAL FERN / PALM FROND (256x512 RGBA Alpha-Cutout!)
        const fnC = document.createElement('canvas');
        fnC.width = 256;
        fnC.height = 512;
        const fnx = fnC.getContext('2d');
        fnx.clearRect(0, 0, 256, 512);

        // Tapering green central stem (rachis)
        fnx.strokeStyle = '#3b5a22';
        fnx.lineWidth = 6;
        fnx.beginPath();
        fnx.moveTo(128, 508);
        fnx.lineTo(128, 18);
        fnx.stroke();

        // 26 pairs of crisp individual serrated leaflets along stem!
        const pairs = 26;
        for (let p = 0; p < pairs; p++) {
            const t = p / (pairs - 1);
            const y = 492 - t * 462;
            const env = Math.sin(Math.pow(t, 0.68) * Math.PI * 0.94);
            const len = 18 + env * 96;
            const wid = 6.5 + env * 7.5;
            [-1, 1].forEach((dir) => {
                const ang = dir < 0 ? Math.PI + 0.34 + t * 0.22 : -0.34 - t * 0.22;
                const fj = this.hash2(p * 2 + dir, 17);
                drawPointedLeaf(
                    fnx, 128, y, len, wid, ang,
                    `hsl(${(98 + fj * 10).toFixed(0)}, 38%, ${(15 + fj * 4).toFixed(0)}%)`,
                    `hsl(${(88 + fj * 12).toFixed(0)}, 42%, ${(t > 0.55 ? 34 : 27) + fj * 5}%)`,
                    'rgba(196, 222, 150, 0.35)'
                );
            });
        }
        // Top terminal leaflet
        drawPointedLeaf(fnx, 128, 36, 34, 7, -Math.PI / 2, '#2c4f1c', '#62893a', 'rgba(196,222,150,0.35)');
        const fernTex = new THREE.CanvasTexture(fnC);
        fernTex.encoding = THREE.sRGBEncoding;
        this.textures.fernFrond = fernTex;

        // 7C. HANGING JUNGLE IVY VINES CURTAIN (256x256 RGBA Alpha-Cutout — lush top garland + natural tapered tendrils!)
        const vnC = document.createElement('canvas');
        vnC.width = vnC.height = 256;
        const vnx = vnC.getContext('2d');
        vnx.clearRect(0, 0, 256, 256);
        for (let g = 0; g < 18; g++) {
            const gx = (g / 18) * 256 + 6;
            drawPointedLeaf(vnx, gx, 4 + (g % 3) * 6, 28, 11, 0.5 + (g % 4) * 0.55, '#1e3a17', '#4f7a2e', 'rgba(190,215,140,0.3)');
        }
        for (let v = 0; v < 7; v++) {
            const vx = 18 + v * 36;
            const vLen = 95 + ((v * 37) % 135);
            vnx.strokeStyle = '#264d1d';
            vnx.lineWidth = 2.6;
            vnx.beginPath();
            vnx.moveTo(vx, 0);
            vnx.bezierCurveTo(vx + (v % 2 ? 14 : -14), vLen * 0.38, vx + (v % 2 ? -12 : 12), vLen * 0.74, vx + 3, vLen);
            vnx.stroke();
            for (let l = 10; l < vLen - 6; l += 19) {
                const t = l / vLen;
                const side = (l % 38 === 10) ? 1 : -1;
                const sz = (1.0 - t * 0.42);
                drawPointedLeaf(vnx, vx + Math.sin(t * 5 + v) * 5, l, 26 * sz, 9.5 * sz, side > 0 ? 0.52 : Math.PI - 0.52, '#21401a', '#5a8634', 'rgba(190,215,140,0.3)');
            }
        }
        const vineTex = new THREE.CanvasTexture(vnC);
        vineTex.encoding = THREE.sRGBEncoding;
        vineTex.wrapS = THREE.RepeatWrapping;
        this.textures.hangingVines = vineTex;

        // 7D. DENSE FOREST GROUND FOLIAGE TEXTURE + CRAGGY CAVE & BOULDER ROCK TEXTURES
        const lfC = document.createElement('canvas');
        const lfB = document.createElement('canvas');
        lfC.width = lfB.width = 512;
        lfC.height = lfB.height = 512;
        const lfc = lfC.getContext('2d');
        const lfb = lfB.getContext('2d');
        lfc.fillStyle = '#1c3518';
        lfc.fillRect(0, 0, 512, 512);
        lfb.fillStyle = '#303030';
        lfb.fillRect(0, 0, 512, 512);
        const leafPalette = ['#22401b', '#2d5222', '#3a6329', '#4b7432', '#5f863c'];
        for (let i = 0; i < 420; i++) {
            const lx = this.hash2(i, 61) * 512;
            const ly = this.hash2(i, 67) * 512;
            const ang = this.hash2(i, 71) * Math.PI * 2;
            const lw = 14 + this.hash2(i, 73) * 18;
            const lh = 7 + this.hash2(i, 79) * 9;
            lfc.save();
            lfc.translate(lx, ly);
            lfc.rotate(ang);
            lfc.fillStyle = leafPalette[Math.min(4, Math.floor((i / 420) * 5))];
            lfc.beginPath();
            lfc.ellipse(0, 0, lw, lh, 0, 0, Math.PI * 2);
            lfc.fill();
            lfc.restore();

            lfb.save();
            lfb.translate(lx, ly);
            lfb.rotate(ang);
            lfb.fillStyle = `rgb(${110 + ((i % 5) * 28)}, ${110 + ((i % 5) * 28)}, ${110 + ((i % 5) * 28)})`;
            lfb.beginPath();
            lfb.ellipse(0, 0, lw, lh, 0, 0, Math.PI * 2);
            lfb.fill();
            lfb.restore();
        }
        this.textures.foliage = this.configureTex(lfC, 2, 2, true);
        this.textures.foliageBump = this.configureTex(lfB, 2, 2, false);

        // Chiseled Faceted Cavern & Boulder Slate-Granite Rock Texture (organic angular rock plates, ZERO horizontal bricks!)
        const rkC = document.createElement('canvas');
        const rkB = document.createElement('canvas');
        rkC.width = rkB.width = 512;
        rkC.height = rkB.height = 512;
        const rkx = rkC.getContext('2d');
        const rkb = rkB.getContext('2d');
        rkx.fillStyle = '#4c5664';
        rkx.fillRect(0, 0, 512, 512);
        rkb.fillStyle = '#808080';
        rkb.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 240; i++) {
            const rx = this.hash2(i, 12) * 512;
            const ry = this.hash2(i, 19) * 512;
            const rad = 18 + this.hash2(i, 23) * 44;
            const shade = 62 + Math.floor(this.hash2(i, 31) * 62);
            const tracePoly = (ctxT) => {
                ctxT.beginPath();
                for (let v = 0; v < 6; v++) {
                    const a = (v / 6) * Math.PI * 2 + this.hash2(i, 50 + v) * 0.55;
                    const rr = rad * (0.62 + this.hash2(i, 60 + v) * 0.58);
                    const px = rx + Math.cos(a) * rr;
                    const py = ry + Math.sin(a) * rr * 0.85;
                    if (v === 0) ctxT.moveTo(px, py);
                    else ctxT.lineTo(px, py);
                }
                ctxT.closePath();
            };
            rkx.fillStyle = `rgba(${shade - 4}, ${shade + 4}, ${shade + 14}, 0.55)`;
            tracePoly(rkx);
            rkx.fill();
            rkx.strokeStyle = 'rgba(18, 24, 32, 0.32)';
            rkx.lineWidth = 1.6;
            rkx.stroke();

            const bVal = Math.min(245, Math.max(20, 48 + shade * 1.45));
            rkb.fillStyle = `rgba(${bVal}, ${bVal}, ${bVal}, 0.65)`;
            tracePoly(rkb);
            rkb.fill();
        }
        // Craggy diagonal cavern rock fissures & subtle mineral veins (never horizontal stripes!)
        for (let f = 0; f < 24; f++) {
            const fx0 = this.hash2(f, 41) * 512;
            const fy0 = this.hash2(f, 43) * 512;
            const ang = (this.hash2(f, 45) - 0.5) * 2.4;
            const len = 90 + this.hash2(f, 47) * 150;
            rkx.strokeStyle = f % 4 === 0 ? 'rgba(145, 190, 215, 0.22)' : 'rgba(16, 22, 30, 0.52)';
            rkx.lineWidth = 2.2;
            rkx.beginPath();
            rkx.moveTo(fx0, fy0);
            rkx.quadraticCurveTo(
                fx0 + Math.cos(ang + 0.4) * len * 0.55,
                fy0 + Math.sin(ang + 0.4) * len * 0.55,
                fx0 + Math.cos(ang) * len,
                fy0 + Math.sin(ang) * len
            );
            rkx.stroke();
            rkb.strokeStyle = '#1c1c1c';
            rkb.lineWidth = 3.2;
            rkb.stroke();
        }
        this.textures.rock = this.configureTex(rkC, 2, 2, true);
        this.textures.rockBump = this.configureTex(rkB, 2, 2, false);

        // 7E. RICH TROPICAL FOREST SOIL, HUMUS, ROOT TENDRILS & PEBBLES (512x512, for under trees & terraces!)
        const slC = document.createElement('canvas');
        const slB = document.createElement('canvas');
        slC.width = slB.width = 512;
        slC.height = slB.height = 512;
        const slx = slC.getContext('2d');
        const slb = slB.getContext('2d');
        slx.fillStyle = '#3a2414';
        slx.fillRect(0, 0, 512, 512);
        slb.fillStyle = '#707070';
        slb.fillRect(0, 0, 512, 512);

        // Organic soil clods, damp dark humus & warm clay patches
        const soilPalette = ['#2b190d', '#3d2616', '#4d311d', '#5c3c24', '#332012'];
        for (let i = 0; i < 480; i++) {
            const sx = this.hash2(i, 13) * 512;
            const sy = this.hash2(i, 17) * 512;
            const sr = 6 + this.hash2(i, 23) * 24;
            slx.fillStyle = soilPalette[i % soilPalette.length];
            slx.beginPath();
            slx.ellipse(sx, sy, sr, sr * 0.72, this.hash2(i, 29) * Math.PI, 0, Math.PI * 2);
            slx.fill();

            const bh = 65 + (i % 6) * 26;
            slb.fillStyle = `rgb(${bh}, ${bh}, ${bh})`;
            slb.beginPath();
            slb.ellipse(sx, sy, sr * 0.85, sr * 0.6, 0, 0, Math.PI * 2);
            slb.fill();
        }
        // Embedded river pebbles, fallen dry leaves, moss tufts & fine surface rootlets
        for (let p = 0; p < 140; p++) {
            const px = this.hash2(p, 53) * 512;
            const py = this.hash2(p, 59) * 512;
            if (p < 55) {
                // Small weathered stones / pebbles in the soil
                slx.fillStyle = p % 2 === 0 ? '#73685c' : '#595046';
                slx.beginPath();
                slx.ellipse(px, py, 4 + (p % 5) * 2, 3 + (p % 4) * 1.5, p, 0, Math.PI * 2);
                slx.fill();
                slb.fillStyle = '#e8e8e8';
                slb.beginPath();
                slb.arc(px, py, 5, 0, Math.PI * 2);
                slb.fill();
            } else if (p < 105) {
                // Mossy patches growing across damp tropical earth
                slx.fillStyle = p % 2 === 0 ? 'rgba(52, 102, 34, 0.62)' : 'rgba(74, 126, 42, 0.48)';
                slx.beginPath();
                slx.arc(px, py, 10 + (p % 6) * 4, 0, Math.PI * 2);
                slx.fill();
            } else {
                // Twisting woody surface rootlets & fallen leaves
                slx.strokeStyle = '#63391e';
                slx.lineWidth = 3;
                slx.beginPath();
                slx.moveTo(px, py);
                slx.quadraticCurveTo(px + 18, py + 12, px + 34, py - 6);
                slx.stroke();
            }
        }
        this.textures.soil = this.configureTex(slC, 2.5, 2.5, true);
        this.textures.soilBump = this.configureTex(slB, 2.5, 2.5, false);

        // 7F. SCULPTED COOL SLATE-LIMESTONE CLIFF & CHISELED SPIRAL RELIEF (512x512 — Matches ref_mine_traps.png & f4e454a6.jpg!)
        const spC = document.createElement('canvas');
        const spB = document.createElement('canvas');
        spC.width = spB.width = 512;
        spC.height = spB.height = 512;
        const spx = spC.getContext('2d');
        const spb = spB.getContext('2d');
        const cliffGrad = spx.createLinearGradient(0, 0, 0, 512);
        cliffGrad.addColorStop(0.0, '#627382');
        cliffGrad.addColorStop(0.38, '#778898');
        cliffGrad.addColorStop(0.75, '#5a6a78');
        cliffGrad.addColorStop(1.0, '#3a4652');
        spx.fillStyle = cliffGrad;
        spx.fillRect(0, 0, 512, 512);
        spb.fillStyle = '#888888';
        spb.fillRect(0, 0, 512, 512);

        // Organic angular rock facets (eliminates ruler-straight black plaid lines!)
        for (let i = 0; i < 280; i++) {
            const rx = this.hash2(i, 14) * 512;
            const ry = this.hash2(i, 21) * 512;
            const rw = 18 + this.hash2(i, 27) * 58;
            const rh = 12 + this.hash2(i, 33) * 42;
            const sh = 78 + Math.floor(this.hash2(i, 39) * 64);
            spx.save();
            spx.translate(rx, ry);
            spx.rotate((this.hash2(i, 45) - 0.5) * 0.55);
            spx.fillStyle = `rgba(${sh - 6}, ${sh + 4}, ${sh + 14}, 0.34)`;
            spx.fillRect(-rw * 0.5, -rh * 0.5, rw, rh);
            spx.restore();

            spb.fillStyle = `rgba(${sh + 36}, ${sh + 36}, ${sh + 36}, 0.50)`;
            spb.fillRect(rx - rw * 0.4, ry - rh * 0.4, rw * 0.8, rh * 0.8);
        }

        // Natural diagonal & craggy limestone fracture crevices (never a rectangular grid!)
        for (let f = 0; f < 16; f++) {
            const fx0 = this.hash2(f, 3) * 512;
            const fy0 = this.hash2(f, 7) * 512;
            spx.strokeStyle = f % 3 === 0 ? 'rgba(186, 204, 218, 0.24)' : 'rgba(22, 30, 38, 0.44)';
            spx.lineWidth = 2.2 + (f % 3);
            spx.beginPath();
            spx.moveTo(fx0, fy0);
            spx.bezierCurveTo(
                fx0 + (this.hash2(f, 11) - 0.5) * 180, fy0 + 70,
                fx0 + (this.hash2(f, 13) - 0.5) * 180, fy0 + 150,
                fx0 + (this.hash2(f, 17) - 0.5) * 140, fy0 + 220
            );
            spx.stroke();
            spb.strokeStyle = f % 3 === 0 ? '#dcdcdc' : '#242424';
            spb.lineWidth = 3.2;
            spb.stroke();
        }

        // Deeply chiseled ancient Mayan cliff spiral relief (recessed shadow groove + sunlit beveled ridge!)
        [[256, 254, 138]].forEach(([cx, cy, maxR]) => {
            const traceSpiral = (ctxTarget, dx, dy) => {
                ctxTarget.beginPath();
                for (let t = 8; t <= 92; t++) {
                    const ang = (t / 92) * Math.PI * 4.5 + 0.5;
                    const r = (t / 92) * maxR;
                    const px = cx + dx + Math.cos(ang) * r;
                    const py = cy + dy + Math.sin(ang) * r;
                    if (t === 8) ctxTarget.moveTo(px, py);
                    else ctxTarget.lineTo(px, py);
                }
            };
            spx.lineCap = 'round';
            spx.strokeStyle = 'rgba(136, 152, 168, 0.26)';
            spx.lineWidth = 18;
            traceSpiral(spx, -2, -3);
            spx.stroke();

            spx.strokeStyle = 'rgba(22, 32, 42, 0.64)';
            spx.lineWidth = 13;
            traceSpiral(spx, 0, 0);
            spx.stroke();

            spb.lineCap = 'round';
            spb.strokeStyle = '#ececec';
            spb.lineWidth = 24;
            traceSpiral(spb, -3, -4);
            spb.stroke();
            spb.strokeStyle = '#181818';
            spb.lineWidth = 14;
            traceSpiral(spb, 0, 0);
            spb.stroke();
        });

        // Lush emerald cliff-crown moss & trailing lichen
        for (let m = 0; m < 135; m++) {
            const mx = this.hash2(m, 81) * 512;
            const isTop = m < 100;
            const my = isTop ? this.hash2(m, 83) * (38 + this.hash2(m, 85) * 105) : 425 + this.hash2(m, 89) * 87;
            spx.fillStyle = m % 3 === 0 ? 'rgba(34, 78, 30, 0.65)' : (m % 3 === 1 ? 'rgba(54, 106, 38, 0.48)' : 'rgba(74, 122, 46, 0.36)');
            spx.beginPath();
            spx.ellipse(mx, my, 6 + (m % 5) * 4, 12 + (m % 6) * 6, 0, 0, Math.PI * 2);
            spx.fill();
        }
        this.textures.spiralCliff = this.configureTex(spC, 1, 1, true);
        this.textures.spiralCliffBump = this.configureTex(spB, 1, 1, false);

        // 7F-2. CHISELED COOL TEMPLE SLATE-LIMESTONE FOR BAYON/MAYAN GUARDIAN STATUES (256x256 + fine stone grain bump!)
        const lsC = document.createElement('canvas');
        const lsB = document.createElement('canvas');
        lsC.width = lsB.width = 256;
        lsC.height = lsB.height = 256;
        const lsx = lsC.getContext('2d');
        const lsb = lsB.getContext('2d');
        lsx.fillStyle = '#9aa6b2';
        lsx.fillRect(0, 0, 256, 256);
        lsb.fillStyle = '#888888';
        lsb.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 340; i++) {
            const lx = this.hash2(i, 91) * 256;
            const ly = this.hash2(i, 93) * 256;
            const sh = 128 + Math.floor(this.hash2(i, 95) * 58);
            lsx.fillStyle = `rgba(${sh - 4}, ${sh + 3}, ${sh + 10}, 0.30)`;
            lsx.fillRect(lx, ly, 4 + (i % 5) * 4, 4 + (i % 4) * 4);
            lsb.fillStyle = `rgb(${sh + 20}, ${sh + 20}, ${sh + 20})`;
            lsb.fillRect(lx, ly, 4 + (i % 4) * 3, 4 + (i % 4) * 3);
        }
        for (let m = 0; m < 26; m++) {
            const mx = this.hash2(m, 97) * 256;
            const my = this.hash2(m, 99) * 256;
            lsx.fillStyle = m % 2 === 0 ? 'rgba(54, 92, 42, 0.22)' : 'rgba(42, 50, 58, 0.22)';
            lsx.beginPath();
            lsx.ellipse(mx, my, 8 + (m % 4) * 4, 5 + (m % 3) * 3, 0, 0, Math.PI * 2);
            lsx.fill();
        }
        this.textures.statueLimestone = this.configureTex(lsC, 1.5, 1.5, true);
        this.textures.statueLimestoneBump = this.configureTex(lsB, 1.5, 1.5, false);

        // 7G. EMBOSSED AZTEC GOLD COIN MEDALLION TEXTURE (256x256)
        const cnC = document.createElement('canvas');
        cnC.width = cnC.height = 256;
        const cc = cnC.getContext('2d');
        const cg = cc.createRadialGradient(96, 90, 12, 128, 128, 128);
        cg.addColorStop(0.0, '#fff394');
        cg.addColorStop(0.45, '#ffc81f');
        cg.addColorStop(0.85, '#d99000');
        cg.addColorStop(1.0, '#9e6200');
        cc.fillStyle = cg;
        cc.fillRect(0, 0, 256, 256);
        cc.strokeStyle = '#7a4900';
        cc.lineWidth = 12;
        cc.beginPath();
        cc.arc(128, 128, 96, 0, Math.PI * 2);
        cc.stroke();
        for (let a = 0; a < 12; a++) {
            const rad = (a / 12) * Math.PI * 2;
            cc.strokeStyle = '#8c5400';
            cc.lineWidth = 6;
            cc.beginPath();
            cc.moveTo(128 + Math.cos(rad) * 52, 128 + Math.sin(rad) * 52);
            cc.lineTo(128 + Math.cos(rad) * 86, 128 + Math.sin(rad) * 86);
            cc.stroke();
        }
        cc.fillStyle = '#5e3600';
        cc.fillRect(102, 102, 52, 52);
        cc.strokeStyle = '#ffe97d';
        cc.lineWidth = 5;
        cc.strokeRect(102, 102, 52, 52);
        this.textures.coin = this.configureTex(cnC, 1, 1, true);

        // 7H. SUBWAY SURFERS RED & WHITE CHEVRON RAILWAY TRACK BARRIER (256x128 — Matches 4e84dbae.jpg & 00288df9.jpg!)
        const chC = document.createElement('canvas');
        const chB = document.createElement('canvas');
        chC.width = chB.width = 256;
        chC.height = chB.height = 128;
        const chx = chC.getContext('2d');
        const chb = chB.getContext('2d');
        chx.fillStyle = '#cc1820';
        chx.fillRect(0, 0, 256, 128);
        chb.fillStyle = '#808080';
        chb.fillRect(0, 0, 256, 128);

        // Center chevron zone: bold angled hazard arrows (<<<)
        chx.fillStyle = '#ffffff';
        chb.fillStyle = '#f0f0f0';
        for (let x = -64; x < 320; x += 56) {
            chx.beginPath();
            chx.moveTo(x + 24, 22);
            chx.lineTo(x, 64);
            chx.lineTo(x + 24, 106);
            chx.lineTo(x + 48, 106);
            chx.lineTo(x + 24, 64);
            chx.lineTo(x + 48, 22);
            chx.closePath();
            chx.fill();

            chb.beginPath();
            chb.moveTo(x + 24, 22);
            chb.lineTo(x, 64);
            chb.lineTo(x + 24, 106);
            chb.lineTo(x + 48, 106);
            chb.lineTo(x + 24, 64);
            chb.lineTo(x + 48, 22);
            chb.closePath();
            chb.fill();
        }

        // Alternating red and white hazard stripes across top & bottom border (matches Subway Surfers 00288df9.jpg!)
        for (let sx = 0; sx < 256; sx += 32) {
            chx.fillStyle = (sx % 64 === 0) ? '#cc1820' : '#ffffff';
            chb.fillStyle = (sx % 64 === 0) ? '#707070' : '#f0f0f0';
            chx.fillRect(sx, 0, 32, 22);
            chb.fillRect(sx, 0, 32, 22);
            chx.fillRect(sx, 106, 32, 22);
            chb.fillRect(sx, 106, 32, 22);
        }

        // Outer steel frame & buffer mounting rings
        chx.strokeStyle = '#181a1e';
        chx.lineWidth = 6;
        chx.strokeRect(3, 3, 250, 122);
        chb.strokeStyle = '#222222';
        chb.lineWidth = 6;
        chb.strokeRect(3, 3, 250, 122);

        // Dark circular mounting rings for corner buffers
        [[28, 28], [228, 28], [28, 100], [228, 100]].forEach(([bx, by]) => {
            chx.fillStyle = '#1c1f24';
            chx.beginPath();
            chx.arc(bx, by, 18, 0, Math.PI * 2);
            chx.fill();
            chx.strokeStyle = '#e0e4ec';
            chx.lineWidth = 2;
            chx.stroke();
        });

        this.textures.chevronBarrier = this.configureTex(chC, 1, 1, true);
        this.textures.chevronBarrierBump = this.configureTex(chB, 1, 1, false);

        // 7I. SLEEK SUBWAY PASSENGER TRAIN CAR BODY & WINDOW ATLAS (512x128 — Matches 4e84dbae.jpg & 00288df9.jpg!)
        const swC = document.createElement('canvas');
        swC.width = 512;
        swC.height = 128;
        const swx = swC.getContext('2d');
        const swGrad = swx.createLinearGradient(0, 0, 0, 128);
        swGrad.addColorStop(0.0, '#f0f4f8');
        swGrad.addColorStop(0.35, '#dbe2ea');
        swGrad.addColorStop(0.70, '#c4ccd8');
        swGrad.addColorStop(1.0, '#a6b2c2');
        swx.fillStyle = swGrad;
        swx.fillRect(0, 0, 512, 128);

        // Bold red horizontal subway racing stripe (wrapped across cab & sides!)
        swx.fillStyle = '#dc2228';
        swx.fillRect(0, 52, 512, 22);
        swx.fillStyle = '#ff7074';
        swx.fillRect(0, 52, 512, 2);
        swx.fillStyle = '#8f1217';
        swx.fillRect(0, 72, 512, 2);

        // Dark tinted passenger windows with silver gasket seals & glass reflection sheen
        for (let w = 0; w < 6; w++) {
            const wx = 32 + w * 76;
            swx.fillStyle = '#1e2530';
            swx.fillRect(wx - 2, 12, 52, 34);
            swx.fillStyle = '#0b131e';
            swx.fillRect(wx, 14, 48, 30);
            swx.fillStyle = 'rgba(180, 218, 255, 0.25)';
            swx.beginPath();
            swx.moveTo(wx + 4, 44);
            swx.lineTo(wx + 22, 14);
            swx.lineTo(wx + 34, 14);
            swx.lineTo(wx + 16, 44);
            swx.closePath();
            swx.fill();
        }
        // Silver door frames & panel seams
        swx.strokeStyle = 'rgba(50, 60, 75, 0.45)';
        swx.lineWidth = 2;
        [168, 372].forEach(dx => {
            swx.strokeRect(dx, 8, 38, 112);
            swx.beginPath();
            swx.moveTo(dx + 19, 8);
            swx.lineTo(dx + 19, 120);
            swx.stroke();
        });
        this.textures.subwaySide = this.configureTex(swC, 1, 1, true);

        // 7J. MODERN WHITE & TEAL COMMUTER TRAM WITH TRANSIT EMBLEM (512x128 — Matches 4e84dbae.jpg & 83f664ba.jpg!)
        const trC = document.createElement('canvas');
        trC.width = 512;
        trC.height = 128;
        const trx = trC.getContext('2d');
        trx.fillStyle = '#f8fafc';
        trx.fillRect(0, 0, 512, 58);
        trx.fillStyle = '#00a89d';
        trx.fillRect(0, 58, 512, 70);
        trx.fillStyle = '#02857b';
        trx.fillRect(0, 56, 512, 3);
        for (let w = 0; w < 5; w++) {
            const wx = 28 + w * 94;
            trx.fillStyle = '#1e293b';
            trx.fillRect(wx - 2, 10, 68, 44);
            trx.fillStyle = '#0f172a';
            trx.fillRect(wx, 12, 64, 40);
            trx.fillStyle = 'rgba(140, 245, 235, 0.25)';
            trx.beginPath();
            trx.moveTo(wx + 4, 52);
            trx.lineTo(wx + 26, 12);
            trx.lineTo(wx + 42, 12);
            trx.lineTo(wx + 20, 52);
            trx.closePath();
            trx.fill();
        }
        // Round green transit badge with tree/leaf logo (exact Subway Surfers tram logo!)
        [140, 375].forEach(lx => {
            trx.fillStyle = '#ffffff';
            trx.beginPath();
            trx.arc(lx, 88, 18, 0, Math.PI * 2);
            trx.fill();
            trx.strokeStyle = '#00756d';
            trx.lineWidth = 2.5;
            trx.stroke();
            trx.fillStyle = '#16a34a';
            trx.beginPath();
            trx.arc(lx, 83, 9, 0, Math.PI * 2);
            trx.fill();
            trx.fillRect(lx - 2, 85, 4, 8);
        });
        this.textures.tramSide = this.configureTex(trC, 1, 1, true);

        // 7K. HEAVY CORRUGATED FREIGHT CARGO BOXCAR TEXTURE (256x256 — Matches 83f664ba.jpg & 00288df9.jpg!)
        const cgC = document.createElement('canvas');
        const cgB = document.createElement('canvas');
        cgC.width = cgB.width = 256;
        cgC.height = cgB.height = 256;
        const cgx = cgC.getContext('2d');
        const cgb = cgB.getContext('2d');
        cgx.fillStyle = '#be8d58';
        cgx.fillRect(0, 0, 256, 256);
        cgb.fillStyle = '#808080';
        cgb.fillRect(0, 0, 256, 256);
        for (let x = 0; x < 256; x += 16) {
            cgx.fillStyle = '#9c6f3d';
            cgx.fillRect(x, 0, 4, 256);
            cgx.fillStyle = '#d9aa76';
            cgx.fillRect(x + 4, 0, 4, 256);

            cgb.fillStyle = '#303030';
            cgb.fillRect(x, 0, 4, 256);
            cgb.fillStyle = '#d0d0d0';
            cgb.fillRect(x + 4, 0, 4, 256);
        }
        cgx.fillStyle = '#3a2e22';
        cgx.fillRect(0, 0, 14, 256);
        cgx.fillRect(242, 0, 14, 256);
        cgx.fillRect(0, 0, 256, 12);
        cgx.fillRect(0, 244, 256, 12);
        this.textures.cargoCorrugated = this.configureTex(cgC, 1, 1, true);
        this.textures.cargoCorrugatedBump = this.configureTex(cgB, 1, 1, false);

        // 7L. BLUE CORRUGATED SHIPPING CONTAINER BOXCAR TEXTURE (256x256 — Matches e6196d69.jpg & f565e49c.jpg!)
        const bcC = document.createElement('canvas');
        const bcB = document.createElement('canvas');
        bcC.width = bcB.width = 256;
        bcC.height = bcB.height = 256;
        const bcx = bcC.getContext('2d');
        const bcb = bcB.getContext('2d');
        bcx.fillStyle = '#1e7596';
        bcx.fillRect(0, 0, 256, 256);
        bcb.fillStyle = '#808080';
        bcb.fillRect(0, 0, 256, 256);
        for (let x = 0; x < 256; x += 16) {
            bcx.fillStyle = '#11526b';
            bcx.fillRect(x, 0, 4, 256);
            bcx.fillStyle = '#2f93ba';
            bcx.fillRect(x + 4, 0, 4, 256);

            bcb.fillStyle = '#252525';
            bcb.fillRect(x, 0, 4, 256);
            bcb.fillStyle = '#d8d8d8';
            bcb.fillRect(x + 4, 0, 4, 256);
        }
        // Dark steel corner casting frames & lock posts
        bcx.fillStyle = '#162838';
        bcx.fillRect(0, 0, 14, 256);
        bcx.fillRect(242, 0, 14, 256);
        bcx.fillRect(0, 0, 256, 12);
        bcx.fillRect(0, 244, 256, 12);

        // White stenciled cargo specs & container codes
        bcx.fillStyle = 'rgba(235, 245, 255, 0.85)';
        bcx.font = 'bold 9px monospace';
        bcx.fillText('SUBWAY LINE', 22, 38);
        bcx.fillText('MAX 30,480 KG', 22, 54);
        bcx.fillText('CARGO-08', 22, 70);
        this.textures.blueContainer = this.configureTex(bcC, 1, 1, true);
        this.textures.blueContainerBump = this.configureTex(bcB, 1, 1, false);

        // 7J. MODERN METROPOLITAN WINDOW GRID (256x256 - Glossy dark glass & aluminum mullions)
        const winC = document.createElement('canvas');
        winC.width = winC.height = 256;
        const wx = winC.getContext('2d');
        wx.fillStyle = '#0f1722';
        wx.fillRect(0, 0, 256, 256);
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const px = col * 64 + 6;
                const py = row * 64 + 6;
                const pw = 52;
                const ph = 52;
                // Aluminum frame
                wx.fillStyle = '#c5d0dc';
                wx.fillRect(px, py, pw, ph);
                // Glass pane
                const glassGrd = wx.createLinearGradient(px, py, px + pw, py + ph);
                glassGrd.addColorStop(0.0, '#122030');
                glassGrd.addColorStop(0.4, '#1b3248');
                glassGrd.addColorStop(0.7, '#2a4866');
                glassGrd.addColorStop(1.0, '#142436');
                wx.fillStyle = glassGrd;
                wx.fillRect(px + 3, py + 3, pw - 6, ph - 6);
                // Diagonal sky specular reflection streak
                wx.fillStyle = 'rgba(210, 235, 255, 0.28)';
                wx.beginPath();
                wx.moveTo(px + 4, py + 4);
                wx.lineTo(px + 22, py + 4);
                wx.lineTo(px + 4, py + 22);
                wx.fill();
            }
        }
        this.textures.cityWindows = this.configureTex(winC, 1, 1, true);

        // 7K. SUBWAY SURFERS BILLBOARD: "SHOW DOWN" & "SUBWAY SURF" TRANSIT EMBLEM (512x256)
        // (100% Matches Subway Surfers screenshots e6196d69.jpg, 9468adf5.jpg, 8b0a9d6b.jpg!)
        const bbC = document.createElement('canvas');
        bbC.width = 512;
        bbC.height = 256;
        const bx = bbC.getContext('2d');
        // Dark navy / royal purple field
        bx.fillStyle = '#141834';
        bx.fillRect(0, 0, 512, 256);

        // Bold Rainbow chevron stripes across top and bottom borders
        const rCols = ['#e62840', '#ff8c00', '#ffd700', '#00c853', '#00b0ff', '#aa00ff'];
        for (let s = 0; s < 18; s++) {
            bx.fillStyle = rCols[s % rCols.length];
            bx.beginPath();
            bx.moveTo(s * 32, 0);
            bx.lineTo(s * 32 + 24, 0);
            bx.lineTo(s * 32 + 8, 28);
            bx.lineTo(s * 32 - 16, 28);
            bx.fill();

            bx.beginPath();
            bx.moveTo(s * 32, 228);
            bx.lineTo(s * 32 + 24, 228);
            bx.lineTo(s * 32 + 8, 256);
            bx.lineTo(s * 32 - 16, 256);
            bx.fill();
        }

        // Central "SHOW DOWN" Title with heavy 3D shadow
        bx.fillStyle = '#ff9800';
        bx.font = '900 64px "Arial Black", Impact, sans-serif';
        bx.textAlign = 'center';
        bx.fillText('SHOW DOWN', 256, 124);

        bx.fillStyle = '#ffffff';
        bx.fillText('SHOW DOWN', 256, 118);

        // Golden award star badges
        [-190, 190].forEach(sx => {
            bx.fillStyle = '#ffd700';
            bx.beginPath();
            bx.arc(256 + sx, 105, 26, 0, Math.PI * 2);
            bx.fill();
            bx.fillStyle = '#e65100';
            bx.font = 'bold 30px sans-serif';
            bx.fillText('★', 256 + sx, 115);
        });

        // "SUBWAY SURF" transit ribbon on bottom
        bx.fillStyle = '#00e5ff';
        bx.fillRect(64, 150, 384, 56);
        bx.fillStyle = '#002b4d';
        bx.font = '900 36px "Arial Black", Impact, sans-serif';
        bx.fillText('SUBWAY SURF', 256, 192);

        this.textures.billboardShowdown = this.configureTex(bbC, 1, 1, true);

        const shC = document.createElement('canvas');
        shC.width = shC.height = 64;
        const shx = shC.getContext('2d');
        const shG = shx.createRadialGradient(32, 32, 4, 32, 32, 30);
        shG.addColorStop(0, 'rgba(15, 10, 5, 0.52)');
        shG.addColorStop(1, 'rgba(15, 10, 5, 0.0)');
        shx.fillStyle = shG;
        shx.fillRect(0, 0, 64, 64);
        this.textures.contactShadow = new THREE.CanvasTexture(shC);

        // 8. MATERIALS PALETTE + REAL-TIME GPU PROCEDURAL FBM FIRE SHADERS!
        this.materials.road = new THREE.MeshStandardMaterial({
            map: this.textures.road,
            bumpMap: this.textures.roadBump,
            bumpScale: 0.075,
            color: this.srgb(0xf2e4d0),
            roughness: 0.80,
            metalness: 0.04
        });

        this.materials.soil = new THREE.MeshStandardMaterial({
            map: this.textures.soil,
            bumpMap: this.textures.soilBump,
            bumpScale: 0.12,
            roughness: 0.95,
            metalness: 0.01
        });

        this.materials.ancientCliff = new THREE.MeshStandardMaterial({
            map: this.textures.spiralCliff,
            bumpMap: this.textures.spiralCliffBump,
            bumpScale: 0.14,
            roughness: 0.88,
            metalness: 0.04
        });

        this.materials.bridge = new THREE.MeshStandardMaterial({
            map: this.textures.bridge,
            bumpMap: this.textures.bridgeBump,
            bumpScale: 0.11,
            roughness: 0.80,
            metalness: 0.03
        });

        this.materials.driftwoodPost = new THREE.MeshStandardMaterial({
            map: this.textures.driftwoodPost,
            bumpMap: this.textures.driftwoodPostBump,
            bumpScale: 0.09,
            color: this.srgb(0xc6bdb4),
            roughness: 0.86,
            metalness: 0.03
        });

        this.materials.bridgeRope = new THREE.MeshStandardMaterial({
            map: this.textures.rope,
            bumpMap: this.textures.ropeBump,
            bumpScale: 0.06,
            color: this.srgb(0xaeb4ba),
            roughness: 0.86,
            metalness: 0.02
        });

        this.materials.chasmMist = new THREE.MeshBasicMaterial({
            color: this.srgb(0x63b4f2),
            transparent: true,
            opacity: 0.62,
            depthWrite: false
        });

        this.materials.mineFloor = new THREE.MeshStandardMaterial({
            map: this.textures.mineFloor,
            bumpMap: this.textures.mineBump,
            bumpScale: 0.08,
            roughness: 0.86,
            metalness: 0.06
        });

        this.materials.wall = new THREE.MeshStandardMaterial({
            map: this.textures.masonry,
            bumpMap: this.textures.masonryBump,
            bumpScale: 0.08,
            roughness: 0.84,
            metalness: 0.04
        });

        this.materials.pillarWall = new THREE.MeshStandardMaterial({
            map: this.textures.pillarMasonry,
            bumpMap: this.textures.pillarMasonryBump,
            bumpScale: 0.08,
            roughness: 0.84,
            metalness: 0.04
        });

        this.materials.canyonCliff = new THREE.MeshStandardMaterial({
            map: this.textures.rock,
            bumpMap: this.textures.rockBump,
            bumpScale: 0.14,
            color: this.srgb(0xa89e8e),
            roughness: 0.90,
            metalness: 0.03
        });

        this.materials.parapet = new THREE.MeshStandardMaterial({
            map: this.textures.parapet,
            bumpMap: this.textures.parapetBump,
            bumpScale: 0.07,
            roughness: 0.82,
            metalness: 0.04
        });

        this.materials.glyph = new THREE.MeshStandardMaterial({
            map: this.textures.glyph,
            bumpMap: this.textures.glyphBump,
            bumpScale: 0.10,
            roughness: 0.76,
            metalness: 0.05
        });

        this.materials.statueStone = new THREE.MeshStandardMaterial({
            map: this.textures.statueLimestone,
            bumpMap: this.textures.statueLimestoneBump,
            bumpScale: 0.055,
            color: this.srgb(0xbcc6d0),
            roughness: 0.84,
            metalness: 0.02,
            envMapIntensity: 0.25
        });

        this.materials.guardianStone = new THREE.MeshStandardMaterial({
            map: this.textures.statueLimestone,
            bumpMap: this.textures.statueLimestoneBump,
            bumpScale: 0.055,
            vertexColors: true,
            color: this.srgb(0xc2ccd6),
            roughness: 0.84,
            metalness: 0.02,
            envMapIntensity: 0.25
        });

        this.materials.curb = new THREE.MeshStandardMaterial({
            map: this.textures.masonry,
            bumpMap: this.textures.masonryBump,
            bumpScale: 0.05,
            color: this.srgb(0xa4acb4),
            roughness: 0.84,
            metalness: 0.03
        });

        this.materials.hurdleBlue = new THREE.MeshStandardMaterial({
            color: this.srgb(0x284b7a),
            roughness: 0.34,
            metalness: 0.5
        });

        this.materials.hurdleCyan = new THREE.MeshStandardMaterial({
            color: this.srgb(0x4a82c4),
            roughness: 0.28,
            metalness: 0.52,
            emissive: this.srgb(0x0d2240),
            emissiveIntensity: 0.25
        });

        // Incandescent magma-cracked charcoal ember bed texture for realistic braziers & baskets!
        const emC = document.createElement('canvas');
        emC.width = emC.height = 128;
        const emx = emC.getContext('2d');
        const emG = emx.createRadialGradient(64, 64, 6, 64, 64, 64);
        emG.addColorStop(0.0, '#fff29e');
        emG.addColorStop(0.45, '#ff6e0a');
        emG.addColorStop(0.85, '#c42400');
        emG.addColorStop(1.0, '#2a0c04');
        emx.fillStyle = emG;
        emx.fillRect(0, 0, 128, 128);
        for (let c = 0; c < 36; c++) {
            const cx = 14 + this.hash2(c, 5) * 100;
            const cy = 14 + this.hash2(c, 9) * 100;
            emx.fillStyle = 'rgba(26, 12, 8, 0.72)';
            emx.beginPath();
            emx.ellipse(cx, cy, 5 + (c % 4) * 3, 4 + (c % 3) * 2.5, c, 0, Math.PI * 2);
            emx.fill();
        }
        const emberTex = new THREE.CanvasTexture(emC);
        emberTex.encoding = THREE.sRGBEncoding;
        this.materials.emberCoal = new THREE.MeshBasicMaterial({
            map: emberTex
        });

        this.materials.mahoganyBark = new THREE.MeshStandardMaterial({
            map: this.textures.mahogany,
            bumpMap: this.textures.mahoganyBump,
            bumpScale: 0.085,
            color: this.srgb(0xf2b27a),
            roughness: 0.84,
            metalness: 0.03
        });

        this.materials.obstacleWood = new THREE.MeshStandardMaterial({
            map: this.textures.darkBark,
            bumpMap: this.textures.mahoganyBump,
            bumpScale: 0.085,
            roughness: 0.84,
            metalness: 0.03
        });

        this.materials.logEnd = new THREE.MeshStandardMaterial({
            map: this.textures.logEnd,
            bumpMap: this.textures.logEndBump,
            bumpScale: 0.05,
            roughness: 0.78,
            metalness: 0.02
        });

        this.materials.rope = new THREE.MeshStandardMaterial({
            map: this.textures.rope,
            bumpMap: this.textures.ropeBump,
            bumpScale: 0.06,
            color: this.srgb(0xc89d62),
            roughness: 0.86,
            metalness: 0.02
        });

        this.materials.lianaVine = new THREE.MeshStandardMaterial({
            color: this.srgb(0x5b8f33),
            roughness: 0.72,
            metalness: 0.02
        });

        this.materials.darkIron = new THREE.MeshStandardMaterial({
            color: this.srgb(0x2e333a),
            roughness: 0.36,
            metalness: 0.74
        });

        this.materials.spikes = new THREE.MeshStandardMaterial({
            color: this.srgb(0xb8c4d0),
            roughness: 0.22,
            metalness: 0.82
        });

        this.materials.steelRail = new THREE.MeshStandardMaterial({
            color: this.srgb(0x86b8e8),
            roughness: 0.22,
            metalness: 0.75
        });

        this.materials.boulderArmor = new THREE.MeshStandardMaterial({
            map: this.textures.rock,
            bumpMap: this.textures.rockBump,
            bumpScale: 0.11,
            color: this.srgb(0x9c8470),
            roughness: 0.68,
            metalness: 0.22
        });

        this.materials.reaperCartStone = new THREE.MeshStandardMaterial({
            map: this.textures.masonry,
            bumpMap: this.textures.masonryBump,
            bumpScale: 0.08,
            color: this.srgb(0x8fa5bf),
            emissive: this.srgb(0x182434),
            emissiveIntensity: 0.24,
            roughness: 0.54,
            metalness: 0.16
        });

        this.materials.reaperCloak = new THREE.MeshStandardMaterial({
            color: this.srgb(0x12151e),
            roughness: 0.94,
            metalness: 0.03,
            side: THREE.DoubleSide
        });

        this.materials.boneSkull = new THREE.MeshStandardMaterial({
            color: this.srgb(0xf2ecdc),
            emissive: this.srgb(0x2d3238),
            emissiveIntensity: 0.32,
            roughness: 0.58,
            metalness: 0.04
        });

        this.materials.phantomGlow = new THREE.MeshBasicMaterial({
            color: 0x42ffc4
        });

        this.materials.caveRock = new THREE.MeshStandardMaterial({
            map: this.textures.rock,
            bumpMap: this.textures.rockBump,
            bumpScale: 0.14,
            color: this.srgb(0x526278),
            emissive: this.srgb(0x0b1c2e),
            emissiveIntensity: 0.28,
            roughness: 0.84,
            metalness: 0.08
        });

        this.materials.mineTimber = new THREE.MeshStandardMaterial({
            color: this.srgb(0x6b4326),
            bumpMap: this.textures.mahoganyBump,
            bumpScale: 0.06,
            roughness: 0.84,
            metalness: 0.03
        });

        this.materials.emeraldCrystal = new THREE.MeshStandardMaterial({
            color: this.srgb(0x069e54),
            emissive: this.srgb(0x0cd668),
            emissiveIntensity: 0.46,
            roughness: 0.14,
            metalness: 0.16,
            flatShading: true
        });

        this.materials.gold = new THREE.MeshStandardMaterial({
            map: this.textures.coin,
            emissive: this.srgb(0x8a5200),
            emissiveIntensity: 0.28,
            roughness: 0.26,
            metalness: 0.38
        });

        // --- SUBWAY SURFERS TRAIN, TRAM, CARGO & CHEVRON TRACK BARRIER MATERIALS ---
        this.materials.chevronBarrier = new THREE.MeshStandardMaterial({
            map: this.textures.chevronBarrier,
            bumpMap: this.textures.chevronBarrierBump,
            bumpScale: 0.08,
            roughness: 0.45,
            metalness: 0.15
        });

        this.materials.subwayBody = new THREE.MeshStandardMaterial({
            map: this.textures.subwaySide,
            roughness: 0.35,
            metalness: 0.52
        });

        this.materials.subwayRedStripe = new THREE.MeshStandardMaterial({
            color: this.srgb(0xde2028),
            roughness: 0.32,
            metalness: 0.20
        });

        this.materials.subwayRoof = new THREE.MeshStandardMaterial({
            color: this.srgb(0x242f3d),
            roughness: 0.65,
            metalness: 0.35
        });

        this.materials.subwayGlass = new THREE.MeshStandardMaterial({
            color: this.srgb(0x0c1420),
            roughness: 0.12,
            metalness: 0.90
        });

        this.materials.subwayHeadlight = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffe880,
            emissiveIntensity: 2.4,
            roughness: 0.10
        });

        this.materials.headlightBeam = new THREE.MeshBasicMaterial({
            color: 0xfff0aa,
            transparent: true,
            opacity: 0.32,
            depthWrite: false
        });

        this.materials.tramBody = new THREE.MeshStandardMaterial({
            map: this.textures.tramSide,
            roughness: 0.32,
            metalness: 0.28
        });

        this.materials.tramTeal = new THREE.MeshStandardMaterial({
            color: this.srgb(0x009e94),
            roughness: 0.35,
            metalness: 0.22
        });

        this.materials.cargoBox = new THREE.MeshStandardMaterial({
            map: this.textures.cargoCorrugated,
            bumpMap: this.textures.cargoCorrugatedBump,
            bumpScale: 0.08,
            roughness: 0.76,
            metalness: 0.12
        });

        this.materials.trainBogie = new THREE.MeshStandardMaterial({
            color: this.srgb(0x1e2228),
            roughness: 0.60,
            metalness: 0.75
        });

        this.materials.blueContainer = new THREE.MeshStandardMaterial({
            map: this.textures.blueContainer,
            bumpMap: this.textures.blueContainerBump,
            bumpScale: 0.08,
            roughness: 0.52,
            metalness: 0.35
        });

        // Subway Surfers Runner & Inspector / Bulldog Materials (Matches 9468adf5.jpg & f565e49c.jpg!)
        this.materials.subwayRunnerHoodie = new THREE.MeshStandardMaterial({
            color: this.srgb(0xf2f4f8),
            roughness: 0.75
        });
        this.materials.subwayRunnerBackpack = new THREE.MeshStandardMaterial({
            color: this.srgb(0x1a4575),
            roughness: 0.65
        });
        this.materials.subwayRunnerJeans = new THREE.MeshStandardMaterial({
            color: this.srgb(0x27538a),
            roughness: 0.85
        });
        this.materials.subwayCap = new THREE.MeshStandardMaterial({
            color: this.srgb(0xd62228),
            roughness: 0.55
        });
        this.materials.inspectorCoat = new THREE.MeshStandardMaterial({
            color: this.srgb(0x567524),
            roughness: 0.72
        });
        this.materials.inspectorCap = new THREE.MeshStandardMaterial({
            color: this.srgb(0x4a651e),
            roughness: 0.60
        });
        this.materials.inspectorPants = new THREE.MeshStandardMaterial({
            color: this.srgb(0x382414),
            roughness: 0.85
        });
        this.materials.inspectorGold = new THREE.MeshStandardMaterial({
            color: 0xffd700,
            roughness: 0.30,
            metalness: 0.80
        });
        this.materials.bulldogFur = new THREE.MeshStandardMaterial({
            color: this.srgb(0xd9be92),
            roughness: 0.80
        });

        // Subway Surfers City Skyline & Urban Streetscape Materials (Matches e6196d69.jpg & 9468adf5.jpg!)
        this.materials.cityBuildingBeige = new THREE.MeshStandardMaterial({
            color: this.srgb(0xded3c2),
            roughness: 0.72,
            metalness: 0.04
        });
        this.materials.cityBuildingBlue = new THREE.MeshStandardMaterial({
            color: this.srgb(0x4c667c),
            roughness: 0.52,
            metalness: 0.22
        });
        this.materials.cityBuildingCoral = new THREE.MeshStandardMaterial({
            color: this.srgb(0xd26848),
            roughness: 0.70,
            metalness: 0.04
        });
        this.materials.cityBuildingWhite = new THREE.MeshStandardMaterial({
            color: this.srgb(0xf2f4f8),
            roughness: 0.62,
            metalness: 0.08
        });
        this.materials.cityBuildingTeal = new THREE.MeshStandardMaterial({
            color: this.srgb(0x327885),
            roughness: 0.58,
            metalness: 0.16
        });
        this.materials.cityWindowGlass = new THREE.MeshStandardMaterial({
            map: this.textures.cityWindows,
            roughness: 0.14,
            metalness: 0.85
        });
        this.materials.cityAwning = new THREE.MeshStandardMaterial({
            color: this.srgb(0xd8383a),
            roughness: 0.55
        });
        this.materials.cityAwningBlue = new THREE.MeshStandardMaterial({
            color: this.srgb(0x1a68b5),
            roughness: 0.55
        });
        this.materials.palmTrunk = new THREE.MeshStandardMaterial({
            color: this.srgb(0x5c4632),
            roughness: 0.86
        });
        this.materials.palmFrond = new THREE.MeshStandardMaterial({
            color: this.srgb(0x288b32),
            roughness: 0.58
        });
        this.materials.sidewalkCurb = new THREE.MeshStandardMaterial({
            color: this.srgb(0xbcc4ce),
            roughness: 0.76,
            metalness: 0.05
        });
        this.materials.catenaryGantry = new THREE.MeshStandardMaterial({
            color: this.srgb(0x242b36),
            roughness: 0.45,
            metalness: 0.78
        });
        this.materials.billboardShowdown = new THREE.MeshStandardMaterial({
            map: this.textures.billboardShowdown,
            roughness: 0.35,
            metalness: 0.10
        });

        // --- REAL-TIME DOMAIN-WARPED VOLUMETRIC ROARING FIRE SHADERS (TURBULENT FLAME TONGUES + HEAT CORONA + EMBERS) ---
        const glslNoiseHeader = `
            uniform float uTime;
            varying vec2 vUv;
            varying float vSeed;

            float hash21(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }
            float vnoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash21(i);
                float b = hash21(i + vec2(1.0, 0.0));
                float c = hash21(i + vec2(0.0, 1.0));
                float d = hash21(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }
            float fbm(vec2 p) {
                float v = 0.0;
                float amp = 0.54;
                for (int i = 0; i < 5; i++) {
                    v += amp * vnoise(p);
                    p = p * 2.07 + vec2(1.73, -1.38);
                    amp *= 0.50;
                }
                return v;
            }
            vec3 thermalRamp(float h) {
                // Pure emissive combustion colors (never dark brown soot -> zero dark rim against sky or stone!)
                vec3 rubyTip   = vec3(0.96, 0.18, 0.02);
                vec3 orange    = vec3(1.00, 0.46, 0.04);
                vec3 amberGold = vec3(1.00, 0.82, 0.18);
                vec3 whiteHot  = vec3(1.00, 0.99, 0.88);
                vec3 col = mix(rubyTip, orange, smoothstep(0.08, 0.42, h));
                col = mix(col, amberGold, smoothstep(0.40, 0.74, h));
                col = mix(col, whiteHot, smoothstep(0.72, 1.02, h));
                return col;
            }
        `;

        // Premultiplied Emissive-Additive Blending (One, OneMinusSrcAlpha):
        // Solid incandescent white-gold core + pure additive golden-orange light aura around every flame!
        this.materials.fireSprite = new THREE.ShaderMaterial({
            uniforms: this.fireUniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            side: THREE.DoubleSide,
            toneMapped: false,
            vertexShader: `
                uniform float uTime;
                varying vec2 vUv;
                varying float vSeed;
                void main() {
                    vUv = uv;
                    vec4 wOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    vSeed = wOrigin.x * 3.17 + wOrigin.y * 1.91 + floor(wOrigin.z * 0.5) * 0.73;
                    vec3 pos = position;
                    float gust = sin(uTime * 7.6 + vSeed * 2.9 + uv.y * 5.8) * 0.125 * uv.y * uv.y
                               + cos(uTime * 13.4 + vSeed * 1.7 + uv.y * 9.0) * 0.04 * uv.y;
                    pos.x += gust;
                    pos.z += cos(uTime * 6.8 + vSeed * 2.1 + uv.y * 4.5) * 0.06 * uv.y * uv.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: glslNoiseHeader + `
                void main() {
                    float sx = (vUv.x - 0.5) * 2.0;
                    float dx = abs(sx);

                    vec2 baseUv = vec2(vUv.x * 2.9 + vSeed, vUv.y * 2.5 - uTime * 3.8);
                    float warp = fbm(baseUv * 1.35 + vec2(0.0, -uTime * 1.6)) - 0.5;
                    vec2 warpedUv = baseUv + vec2(warp * (0.48 + vUv.y * 0.78), warp * 0.36);
                    float n1 = fbm(warpedUv);
                    float n2 = fbm(warpedUv * 2.35 - vec2(vSeed * 1.3, uTime * 3.1));
                    float tongues = fbm(vec2(sx * 2.7 + vSeed, vUv.y * 3.3 - uTime * 4.7));
                    float turb = n1 * 0.50 + n2 * 0.30 + tongues * 0.20;

                    float widthCurve = mix(0.96, 0.16, pow(vUv.y, 0.82));
                    float edgeDist = dx + (turb - 0.50) * (0.44 + vUv.y * 1.28);
                    float maskX = 1.0 - smoothstep(widthCurve * 0.14, widthCurve + 0.32, edgeDist);
                    float maskY = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.46, 0.99, vUv.y + (turb - 0.48) * 0.58));

                    float coreBoost = pow(max(0.0, 1.0 - vUv.y * 0.78), 1.25) * pow(max(0.0, 1.0 - dx * 0.92), 1.3);
                    float heat = clamp(maskX * maskY * (0.78 + turb * 0.80) + coreBoost * maskX * 0.52, 0.0, 1.15);

                    // Soft additive golden-orange heat bloom illuminating the air around the fire!
                    float bloom = exp(-dx * dx * 2.1) * pow(max(0.0, 1.0 - vUv.y * 0.90), 1.3) * smoothstep(0.0, 0.06, vUv.y) * 0.36;

                    vec2 sp = vec2(vUv.x * 9.0 + sin(uTime * 3.1 + vUv.y * 8.0 + vSeed) * 0.45, vUv.y * 11.0 - uTime * 5.8 + vSeed * 2.0);
                    vec2 spId = floor(sp);
                    vec2 spUv = fract(sp) - 0.5;
                    float spRnd = hash21(spId);
                    float spark = (spRnd > 0.86 && dx < 0.84 && vUv.y > 0.16 && vUv.y < 0.97)
                        ? smoothstep(0.22, 0.025, length(spUv)) * (1.0 - vUv.y * 0.40)
                        : 0.0;

                    float flameAlpha = clamp(smoothstep(0.07, 0.30, heat) * 0.92, 0.0, 0.92);
                    vec3 premulCol = thermalRamp(heat) * flameAlpha
                                   + vec3(1.0, 0.44, 0.07) * bloom
                                   + vec3(1.0, 0.88, 0.38) * spark * 1.25;
                    if (flameAlpha + bloom + spark < 0.012) discard;
                    gl_FragColor = vec4(premulCol, flameAlpha);
                }
            `
        });

        // --- REAL-TIME CONTINUOUS HORIZONTAL GARGOYLE FLAMETHROWER SHADER ---
        this.materials.fireJetShader = new THREE.ShaderMaterial({
            uniforms: this.fireUniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            side: THREE.DoubleSide,
            toneMapped: false,
            vertexShader: `
                uniform float uTime;
                varying vec2 vUv;
                varying float vSeed;
                void main() {
                    vUv = uv;
                    vSeed = 4.2;
                    vec3 pos = position;
                    pos.y += sin(uTime * 11.0 - uv.x * 8.5) * 0.09 * uv.x;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: glslNoiseHeader + `
                void main() {
                    float dy = abs(vUv.y - 0.5) * 2.0;
                    vec2 flowUv = vec2(vUv.x * 4.2 - uTime * 5.6, vUv.y * 3.0 + sin(vUv.x * 6.0 - uTime * 7.0) * 0.18);
                    float turb = fbm(flowUv) * 0.65 + fbm(flowUv * 2.3 - vec2(uTime * 3.0, 0.0)) * 0.35;

                    float jetRadius = mix(0.36, 0.88, smoothstep(0.0, 0.55, vUv.x)) * (1.0 - smoothstep(0.80, 1.0, vUv.x) * 0.65);
                    float edge = dy + (turb - 0.48) * (0.25 + vUv.x * 0.72);
                    float maskY = 1.0 - smoothstep(jetRadius * 0.22, jetRadius + 0.28, edge);
                    float maskX = smoothstep(0.0, 0.04, vUv.x) * (1.0 - smoothstep(0.76, 0.99, vUv.x + (turb - 0.5) * 0.28));

                    float nozzleCore = (1.0 - smoothstep(0.0, 0.55, vUv.x)) * (1.0 - dy * 0.9) * 0.48;
                    float heat = clamp(maskY * maskX * (0.78 + turb * 0.68) + nozzleCore * maskY, 0.0, 1.15);
                    float bloom = exp(-dy * dy * 2.8) * maskX * 0.28;

                    vec2 sp = vec2(vUv.x * 12.0 - uTime * 8.5, vUv.y * 7.0);
                    float spRnd = hash21(floor(sp));
                    float spark = (spRnd > 0.89 && dy < 0.78 && vUv.x > 0.15 && vUv.x < 0.97)
                        ? smoothstep(0.20, 0.03, length(fract(sp) - 0.5))
                        : 0.0;

                    float flameAlpha = clamp(smoothstep(0.07, 0.28, heat) * 0.92, 0.0, 0.92);
                    vec3 premulCol = thermalRamp(heat) * flameAlpha
                                   + vec3(1.0, 0.44, 0.07) * bloom
                                   + vec3(1.0, 0.86, 0.38) * spark * 1.2;
                    if (flameAlpha + bloom + spark < 0.012) discard;
                    gl_FragColor = vec4(premulCol, flameAlpha);
                }
            `
        });

        this.materials.contactShadow = new THREE.MeshBasicMaterial({
            map: this.textures.contactShadow,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1
        });

        // VELVETY MATTE RAINFOREST LEAF MATERIALS (envMapIntensity: 0.10 + roughness: 0.88 -> ZERO chalky white specular glare!)
        // Three subtly different natural leaf tints (olive, deep green, sun-warmed) so neighbouring trees never match
        this.materials.leaves1 = new THREE.MeshStandardMaterial({
            map: this.textures.leafBough,
            alphaTest: 0.36,
            vertexColors: true,
            side: THREE.DoubleSide,
            color: this.srgb(0xf0f0e2),
            emissive: this.srgb(0x0e1e0a),
            emissiveIntensity: 0.16,
            roughness: 0.82,
            metalness: 0.0,
            envMapIntensity: 0.14
        });
        this.materials.leaves2 = new THREE.MeshStandardMaterial({
            map: this.textures.leafBough,
            alphaTest: 0.36,
            vertexColors: true,
            side: THREE.DoubleSide,
            color: this.srgb(0xdfe6d6),
            emissive: this.srgb(0x0b1c0a),
            emissiveIntensity: 0.16,
            roughness: 0.84,
            metalness: 0.0,
            envMapIntensity: 0.14
        });
        this.materials.leaves3 = new THREE.MeshStandardMaterial({
            map: this.textures.leafBough,
            alphaTest: 0.36,
            vertexColors: true,
            side: THREE.DoubleSide,
            color: this.srgb(0xfaf2d4),
            emissive: this.srgb(0x14200a),
            emissiveIntensity: 0.16,
            roughness: 0.80,
            metalness: 0.0,
            envMapIntensity: 0.14
        });
        this.materials.canopyCore = new THREE.MeshStandardMaterial({
            map: this.textures.foliage,
            color: this.srgb(0x2a3d22),
            emissive: this.srgb(0x051607),
            emissiveIntensity: 0.12,
            roughness: 0.94,
            metalness: 0.0,
            envMapIntensity: 0.08
        });
        this.materials.fern = new THREE.MeshStandardMaterial({
            map: this.textures.fernFrond,
            alphaTest: 0.35,
            emissive: this.srgb(0x0e3612),
            emissiveIntensity: 0.26,
            roughness: 0.86,
            metalness: 0.0,
            envMapIntensity: 0.10,
            side: THREE.DoubleSide
        });
        this.materials.vines = new THREE.MeshStandardMaterial({
            map: this.textures.hangingVines,
            alphaTest: 0.35,
            emissive: this.srgb(0x0d2e10),
            emissiveIntensity: 0.22,
            roughness: 0.88,
            metalness: 0.0,
            envMapIntensity: 0.10,
            side: THREE.DoubleSide
        });
        this.materials.cliffJungle = new THREE.MeshStandardMaterial({
            map: this.textures.foliage,
            bumpMap: this.textures.foliageBump,
            bumpScale: 0.075,
            color: this.srgb(0x466b3a),
            roughness: 0.92
        });
        this.materials.voidBlack = new THREE.MeshBasicMaterial({
            color: 0x050908,
            polygonOffset: true,
            polygonOffsetFactor: -2
        });

        // Living foliage: gentle wind sway, leaf flutter & sunlit back-scatter translucency
        this.applyFoliageWind(this.materials.leaves1, 1.0);
        this.applyFoliageWind(this.materials.leaves2, 1.0);
        this.applyFoliageWind(this.materials.leaves3, 1.0);
        this.applyFoliageWind(this.materials.fern, 0.7);
        this.applyFoliageWind(this.materials.vines, 0.8);
    }

    applyFoliageWind(mat, strength = 1.0) {
        const uStrength = { value: strength };
        mat.userData.windStrength = uStrength;
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.fireUniforms.uTime;
            shader.uniforms.uWindStrength = uStrength;
            shader.vertexShader = 'uniform float uTime;\nuniform float uWindStrength;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                {
                    // Phase from object-local position (stable while chunks scroll past the camera)
                    float wPh = transformed.x * 0.31 + transformed.z * 0.23;
                    float wT = mod(uTime, 628.3185);
                    float hgt = clamp(transformed.y * 0.11, 0.18, 1.25);
                    float sway = sin(wT * 1.35 + wPh) * 0.62 + sin(wT * 2.9 + wPh * 1.7) * 0.28;
                    float gust = 0.6 + 0.4 * sin(wT * 0.37 + wPh * 0.2);
                    float flutter = sin(wT * 8.5 + transformed.y * 3.7 + transformed.x * 2.9) * 0.5
                                  + sin(wT * 12.3 + transformed.z * 4.1) * 0.3;
                    transformed.x += (sway * 0.11 * gust + flutter * 0.022) * hgt * uWindStrength;
                    transformed.z += (cos(wT * 1.1 + wPh) * 0.07 * gust + flutter * 0.018) * hgt * uWindStrength;
                    transformed.y += flutter * 0.015 * hgt * uWindStrength;
                }`
            );
            // Thin-leaf translucency: back-faces / grazing leaves glow warm yellow-green when the sun shines through
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_end>',
                `#include <lights_fragment_end>
                {
                    float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
                    vec3 transCol = diffuseColor.rgb * vec3(1.05, 1.15, 0.55);
                    reflectedLight.indirectDiffuse += transCol * (0.10 + rim * 0.22);
                }`
            );
        };
        mat.customProgramCacheKey = () => 'foliageWind_v1';
        mat.needsUpdate = true;
    }

    // Helper: Builds volumetric 3D cupped leaf-bough card clusters with smooth sunlit spherical normals!
    buildBotanicalBoughGeo(boughSpecs, cardsPerBough = 13, cardScale = 1.18) {
        const cards = [];
        const up = new THREE.Vector3(0, 1, 0);
        const altUp = new THREE.Vector3(0, 0, 1);
        const rotMat = new THREE.Matrix4();
        const rollMat = new THREE.Matrix4();
        const fullMat = new THREE.Matrix4();

        boughSpecs.forEach(([cx, cy, cz, cr], sIdx) => {
            const center = new THREE.Vector3(cx, cy - cr * 0.12, cz);
            const shadeOrigin = new THREE.Vector3(cx, cy - cr * 0.55, cz);

            for (let i = 0; i < cardsPerBough; i++) {
                const u = (i + 0.5) / cardsPerBough;
                const ny = -0.30 + u * 0.96;
                const rHoriz = Math.sqrt(Math.max(0.14, 1.0 - ny * ny * 0.76));
                const phi = i * 2.399963 + sIdx * 1.17;
                const shell = cr * (0.56 + (i % 3) * 0.15);

                const pos = new THREE.Vector3(
                    cx + Math.cos(phi) * rHoriz * shell * 1.16,
                    cy + ny * shell * 0.74,
                    cz + Math.sin(phi) * rHoriz * shell * 1.08
                );

                const w = cr * cardScale;
                const h = cr * cardScale * 0.94;
                const g = new THREE.PlaneGeometry(w, h, 2, 2);
                const gp = g.attributes.position;

                // Gently cup each leaf-bough card so it wraps organically like real foliage!
                for (let v = 0; v < gp.count; v++) {
                    const vx = gp.getX(v) / (w * 0.5);
                    const vy = gp.getY(v) / (h * 0.5);
                    gp.setZ(v, -(vx * vx + vy * vy) * cr * 0.16);
                }

                const dir = pos.clone().sub(center).normalize();
                rotMat.lookAt(pos, center, Math.abs(dir.y) > 0.92 ? altUp : up);
                rollMat.makeRotationZ(((i * 1.73 + sIdx * 0.85) % 1.0 - 0.5) * 1.35);

                fullMat.identity();
                fullMat.makeTranslation(pos.x, pos.y, pos.z);
                fullMat.multiply(rotMat);
                fullMat.multiply(rollMat);
                g.applyMatrix4(fullMat);

                // Smooth outward spherical dome normals + per-vertex canopy ambient occlusion & sunlit crown warmth!
                const normAttr = g.attributes.normal;
                const colBuf = new Float32Array(gp.count * 3);
                const shellRatio = (shell / cr - 0.50) / 0.45;
                // Per-card natural hue drift: some boughs bluer/deeper, some warmer/yellower, some darker
                const hv1 = this.hash2(i * 3.7 + sIdx * 11.1, cx * 0.37 + cz);
                const hv2 = this.hash2(i * 5.3 + sIdx * 7.9, cy * 0.53 - cz);
                const tintR = 0.86 + hv1 * 0.26;
                const tintG = 0.92 + hv2 * 0.12;
                const tintB = 0.80 + (1 - hv1) * 0.22;
                const tintL = 0.84 + hv2 * 0.24;
                for (let v = 0; v < gp.count; v++) {
                    const nx = gp.getX(v) - shadeOrigin.x;
                    const nyN = (gp.getY(v) - shadeOrigin.y) * 1.15;
                    const nz = gp.getZ(v) - shadeOrigin.z;
                    const len = Math.hypot(nx, nyN, nz) || 1;
                    const uny = nyN / len;
                    normAttr.setXYZ(v, nx / len, uny, nz / len);

                    // Deep lush rainforest shadow underneath & inside; warm golden-lime sunlight on upper outer boughs!
                    const ao = Math.min(1.12, Math.max(0.30, 0.40 + uny * 0.48 + shellRatio * 0.24));
                    const sunWarm = Math.max(0.0, uny) * 0.12;
                    colBuf[v * 3]     = (ao + sunWarm * 1.05) * tintR * tintL;
                    colBuf[v * 3 + 1] = (ao + sunWarm * 0.65) * tintG * tintL;
                    colBuf[v * 3 + 2] = ao * 0.84 * tintB * tintL;
                }
                g.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
                cards.push(g);
            }
        });
        return this.mergeGeos(cards);
    }

    // ============================================================
    // PRE-MERGED SHARED GEOMETRIES (MASSIVE DRAW-CALL REDUCTION)
    // ============================================================
    createSharedGeometries() {
        // 1A. Subdivided 4-plane volumetric flame plume for full 360-degree roaring fire depth (1 draw call!)
        const f1 = new THREE.PlaneGeometry(1.62, 2.32, 5, 10);
        f1.translate(0, 1.08, 0);
        const f2 = f1.clone();
        this.transformGeo(f2, 0, 0, 0, 0, Math.PI * 0.25, 0, 0.94, 1.04, 0.94);
        const f3 = f1.clone();
        this.transformGeo(f3, 0, 0, 0, 0, -Math.PI * 0.25, 0, 0.92, 0.98, 0.92);
        const f4 = f1.clone();
        this.transformGeo(f4, 0, 0, 0, 0, Math.PI * 0.5, 0, 0.86, 0.94, 0.86);
        this.sharedGeo.flameMerged = this.mergeGeos([f1, f2, f3, f4]);

        // 1B. Seamless continuous horizontal Gargoyle Flamethrower jet (x = 0 .. 7.9, 1 draw call!)
        const j1 = new THREE.PlaneGeometry(7.9, 1.78, 18, 4);
        j1.translate(7.9 * 0.5, 0, 0);
        const j2 = j1.clone();
        this.transformGeo(j2, 0, 0, 0, 0.62, 0, 0);
        const j3 = j1.clone();
        this.transformGeo(j3, 0, 0, 0, -0.62, 0, 0);
        this.sharedGeo.flameJetMerged = this.mergeGeos([j1, j2, j3]);

        // 2. High-quality beveled Aztec sun-medallion gold coin (20-sided rim + raised bezel + sun stud, 1 draw call!)
        const coinCyl = new THREE.CylinderGeometry(0.44, 0.44, 0.085, 20);
        this.transformGeo(coinCyl, 0, 0, 0, Math.PI / 2, 0, 0);
        const coinRim = new THREE.TorusGeometry(0.41, 0.045, 8, 20);
        const coinStud = new THREE.CylinderGeometry(0.16, 0.19, 0.125, 8);
        this.transformGeo(coinStud, 0, 0, 0, Math.PI / 2, Math.PI / 8, 0);
        this.sharedGeo.coinMerged = this.mergeGeos([coinCyl, coinRim, coinStud]);

        const shPlane = new THREE.PlaneGeometry(1, 1);
        shPlane.rotateX(-Math.PI / 2);
        this.sharedGeo.shadowQuad = shPlane;

        // 3A. Realistic 13-frond pinnate tropical fern / palm rosette (wide unclipped leaflets!)
        const baseBlade = new THREE.PlaneGeometry(1.06, 2.45, 1, 6);
        const bPos = baseBlade.attributes.position;
        for (let i = 0; i < bPos.count; i++) {
            const rawY = Math.max(0, bPos.getY(i) + 1.225);
            const t = Math.min(1, rawY / 2.45);
            bPos.setY(i, t * 1.72 - t * t * 0.36);
            bPos.setZ(i, -Math.pow(t, 1.38) * 1.42);
        }
        baseBlade.computeVertexNormals();
        const frondList = [];
        for (let b = 0; b < 13; b++) {
            const fr = baseBlade.clone();
            const isInner = (b % 2 === 1);
            const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (b / 13) * Math.PI * 2);
            const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), isInner ? -0.18 : -0.46);
            const sc = isInner ? 0.84 : 1.0;
            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(0, 0, 0),
                qY.multiply(qX),
                new THREE.Vector3(sc, sc, sc)
            );
            fr.applyMatrix4(m);
            frondList.push(fr);
        }
        baseBlade.dispose();
        this.sharedGeo.fernRosette = this.mergeGeos(frondList);

        // Helper: Applies clean world-scale planar/box UVs so sculpted mounds, cliffs & stone faces never stretch!
        const applyWorldUVs = (geo, scale = 0.22, mode = 'xz') => {
            const pos = geo.attributes.position;
            const norm = geo.attributes.normal;
            let uv = geo.attributes.uv;
            if (!uv) {
                uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
                geo.setAttribute('uv', uv);
            }
            for (let i = 0; i < pos.count; i++) {
                const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
                if (mode === 'xz') {
                    uv.setXY(i, vx * scale + 0.5, vz * scale + 0.5);
                } else if (mode === 'zy') {
                    uv.setXY(i, vz * scale + 0.5, vy * scale);
                } else {
                    const nx = norm ? Math.abs(norm.getX(i)) : 0;
                    const nz = norm ? Math.abs(norm.getZ(i)) : 1;
                    const uCoord = (nx > nz ? vz : vx) * scale + 0.5;
                    uv.setXY(i, uCoord, vy * scale);
                }
            }
            return geo;
        };

        // 3B. Realistic botanical roadside tropical shrub mound (replaces polygonal Icosahedron bushes!)
        this.sharedGeo.shrubCluster = this.buildBotanicalBoughGeo([[0, 0.95, 0, 1.85]], 12, 1.25);

        // 3C. Sculpted Tropical Forest Soil Mound + Mossy Retaining Stones under every Mahogany Tree!
        const moundGeo = new THREE.CylinderGeometry(1.18, 2.92, 1.32, 16, 3);
        const mp = moundGeo.attributes.position;
        for (let i = 0; i < mp.count; i++) {
            let vx = mp.getX(i), vy = mp.getY(i), vz = mp.getZ(i);
            const r = Math.hypot(vx, vz);
            const ang = Math.atan2(vz, vx);
            // Organic root-ridge & clod undulation + dome crown around the trunk base
            const dome = Math.max(0, 1.0 - r / 3.05) * 0.44;
            const ridge = (Math.sin(ang * 5.0 + 0.4) * 0.14 + Math.cos(ang * 3.0 - 0.7) * 0.10) * Math.min(1.0, r * 0.42);
            const radialWarp = 1.0 + 0.09 * Math.sin(ang * 4.0 + vy * 1.5) + 0.05 * Math.cos(ang * 7.0);
            vx *= radialWarp;
            vz *= radialWarp;
            vy = vy * 0.78 + 0.12 + dome + ridge * (vy > -0.3 ? 1.0 : 0.25);
            mp.setXYZ(i, vx, vy, vz);
        }
        moundGeo.computeVertexNormals();
        applyWorldUVs(moundGeo, 0.34, 'xz');
        this.sharedGeo.treeSoilMound = moundGeo;

        const soilStoneParts = [];
        for (let s = 0; s < 8; s++) {
            const ang = (s / 8) * Math.PI * 2 + (s % 2) * 0.18;
            const rad = 1.85 + (s % 3) * 0.36;
            const sg = new THREE.DodecahedronGeometry(0.42 + (s % 2) * 0.14, 0);
            applyWorldUVs(sg, 0.38, 'box');
            soilStoneParts.push(this.transformGeo(
                sg,
                Math.cos(ang) * rad, 0.08 + (s % 2) * 0.08, Math.sin(ang) * rad,
                s * 0.4, ang, s * 0.25,
                1.25, 0.68, 1.08
            ));
        }
        this.sharedGeo.treeSoilStones = this.mergeGeos(soilStoneParts);

        // 4. Sculpted Organic Tapered Rainforest Mahogany Tree (flared trunk -> forked limbs -> sub-boughs + 5 roots!)
        const makeTaperedBranch = (curve, tSegs, rSegs, rStart, rEnd) => {
            const g = new THREE.TubeGeometry(curve, tSegs, 1.0, rSegs, false);
            const pos = g.attributes.position;
            const ring = rSegs + 1;
            const pt = new THREE.Vector3();
            for (let i = 0; i <= tSegs; i++) {
                const u = i / tSegs;
                curve.getPointAt(u, pt);
                const flare = u < 0.22 ? Math.pow((0.22 - u) / 0.22, 1.7) * rStart * 0.36 : 0.0;
                const rad = rStart * (1.0 - u) + rEnd * u + flare;
                for (let j = 0; j < ring; j++) {
                    const idx = i * ring + j;
                    const ang = (j / rSegs) * Math.PI * 2;
                    const flute = 1.0 + Math.sin(ang * 5.0 + u * 4.5) * (0.09 * (1.0 - u * 0.6));
                    pos.setXYZ(
                        idx,
                        pt.x + (pos.getX(idx) - pt.x) * rad * flute,
                        pt.y + (pos.getY(idx) - pt.y) * rad,
                        pt.z + (pos.getZ(idx) - pt.z) * rad * flute
                    );
                }
            }
            g.computeVertexNormals();
            return g;
        };

        [-1, 1].forEach((side) => {
            const key = side < 0 ? 'Left' : 'Right';
            const trunkCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, -0.38, 0),
                new THREE.Vector3(-side * 0.08, 1.15, 0.04),
                new THREE.Vector3(-side * 0.36, 3.45, 0.12),
                new THREE.Vector3(-side * 0.98, 6.45, -0.04),
                new THREE.Vector3(-side * 2.25, 9.45, -0.14)
            ]);
            const reachCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-side * 0.82, 5.75, 0.02),
                new THREE.Vector3(-side * 2.65, 8.15, 0.24),
                new THREE.Vector3(-side * 4.65, 9.85, 0.05)
            ]);
            const outerCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-side * 0.55, 5.35, 0.08),
                new THREE.Vector3(side * 0.95, 7.85, 0.52),
                new THREE.Vector3(side * 2.15, 9.85, 0.72)
            ]);
            const crownFork = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-side * 1.15, 6.85, -0.05),
                new THREE.Vector3(-side * 1.45, 9.15, -0.65),
                new THREE.Vector3(-side * 1.65, 11.15, -0.35)
            ]);
            const backLimb = new THREE.CatmullRomCurve3([
                new THREE.Vector3(-side * 0.72, 6.10, 0.05),
                new THREE.Vector3(-side * 0.45, 8.45, -1.15),
                new THREE.Vector3(-side * 0.25, 10.25, -1.55)
            ]);
            const woodParts = [
                makeTaperedBranch(trunkCurve, 14, 12, 0.94, 0.34),
                makeTaperedBranch(reachCurve, 9, 9, 0.48, 0.19),
                makeTaperedBranch(outerCurve, 9, 9, 0.43, 0.17),
                makeTaperedBranch(crownFork, 8, 8, 0.37, 0.16),
                makeTaperedBranch(backLimb, 8, 8, 0.33, 0.14)
            ];
            // 5 thick flaring buttress roots gripping visibly down into the dark soil mound!
            const rootAngles = [
                Math.PI * (side > 0 ? 1.0 : 0.0),
                Math.PI * (side > 0 ? 0.72 : 0.28),
                Math.PI * (side > 0 ? 1.28 : -0.28),
                Math.PI * 0.48,
                -Math.PI * 0.48
            ];
            rootAngles.forEach((ra, rIdx) => {
                const dirX = Math.cos(ra);
                const dirZ = Math.sin(ra);
                const reach = 2.02 + (rIdx % 2) * 0.44;
                const rootCurve = new THREE.CatmullRomCurve3([
                    new THREE.Vector3(dirX * 0.18, 2.15 - (rIdx % 2) * 0.22, dirZ * 0.18),
                    new THREE.Vector3(dirX * (reach * 0.56), 0.74, dirZ * (reach * 0.56)),
                    new THREE.Vector3(dirX * reach, -0.28, dirZ * reach)
                ]);
                woodParts.push(makeTaperedBranch(rootCurve, 7, 7, 0.40 - (rIdx % 2) * 0.05, 0.12));
            });
            this.sharedGeo['treeWood' + key] = this.mergeGeos(woodParts);

            // Multi-tiered horizontal rainforest bough pads so mahogany limbs peek naturally between sunlit leaf tiers!
            // Big rounded cartoon leaf clumps
            const canopySpecs = [
                [-side * 4.85, 9.85, 0.10, 2.75],
                [-side * 2.85, 10.75, 0.60, 3.05],
                [-side * 0.20, 11.05, -0.50, 3.15],
                [side * 2.35, 9.95, 0.78, 2.75],
                [-side * 1.75, 12.25, 0.10, 3.00],
                [-side * 3.75, 9.05, -0.85, 2.35],
                [side * 0.85, 9.25, -1.25, 2.45]
            ];
            const coreParts = canopySpecs.map(([cx, cy, cz, cr]) =>
                this.transformGeo(new THREE.IcosahedronGeometry(cr * 0.46, 1), cx, cy, cz, 0, 0, 0, 1.16, 0.60, 1.06)
            );
            this.sharedGeo['treeCore' + key] = this.mergeGeos(coreParts);
            this.sharedGeo['treeCanopy' + key] = this.buildBotanicalBoughGeo(canopySpecs, 16, 1.30);
        });

        // 5. High-Quality Beveled Semicircular Stone Aqueduct Arches + Keystone + Hanging Jungle Vines
        const makeMergedArch = (span, pierH, radius) => {
            const parts = [];
            [-1, 1].forEach((s) => {
                const px = s * span * 0.5;
                parts.push(this.transformGeo(new THREE.BoxGeometry(1.96, 0.46, 1.96), px, 0.23, 0));
                parts.push(this.transformGeo(new THREE.BoxGeometry(1.58, pierH, 1.58), px, pierH * 0.5, 0));
                parts.push(this.transformGeo(new THREE.BoxGeometry(1.98, 0.42, 1.98), px, pierH + 0.14, 0));
                parts.push(this.transformGeo(new THREE.BoxGeometry(1.76, 0.24, 1.76), px, pierH - 0.14, 0));
            });
            const segs = 15;
            for (let i = 0; i < segs; i++) {
                const a = Math.PI * (i + 0.5) / segs;
                const vx = Math.cos(a) * (span * 0.5);
                const vy = pierH + Math.sin(a) * radius;
                const isKey = (i === 7);
                parts.push(this.transformGeo(
                    new THREE.BoxGeometry(isKey ? 1.08 : 0.98, isKey ? 1.32 : 1.10, isKey ? 1.68 : 1.54),
                    vx, vy, 0, 0, 0, a - Math.PI * 0.5
                ));
            }
            return this.mergeGeos(parts);
        };
        const roadWidth = this.laneWidth * 3 + 1.5;
        this.sharedGeo.sideArch = makeMergedArch(8.2, 5.4, 3.8);
        this.sharedGeo.overArch = makeMergedArch(roadWidth + 1.8, 6.2, 3.4);

        const makeVineCurtain = (width, height, repeatX) => {
            const vg = new THREE.PlaneGeometry(width, height);
            const uvs = vg.attributes.uv;
            for (let i = 0; i < uvs.count; i++) {
                uvs.setX(i, uvs.getX(i) * repeatX);
            }
            return vg;
        };
        this.sharedGeo.archVines = this.mergeGeos([
            this.transformGeo(makeVineCurtain(roadWidth * 0.85, 2.3, 3.5), 0, 7.6, 0.55),
            this.transformGeo(makeVineCurtain(roadWidth * 0.85, 2.1, 3.5), 0, 7.6, -0.55)
        ]);
        this.sharedGeo.cliffVines = this.mergeGeos([
            this.transformGeo(makeVineCurtain(9.5, 3.6, 4.0), 0, 0, 0)
        ]);

        // 6. Colossal 15.5m Serene Ancient Bayon / Mayan Cliff-Carved Stone Visage (matching TikTok video 00:00 & 00:11!)
        const makeCraggyRock = (rad, detail, sx, sy, sz, ox, oy, oz, seed = 1) => {
            const rg = new THREE.DodecahedronGeometry(rad, detail);
            const rp = rg.attributes.position;
            for (let i = 0; i < rp.count; i++) {
                const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
                const w = 0.90 + 0.16 * Math.sin(x * 0.85 + seed) * Math.cos(y * 0.72 - z * 0.65);
                rp.setXYZ(i, x * w, y * w, z * w);
            }
            rg.computeVertexNormals();
            return this.transformGeo(rg, ox, oy, oz, 0, 0, 0, sx, sy, sz);
        };

        // Chiseled ancient Bayon / Mayan temple guardian head (angular planes, brow overhang, cheekbones & jaw!)
        const headOval = new THREE.SphereGeometry(3.52, 24, 18);
        const hp = headOval.attributes.position;
        for (let i = 0; i < hp.count; i++) {
            let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
            const ny = y / 3.52;
            const jawTaper = ny < 0 ? (1.0 + ny * 0.28) : (1.0 - ny * 0.05);
            const cheek = Math.exp(-Math.pow(ny - 0.04, 2) * 7.0) * 0.16;
            const socketCarve = (z > 1.2 && Math.abs(Math.abs(x) - 1.38) < 1.05 && Math.abs(ny - 0.18) < 0.22) ? -0.42 : 0.0;
            x *= (0.90 * jawTaper + cheek);
            y *= 1.30;
            z = z * (z > 0 ? 0.85 : 0.70) + socketCarve;
            hp.setXYZ(i, x, y + 7.25, z + 1.55);
        }
        headOval.computeVertexNormals();

        const faceParts = [
            // Craggy slate cliff monolith framing the carved stone face so it emerges from living rock
            makeCraggyRock(5.8, 1, 1.08, 1.48, 0.88, 0, 7.6, -1.45, 1.2),
            makeCraggyRock(4.2, 1, 1.0, 1.32, 0.85, -3.6, 5.4, -0.6, 2.7),
            makeCraggyRock(4.2, 1, 1.0, 1.32, 0.85, 3.6, 5.4, -0.6, 4.1),
            // Chiseled neck / stepped stone collar base
            this.transformGeo(new THREE.CylinderGeometry(2.35, 3.15, 3.6, 14), 0, 1.9, 1.20),
            headOval,
            // Heavy chiseled overhanging Mayan brow ridges + glabella keystone
            this.transformGeo(new THREE.BoxGeometry(2.55, 0.58, 1.15), -1.42, 8.70, 3.92, 0.06, 0.15, 0.11),
            this.transformGeo(new THREE.BoxGeometry(2.55, 0.58, 1.15), 1.42, 8.70, 3.92, 0.06, -0.15, -0.11),
            this.transformGeo(new THREE.BoxGeometry(1.15, 0.68, 1.18), 0, 8.58, 4.10),
            // Sculpted half-closed serene stone eyelids & eyeballs
            this.transformGeo(new THREE.SphereGeometry(0.94, 14, 10), -1.42, 7.98, 3.98, 0.18, 0.15, 0.05, 1.24, 0.48, 0.56),
            this.transformGeo(new THREE.SphereGeometry(0.94, 14, 10), 1.42, 7.98, 3.98, 0.18, -0.15, -0.05, 1.24, 0.48, 0.56),
            this.transformGeo(new THREE.SphereGeometry(0.86, 12, 8), -1.42, 7.54, 3.92, 0, 0.15, 0, 1.18, 0.25, 0.46),
            this.transformGeo(new THREE.SphereGeometry(0.86, 12, 8), 1.42, 7.54, 3.92, 0, -0.15, 0, 1.18, 0.25, 0.46),
            // Chiseled trapezoidal Mayan nose bridge, tip & flared nostrils
            this.transformGeo(new THREE.CylinderGeometry(0.42, 0.78, 2.32, 6), 0, 7.24, 4.44, -0.22, Math.PI / 6, 0, 0.96, 1.0, 0.94),
            this.transformGeo(new THREE.SphereGeometry(0.66, 12, 10), 0, 6.18, 4.82, 0, 0, 0, 1.08, 0.84, 0.92),
            this.transformGeo(new THREE.SphereGeometry(0.45, 10, 8), -0.58, 6.12, 4.54, 0, 0, 0, 1.08, 0.78, 0.86),
            this.transformGeo(new THREE.SphereGeometry(0.45, 10, 8), 0.58, 6.12, 4.54, 0, 0, 0, 1.08, 0.78, 0.86),
            // Chiseled full stone lips & square-tapered chin block
            this.transformGeo(new THREE.SphereGeometry(1.12, 14, 10), 0, 5.30, 4.34, 0.1, 0, 0, 1.42, 0.34, 0.60),
            this.transformGeo(new THREE.SphereGeometry(1.05, 14, 10), 0, 4.80, 4.28, -0.1, 0, 0, 1.28, 0.36, 0.58),
            this.transformGeo(new THREE.BoxGeometry(2.15, 1.25, 1.35), 0, 3.90, 3.68, -0.08, 0, 0),
            // Elongated carved ancient stone ears
            this.transformGeo(new THREE.BoxGeometry(0.88, 3.85, 1.45), -3.38, 6.85, 1.55, 0, 0, 0.08),
            this.transformGeo(new THREE.BoxGeometry(0.88, 3.85, 1.45), 3.38, 6.85, 1.55, 0, 0, -0.08)
        ];
        const mergedGuardianFace = this.mergeGeos(faceParts);
        applyWorldUVs(mergedGuardianFace, 0.18, 'box');

        // Bake 3D sculpted anatomical ambient occlusion into vertex colors (deep dark eye sockets, nostrils, lip crease & cliff seam!)
        const gfPos = mergedGuardianFace.attributes.position;
        const gfNorm = mergedGuardianFace.attributes.normal;
        const gfCol = new Float32Array(gfPos.count * 3);
        for (let i = 0; i < gfPos.count; i++) {
            const vx = gfPos.getX(i), vy = gfPos.getY(i), vz = gfPos.getZ(i);
            const ny = gfNorm.getY(i), nz = gfNorm.getZ(i);
            let shade = 0.74 + Math.max(0, ny) * 0.18 + Math.max(0, nz) * 0.14;
            // Darker recessed rock monolith behind the sculpted face
            if (vz < 1.8) shade *= 0.66;
            // Deep chiseled eye-socket & under-brow shadow
            const dEyeL = Math.hypot((vx + 1.42) * 0.78, (vy - 8.05) * 1.35, (vz - 3.85) * 0.9);
            const dEyeR = Math.hypot((vx - 1.42) * 0.78, (vy - 8.05) * 1.35, (vz - 3.85) * 0.9);
            if (Math.min(dEyeL, dEyeR) < 1.15 && ny < 0.25) shade *= 0.50;
            // Under-nose & nostril shadow + mouth crease + under-chin shadow
            if (Math.abs(vx) < 0.95 && vy > 5.65 && vy < 6.18 && vz > 3.8 && ny < 0.0) shade *= 0.48;
            if (Math.abs(vx) < 1.35 && Math.abs(vy - 5.05) < 0.22 && vz > 3.9) shade *= 0.46;
            if (vy < 4.55 && ny < -0.15) shade *= 0.58;
            shade = Math.min(1.08, Math.max(0.28, shade));
            gfCol[i * 3]     = shade * 0.96;
            gfCol[i * 3 + 1] = shade * 0.99;
            gfCol[i * 3 + 2] = shade * 1.04;
        }
        mergedGuardianFace.setAttribute('color', new THREE.BufferAttribute(gfCol, 3));
        this.sharedGeo.guardianFace = mergedGuardianFace;

        // Deep recessed shadow slits under the serene eyelids, nostrils & lip parting for strong readability at distance
        this.sharedGeo.guardianShadow = this.mergeGeos([
            this.transformGeo(new THREE.SphereGeometry(0.88, 10, 8), -1.42, 7.74, 4.08, 0, 0.15, 0, 1.18, 0.15, 0.42),
            this.transformGeo(new THREE.SphereGeometry(0.88, 10, 8), 1.42, 7.74, 4.08, 0, -0.15, 0, 1.18, 0.15, 0.42),
            this.transformGeo(new THREE.SphereGeometry(1.04, 12, 8), 0, 5.05, 4.30, 0, 0, 0, 1.30, 0.12, 0.50),
            this.transformGeo(new THREE.SphereGeometry(0.24, 8, 6), -0.48, 5.96, 4.55, 0, 0, 0, 1.1, 0.45, 0.8),
            this.transformGeo(new THREE.SphereGeometry(0.24, 8, 6), 0.48, 5.96, 4.55, 0, 0, 0, 1.1, 0.45, 0.8)
        ]);

        // Tiered Mayan/Bayon carved diadem headband, lotus crown & circular ear-spools
        this.sharedGeo.guardianCrown = this.mergeGeos([
            this.transformGeo(new THREE.CylinderGeometry(3.68, 3.52, 1.35, 16), 0, 10.15, 1.50, 0.04, 0, 0, 0.96, 1.0, 0.86),
            this.transformGeo(new THREE.BoxGeometry(6.8, 1.55, 5.4), 0, 11.45, 1.25),
            this.transformGeo(new THREE.BoxGeometry(4.9, 1.45, 4.2), 0, 12.85, 1.15),
            this.transformGeo(new THREE.CylinderGeometry(1.35, 2.1, 1.35, 8), 0, 14.15, 1.10),
            this.transformGeo(new THREE.CylinderGeometry(1.08, 1.08, 0.72, 14), -3.65, 5.15, 1.75, Math.PI / 2, 0, 0.12),
            this.transformGeo(new THREE.CylinderGeometry(1.08, 1.08, 0.72, 14), 3.65, 5.15, 1.75, Math.PI / 2, 0, -0.12),
            this.transformGeo(new THREE.ConeGeometry(0.58, 1.55, 8), -3.65, 3.85, 1.65, Math.PI, 0, 0),
            this.transformGeo(new THREE.ConeGeometry(0.58, 1.55, 8), 3.65, 3.85, 1.65, Math.PI, 0, 0)
        ]);

        // 7. Towering 17m Craggy Sculpted Ancient Sandstone Cliff Massif with Spiral Relief (matches right circle in f4e454a6.jpg!)
        const makeCliffSlab = (w, h, d, ox, oy, oz, seed) => {
            const cg = new THREE.BoxGeometry(w, h, d, 4, 6, 7);
            const cp = cg.attributes.position;
            for (let i = 0; i < cp.count; i++) {
                let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
                const hFrac = (y + h * 0.5) / h;
                // Stepped ancient rock ledges + rugged craggy overhangs so it reads as natural sculpted cliff rock!
                const stepLedge = Math.floor(hFrac * 4.0) * 0.38;
                const crag = Math.sin(z * 0.42 + seed) * 1.05 + Math.cos(y * 0.62 - z * 0.31) * 0.72;
                x = x * (1.02 - hFrac * 0.22) - stepLedge + crag * (x > 0 ? 0.75 : 0.35);
                y += Math.sin(z * 0.34 + seed * 1.7) * (hFrac > 0.72 ? 1.35 : 0.32);
                cp.setXYZ(i, x + ox, y + oy, z + oz);
            }
            cg.computeVertexNormals();
            applyWorldUVs(cg, 0.052, 'zy');
            return cg;
        };
        const cliffBoulderA = makeCraggyRock(5.4, 1, 0.85, 1.42, 1.18, 1.4, 6.2, -5.8, 3.1);
        applyWorldUVs(cliffBoulderA, 0.058, 'zy');
        const cliffBoulderB = makeCraggyRock(5.2, 1, 0.85, 1.36, 1.15, 1.2, 5.8, 6.2, 5.4);
        applyWorldUVs(cliffBoulderB, 0.058, 'zy');
        this.sharedGeo.spiralCliffWall = this.mergeGeos([
            makeCliffSlab(7.6, 16.4, 19.8, 0, 7.6, 0, 0.5),
            cliffBoulderA,
            cliffBoulderB
        ]);

        // 8. Carved Ancient Crouching Stone Guardian / Mayan Jaguar Statue for Parapets & Gates (00:01 in TikTok!)
        const jaguarParts = [
            this.transformGeo(new THREE.BoxGeometry(1.18, 0.28, 1.55), 0, 0.14, 0),
            this.transformGeo(new THREE.SphereGeometry(0.52, 10, 8), 0, 0.72, -0.18, -0.28, 0, 0, 0.88, 1.08, 1.38),
            this.transformGeo(new THREE.SphereGeometry(0.46, 10, 8), 0, 1.12, 0.24, 0.18, 0, 0, 0.92, 0.96, 1.05),
            this.transformGeo(new THREE.BoxGeometry(0.68, 0.56, 0.66), 0, 1.46, 0.46),
            this.transformGeo(new THREE.BoxGeometry(0.48, 0.34, 0.42), 0, 1.36, 0.82),
            this.transformGeo(new THREE.ConeGeometry(0.14, 0.28, 5), -0.26, 1.82, 0.38),
            this.transformGeo(new THREE.ConeGeometry(0.14, 0.28, 5), 0.26, 1.82, 0.38),
            this.transformGeo(new THREE.CylinderGeometry(0.14, 0.17, 0.85, 7), -0.28, 0.66, 0.48, 0.16, 0, 0),
            this.transformGeo(new THREE.CylinderGeometry(0.14, 0.17, 0.85, 7), 0.28, 0.66, 0.48, 0.16, 0, 0)
        ];
        const jg = this.mergeGeos(jaguarParts);
        applyWorldUVs(jg, 0.45, 'box');
        this.sharedGeo.crouchingGuardian = jg;

        // 9. Subway Train & Tram Flanged Steel Wheels (for spinning wheel bogies on the rails!)
        const wheelTread = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14);
        this.transformGeo(wheelTread, 0, 0, 0, Math.PI / 2, 0, 0);
        const wheelFlange = new THREE.CylinderGeometry(0.50, 0.50, 0.04, 14);
        this.transformGeo(wheelFlange, 0, 0, -0.09, Math.PI / 2, 0, 0);
        const wheelCap = new THREE.CylinderGeometry(0.14, 0.14, 0.20, 8);
        this.transformGeo(wheelCap, 0, 0, 0, Math.PI / 2, 0, 0);
        this.sharedGeo.trainWheel = this.mergeGeos([wheelTread, wheelFlange, wheelCap]);
    }

    createFlamePlume(widthScale = 1.0, heightScale = 1.0) {
        const m = new THREE.Mesh(this.sharedGeo.flameMerged, this.materials.fireSprite);
        m.scale.set(widthScale, heightScale, widthScale);
        return m;
    }

    // ============================================================
    // SUNLIT TROPICAL LIGHTING + PERMANENT SINGLE ACCENT LIGHT
    // ============================================================
    setupLighting() {
        // Golden late-morning tropical sun + cool sky bounce / mossy-earth ground bounce (higher contrast = realistic depth)
        this.hemiLight = new THREE.HemisphereLight(0xcfeaff, 0x6a5a38, 0.80);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xffe2b0, 1.75);
        this.sunLight.position.set(26, 44, -24);
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);

        const ambient = new THREE.AmbientLight(0xd4e8ff, 0.2);
        this.scene.add(ambient);

        // Single permanent PointLight kept in scene forever -> NUM_POINT_LIGHTS is ALWAYS 1!
        this.accentLight = new THREE.PointLight(0xff6a00, 0.0, 22);
        this.accentLight.position.set(0, 2.0, -10);
        this.scene.add(this.accentLight);
    }

    // ============================================================
    // PAINTED TROPICAL SKY DOME, PANORAMIC CLIFFS & MAYAN PYRAMIDS
    // ============================================================
    buildSkyAndDistantMountains() {
        this.distantGroup = new THREE.Group();

        // VIVID TROPICAL SKY (2048x1024 — Matches TikTok Reflex Run: deep cobalt-cerulean sky + crisp white sculpted cumulus!)
        const SW = 2048, SH = 1024, HZ = SH * 0.5;
        const skyC = document.createElement('canvas');
        skyC.width = SW;
        skyC.height = SH;
        const sctx = skyC.getContext('2d');

        const skyGrad = sctx.createLinearGradient(0, 0, 0, HZ);
        skyGrad.addColorStop(0.0, '#0a4cc0');
        skyGrad.addColorStop(0.45, '#1564dc');
        skyGrad.addColorStop(0.72, '#2a84f0');
        skyGrad.addColorStop(0.88, '#4ca2f8');
        skyGrad.addColorStop(0.96, '#74bcfb');
        skyGrad.addColorStop(1.0, '#8ccaf8');
        sctx.fillStyle = skyGrad;
        sctx.fillRect(0, 0, SW, HZ);
        const lowGrad = sctx.createLinearGradient(0, HZ, 0, SH);
        lowGrad.addColorStop(0.0, '#8ccaf8');
        lowGrad.addColorStop(0.10, '#427f8c');
        lowGrad.addColorStop(0.32, '#214d38');
        lowGrad.addColorStop(1.0, '#0e2418');
        sctx.fillStyle = lowGrad;
        sctx.fillRect(0, HZ, SW, SH - HZ);

        // Warm sunlit tropical sky glow aligned with DirectionalLight
        const sunX = SW * 0.62, sunY = SH * 0.21;
        const paintWrapped = (x, fn) => {
            fn(x);
            if (x < 320) fn(x + SW);
            if (x > SW - 320) fn(x - SW);
        };
        const halo = sctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 360);
        halo.addColorStop(0.0, 'rgba(255, 253, 240, 0.92)');
        halo.addColorStop(0.06, 'rgba(255, 246, 218, 0.65)');
        halo.addColorStop(0.20, 'rgba(170, 224, 255, 0.22)');
        halo.addColorStop(1.0, 'rgba(120, 195, 255, 0.0)');
        sctx.fillStyle = halo;
        sctx.fillRect(sunX - 360, sunY - 360, 720, 720);

        // High thin cirrus wisps across deep blue upper sky
        for (let c = 0; c < 22; c++) {
            const cx = this.hash2(c, 301) * SW;
            const cy = 220 + this.hash2(c, 303) * 145;
            const cw = 95 + this.hash2(c, 307) * 155;
            paintWrapped(cx, (x) => {
                const g = sctx.createRadialGradient(x, cy, 0, x, cy, cw);
                g.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
                g.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
                sctx.fillStyle = g;
                sctx.save();
                sctx.translate(x, cy);
                sctx.scale(1, 0.07 + this.hash2(c, 311) * 0.04);
                sctx.translate(-x, -cy);
                sctx.beginPath();
                sctx.arc(x, cy, cw, 0, Math.PI * 2);
                sctx.fill();
                sctx.restore();
            });
        }

        // Crisp, detailed snow-white cauliflower cumulus clouds in the visible horizon-to-mid-sky band (matches ref_mine_traps.png!)
        const drawCumulus = (cx, cy, w, seed) => {
            const puffs = 11 + Math.floor(this.hash2(seed, 1) * 6);
            const towardSun = Math.sign(sunX - cx) || 1;
            const list = [];
            for (let i = 0; i < puffs; i++) {
                const t = (i + 0.5) / puffs;
                const bell = Math.sin(t * Math.PI);
                const r = w * (0.09 + bell * 0.145) * (0.76 + this.hash2(seed, i + 3) * 0.46);
                list.push([
                    cx + (t - 0.5) * w * 0.90 + (this.hash2(seed, i + 40) - 0.5) * w * 0.06,
                    cy - r * (0.48 + bell * 0.62) - this.hash2(seed, i + 70) * r * 0.34,
                    r
                ]);
            }
            // 1. Cool cobalt-silver shadowed cloud base
            list.forEach(([px, py, r]) => {
                const g = sctx.createRadialGradient(px, py + r * 0.30, r * 0.16, px, py + r * 0.30, r * 0.98);
                g.addColorStop(0, 'rgba(112, 162, 224, 0.90)');
                g.addColorStop(0.75, 'rgba(130, 180, 238, 0.65)');
                g.addColorStop(1, 'rgba(130, 180, 238, 0.0)');
                sctx.fillStyle = g;
                sctx.beginPath();
                sctx.arc(px, py + r * 0.30, r * 0.98, 0, Math.PI * 2);
                sctx.fill();
            });
            // 2. Crisp pure snow-white sunlit cloud crowns (tight edge falloff for realistic cumulus definition!)
            list.forEach(([px, py, r]) => {
                const hx = px + towardSun * r * 0.24, hy = py - r * 0.34;
                const g = sctx.createRadialGradient(hx, hy, r * 0.05, px, py, r * 0.92);
                g.addColorStop(0, 'rgba(255, 255, 255, 0.99)');
                g.addColorStop(0.68, 'rgba(248, 252, 255, 0.95)');
                g.addColorStop(0.89, 'rgba(210, 234, 255, 0.45)');
                g.addColorStop(1, 'rgba(180, 220, 255, 0.0)');
                sctx.fillStyle = g;
                sctx.beginPath();
                sctx.arc(px, py, r * 0.92, 0, Math.PI * 2);
                sctx.fill();
            });
        };
        const cloudList = [];
        for (let c = 0; c < 38; c++) {
            const forward = c < 26;
            const u = forward ? 0.52 + this.hash2(c, 11) * 0.44 : this.hash2(c, 13);
            const cy = HZ - 28 - Math.pow(this.hash2(c, 17), 0.85) * 148;
            const elev = (HZ - cy) / 180;
            const w = (64 + this.hash2(c, 19) * 86) * (0.58 + elev * 0.58);
            cloudList.push([u * SW, cy, w, c]);
        }
        cloudList.sort((a, b) => b[1] - a[1]).forEach(([x, cy, w, c]) => {
            paintWrapped(x, (px) => drawCumulus(px, cy, w, c + 500));
        });

        // Subtle low horizon cerulean foothills (kept low so the vivid cobalt sky & crisp cumulus shine clearly!)
        const ridgeH = (x, baseY, amp1, amp2, ph) => {
            const a = (x / SW) * Math.PI * 2;
            return baseY + Math.sin(a * 5.0 + ph) * amp1 + Math.cos(a * 11.0 - 0.8 + ph) * amp2
                + Math.sin(a * 23.0 + ph * 2.0) * amp2 * 0.42 + Math.sin(a * 53.0 + ph) * amp2 * 0.16;
        };
        const paintRange = (baseY, amp1, amp2, ph, color, crowns, crownColor) => {
            sctx.fillStyle = color;
            sctx.beginPath();
            sctx.moveTo(0, HZ + 60);
            for (let x = 0; x <= SW; x += 8) sctx.lineTo(x, ridgeH(x, baseY, amp1, amp2, ph));
            sctx.lineTo(SW, HZ + 60);
            sctx.closePath();
            sctx.fill();
            if (crowns) {
                for (let x = 0; x < SW; x += 5) {
                    const y = ridgeH(x, baseY, amp1, amp2, ph);
                    const r = 3.5 + this.hash2(x, ph * 10) * 5.0;
                    sctx.fillStyle = crownColor;
                    sctx.beginPath();
                    sctx.arc(x, y + r * 0.35, r, 0, Math.PI * 2);
                    sctx.fill();
                }
            }
        };
        paintRange(HZ - 42, 14, 8, 0.5, '#3b84cf', false);
        paintRange(HZ - 24, 11, 6, 2.1, '#2d6fa8', true, '#3174ae');
        paintRange(HZ - 12, 8, 5, 4.0, '#225978', true, '#266080');
        const mist = sctx.createLinearGradient(0, HZ - 34, 0, HZ + 20);
        mist.addColorStop(0, 'rgba(140, 202, 248, 0.0)');
        mist.addColorStop(0.70, 'rgba(140, 202, 248, 0.36)');
        mist.addColorStop(1, 'rgba(140, 202, 248, 0.72)');
        sctx.fillStyle = mist;
        sctx.fillRect(0, HZ - 34, SW, 54);

        const skyTex = new THREE.CanvasTexture(skyC);
        skyTex.encoding = THREE.sRGBEncoding;
        skyTex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy() || 1);
        const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
        const skyDome = new THREE.Mesh(new THREE.SphereGeometry(280, 48, 32), skyMat);
        skyDome.renderOrder = -2;
        this.distantGroup.add(skyDome);

        const valleyMat = new THREE.MeshBasicMaterial({ color: this.srgb(0x1f4730), fog: true });
        const valleyFloor = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), valleyMat);
        valleyFloor.rotation.x = -Math.PI / 2;
        valleyFloor.position.set(0, -24, -110);
        this.distantGroup.add(valleyFloor);

        // 1. Textured Ancient Stepped Mayan Pyramids with Stairways, Balustrades & Summit Shrines (1 draw call!)
        const pyrParts = [];
        const addPyr = (ox, oy, oz, sc) => {
            for (let tier = 0; tier < 8; tier++) {
                const w = (78 - tier * 8.8) * sc;
                const h = 7.4 * sc;
                const ty = oy + tier * h + h * 0.5;
                pyrParts.push(this.transformGeo(new THREE.BoxGeometry(w, h, w), ox, ty, oz));
                // Projecting cornice molding on each pyramid terrace
                pyrParts.push(this.transformGeo(new THREE.BoxGeometry(w + 1.6 * sc, 1.1 * sc, w + 1.6 * sc), ox, ty + h * 0.44, oz));
            }
            // Grand central stairway + twin stone balustrades + summit temple + roof comb
            pyrParts.push(this.transformGeo(new THREE.BoxGeometry(14 * sc, 58 * sc, 54 * sc), ox, oy + 24 * sc, oz + 21 * sc, 0.52, 0, 0));
            pyrParts.push(this.transformGeo(new THREE.BoxGeometry(2.2 * sc, 60 * sc, 55 * sc), ox - 7.8 * sc, oy + 25 * sc, oz + 21.5 * sc, 0.52, 0, 0));
            pyrParts.push(this.transformGeo(new THREE.BoxGeometry(2.2 * sc, 60 * sc, 55 * sc), ox + 7.8 * sc, oy + 25 * sc, oz + 21.5 * sc, 0.52, 0, 0));
            pyrParts.push(this.transformGeo(new THREE.BoxGeometry(20 * sc, 11.5 * sc, 18 * sc), ox, oy + 64.5 * sc, oz));
            pyrParts.push(this.transformGeo(new THREE.BoxGeometry(13 * sc, 7.5 * sc, 5.5 * sc), ox, oy + 73.5 * sc, oz - 1.5 * sc));
        };
        addPyr(16, 0, -166, 1.04);
        addPyr(-52, -2, -160, 0.84);
        addPyr(94, -3, -142, 0.74);
        addPyr(-106, -3, -138, 0.72);

        const pyrMat = new THREE.MeshStandardMaterial({
            map: this.textures.masonry,
            bumpMap: this.textures.masonryBump,
            bumpScale: 0.06,
            color: this.srgb(0x889698),
            roughness: 0.86
        });
        this.distantGroup.add(new THREE.Mesh(this.mergeGeos(pyrParts), pyrMat));

        // 2. Continuous Panoramic Jungle-Clad Canyon Mountain Ranges framing BOTH Left & Right Sides (1 draw call!)
        const mtnParts = [];
        const addPeak = (px, py, pz, rx, ry, rz, rotY = 0) => {
            mtnParts.push(this.transformGeo(new THREE.ConeGeometry(rx, ry, 7), px, py + ry * 0.42, pz, 0, rotY, 0, 1.0, 1.0, rz / rx));
            mtnParts.push(this.transformGeo(new THREE.DodecahedronGeometry(rx * 0.72, 1), px, py + ry * 0.22, pz + 4, 0, rotY, 0, 1.15, 0.85, 0.95));
        };
        [-1, 1].forEach((side) => {
            addPeak(side * 66, -8, -42, 26, 48, 34, side * 0.4);
            addPeak(side * 74, -8, -88, 30, 56, 38, side * 0.9);
            addPeak(side * 82, -8, -136, 34, 64, 42, side * 1.3);
            addPeak(side * 64, -10, -178, 32, 60, 36, side * 0.6);
            addPeak(side * 118, -10, -110, 38, 68, 46, side * 0.2);
        });
        addPeak(-22, -10, -196, 36, 62, 34, 0.5);
        addPeak(52, -10, -192, 34, 58, 34, -0.4);

        const mtnMat = new THREE.MeshStandardMaterial({
            map: this.textures.foliage,
            bumpMap: this.textures.masonryBump,
            bumpScale: 0.05,
            color: this.srgb(0x3f6b58),
            roughness: 0.92
        });
        this.distantGroup.add(new THREE.Mesh(this.mergeGeos(mtnParts), mtnMat));

        this.scene.add(this.distantGroup);
    }

    buildPlayerAvatar() {
        this.playerGroup = new THREE.Group();

        // 1. Subway Surfers Runner (Matches 9468adf5.jpg & f565e49c.jpg!)
        const torso = new THREE.Mesh(
            new THREE.BoxGeometry(0.76, 0.98, 0.42),
            this.materials.subwayRunnerHoodie
        );
        torso.position.y = 1.3;
        this.playerGroup.add(torso);

        // Dark blue backpack with logo
        const backpack = new THREE.Mesh(
            new THREE.BoxGeometry(0.56, 0.64, 0.24),
            this.materials.subwayRunnerBackpack
        );
        backpack.position.set(0, 1.35, 0.26);
        this.playerGroup.add(backpack);

        // Peach skin head
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 14, 14),
            this.materials.guardSkin
        );
        head.position.y = 2.02;
        this.playerGroup.add(head);

        // Red backwards baseball cap + rear brim
        const cap = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.18, 14),
            this.materials.subwayCap
        );
        cap.position.y = 2.12;
        const visor = new THREE.Mesh(
            new THREE.BoxGeometry(0.26, 0.04, 0.28),
            this.materials.subwayCap
        );
        visor.position.set(0, 2.04, 0.26);
        this.playerGroup.add(cap, visor);

        const legGeo = new THREE.BoxGeometry(0.3, 0.8, 0.34);
        this.leftLeg = new THREE.Mesh(legGeo, this.materials.subwayRunnerJeans);
        this.leftLeg.position.set(-0.22, 0.5, 0);
        this.rightLeg = new THREE.Mesh(legGeo, this.materials.subwayRunnerJeans);
        this.rightLeg.position.set(0.22, 0.5, 0);
        this.playerGroup.add(this.leftLeg, this.rightLeg);

        const armGeo = new THREE.BoxGeometry(0.21, 0.74, 0.24);
        this.leftArm = new THREE.Mesh(armGeo, this.materials.subwayRunnerHoodie);
        this.leftArm.position.set(-0.52, 1.25, 0);
        this.rightArm = new THREE.Mesh(armGeo, this.materials.subwayRunnerHoodie);
        this.rightArm.position.set(0.52, 1.25, 0);
        this.playerGroup.add(this.rightArm, this.leftArm);

        this.scene.add(this.playerGroup);
        this.playerGroup.visible = (this.cameraMode !== 'firstPerson');

        // 2. Iconic Security Inspector & Bulldog Chaser (Matches 9468adf5.jpg & f565e49c.jpg!)
        this.chaserGroup = new THREE.Group();

        // --- THE INSPECTOR ---
        const inspBelly = new THREE.Mesh(
            new THREE.BoxGeometry(1.05, 1.15, 0.65),
            this.materials.inspectorCoat
        );
        inspBelly.position.set(0, 1.35, 0);
        const inspBadge = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.14, 0.05),
            this.materials.inspectorGold
        );
        inspBadge.position.set(0.28, 1.62, -0.34);
        const inspBelt = new THREE.Mesh(
            new THREE.BoxGeometry(1.08, 0.16, 0.68),
            this.materials.darkIron
        );
        inspBelt.position.set(0, 0.88, 0);

        const inspHead = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 14, 14),
            this.materials.guardSkin
        );
        inspHead.position.set(0, 2.18, 0);

        const inspMustache = new THREE.Mesh(
            new THREE.BoxGeometry(0.32, 0.08, 0.12),
            this.materials.inspectorPants
        );
        inspMustache.position.set(0, 2.06, -0.34);

        const inspCap = new THREE.Mesh(
            new THREE.CylinderGeometry(0.40, 0.38, 0.22, 14),
            this.materials.inspectorCap
        );
        inspCap.position.set(0, 2.34, 0);
        const inspVisor = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.05, 0.24),
            this.materials.darkIron
        );
        inspVisor.position.set(0, 2.26, -0.30);
        const inspCapBadge = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.12, 0.05),
            this.materials.inspectorGold
        );
        inspCapBadge.position.set(0, 2.38, -0.38);

        const inspLegGeo = new THREE.BoxGeometry(0.36, 0.85, 0.40);
        this.inspLeftLeg = new THREE.Mesh(inspLegGeo, this.materials.inspectorPants);
        this.inspLeftLeg.position.set(-0.28, 0.45, 0);
        this.inspRightLeg = new THREE.Mesh(inspLegGeo, this.materials.inspectorPants);
        this.inspRightLeg.position.set(0.28, 0.45, 0);

        const inspArmGeo = new THREE.BoxGeometry(0.26, 0.78, 0.28);
        this.inspLeftArm = new THREE.Mesh(inspArmGeo, this.materials.inspectorCoat);
        this.inspLeftArm.position.set(-0.66, 1.30, 0);
        this.inspRightArm = new THREE.Mesh(inspArmGeo, this.materials.inspectorCoat);
        this.inspRightArm.position.set(0.66, 1.30, 0);

        this.chaserGroup.add(
            inspBelly, inspBadge, inspBelt, inspHead, inspMustache,
            inspCap, inspVisor, inspCapBadge,
            this.inspLeftLeg, this.inspRightLeg, this.inspLeftArm, this.inspRightArm
        );

        // --- THE BULLDOG ---
        const dogGroup = new THREE.Group();
        dogGroup.position.set(0.85, 0, 0.35);

        const dogBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.50, 0.42, 0.72),
            this.materials.bulldogFur
        );
        dogBody.position.set(0, 0.40, 0);

        const dogHead = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.34, 0.36),
            this.materials.bulldogFur
        );
        dogHead.position.set(0, 0.48, -0.36);

        const dogCollar = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.08, 0.10),
            this.materials.darkIron
        );
        dogCollar.position.set(0, 0.46, -0.22);

        const dogSnout = new THREE.Mesh(
            new THREE.BoxGeometry(0.24, 0.16, 0.16),
            this.materials.inspectorPants
        );
        dogSnout.position.set(0, 0.40, -0.52);

        const dogLegGeo = new THREE.BoxGeometry(0.14, 0.28, 0.16);
        this.dogLeg1 = new THREE.Mesh(dogLegGeo, this.materials.bulldogFur);
        this.dogLeg1.position.set(-0.18, 0.14, -0.24);
        this.dogLeg2 = new THREE.Mesh(dogLegGeo, this.materials.bulldogFur);
        this.dogLeg2.position.set(0.18, 0.14, -0.24);
        this.dogLeg3 = new THREE.Mesh(dogLegGeo, this.materials.bulldogFur);
        this.dogLeg3.position.set(-0.18, 0.14, 0.24);
        this.dogLeg4 = new THREE.Mesh(dogLegGeo, this.materials.bulldogFur);
        this.dogLeg4.position.set(0.18, 0.14, 0.24);

        dogGroup.add(dogBody, dogHead, dogCollar, dogSnout, this.dogLeg1, this.dogLeg2, this.dogLeg3, this.dogLeg4);
        this.chaserGroup.add(dogGroup);

        this.scene.add(this.chaserGroup);
        this.chaserGroup.visible = (this.cameraMode !== 'firstPerson');
    }

    // ============================================================
    // PRE-ALLOCATED CHUNK, PORTAL, COIN & TRAP OBJECT POOLS
    // ============================================================
    initObjectPools() {
        const roadWidth = this.laneWidth * 3 + 1.5;

        // Pre-build 7 reusable chunks per biome (zero runtime mesh creation!)
        for (let i = 0; i < 7; i++) {
            const tChunk = new THREE.Group();
            const tFlames = [];
            this.buildTempleCausewayChunk(tChunk, roadWidth, i, tFlames);
            tChunk.visible = false;
            this.scene.add(tChunk);
            this.chunkPools.TEMPLE.push({ mesh: tChunk, flames: tFlames, biome: 'TEMPLE' });

            const bChunk = new THREE.Group();
            this.buildSuspensionBridgeChunk(bChunk, roadWidth, i);
            bChunk.visible = false;
            this.scene.add(bChunk);
            this.chunkPools.BRIDGE.push({ mesh: bChunk, flames: [], biome: 'BRIDGE' });

            const mChunk = new THREE.Group();
            const mFlames = [];
            this.buildCrystalMineChunk(mChunk, roadWidth, i, mFlames);
            mChunk.visible = false;
            this.scene.add(mChunk);
            this.chunkPools.MINE.push({ mesh: mChunk, flames: mFlames, biome: 'MINE' });
        }

        // Pre-build 2 Demon-Maw Biome Transition Portals
        for (let p = 0; p < 2; p++) {
            const portal = new THREE.Group();
            this.buildTempleMawPortal(portal, roadWidth, 0);
            portal.visible = false;
            this.scene.add(portal);
            this.portalPool.push(portal);
        }

        // Pre-build 35 reusable Gold Coins + soft ground contact shadows
        for (let c = 0; c < 35; c++) {
            const holder = new THREE.Group();
            const coinMesh = new THREE.Mesh(this.sharedGeo.coinMerged, this.materials.gold);
            coinMesh.position.y = 1.22;
            const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
            sh.scale.set(0.95, 1, 0.95);
            sh.position.y = 0.02;
            holder.add(coinMesh, sh);
            holder.visible = false;
            this.scene.add(holder);
            this.coinPool.push({
                holder: holder,
                spinMesh: coinMesh,
                inUse: false,
                worldZ: 0,
                laneIndex: 1,
                collected: false
            });
        }

        // Pre-build reusable instances of every trap type (0ms trap spawning!)
        this.trapPool = {
            FIRE_HURDLE: this.createPooledTrap(() => this.buildFireHurdle(0)),
            SPIKED_ROLLER: this.createPooledTrap(() => this.buildSpikedRoller(0)),
            MINE_SAWBLADE: this.createPooledTrap(() => this.buildMineSawblade(0)),
            CHASM_GAP: this.createPooledTrap(() => this.buildChasmGap(0)),
            OVERHEAD_FLAME: this.createPooledTrap(() => this.buildOverheadFlameTrap(0)),
            SPIKED_LINTEL: this.createPooledTrap(() => this.buildSpikedLintel(0)),
            ARCH_TEMPLE: this.createPooledTrap(() => this.buildStoneArchGate(0, false)),
            ARCH_MINE: this.createPooledTrap(() => this.buildStoneArchGate(0, true)),
            BOULDER_LEFT: this.createPooledTrap(() => this.buildRollingBoulder(0, -1)),
            BOULDER_RIGHT: this.createPooledTrap(() => this.buildRollingBoulder(0, 1)),
            REAPER_CART_LEFT: this.createPooledTrap(() => this.buildReaperMinecart(0, -1)),
            REAPER_CART_RIGHT: this.createPooledTrap(() => this.buildReaperMinecart(0, 1)),
            SPIKED_CART_LEFT: this.createPooledTrap(() => this.buildSpikedRunawayCart(0, -1)),
            SPIKED_CART_RIGHT: this.createPooledTrap(() => this.buildSpikedRunawayCart(0, 1)),
            IDOL_LEFT: this.createPooledTrap(() => this.buildIdolBarrier(0, -1)),
            IDOL_RIGHT: this.createPooledTrap(() => this.buildIdolBarrier(0, 1)),
            EDGE_LEFT: this.createPooledTrap(() => this.buildCollapsedEdge(0, -1)),
            EDGE_RIGHT: this.createPooledTrap(() => this.buildCollapsedEdge(0, 1)),
            SUBWAY_TRAIN_LEFT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, -1, 'SUBWAY')),
            SUBWAY_TRAIN_RIGHT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, 1, 'SUBWAY')),
            TRAM_LEFT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, -1, 'TRAM')),
            TRAM_RIGHT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, 1, 'TRAM')),
            CARGO_BOXCAR_LEFT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, -1, 'CARGO')),
            CARGO_BOXCAR_RIGHT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, 1, 'CARGO')),
            BLUE_CONTAINER_LEFT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, -1, 'BLUE_CARGO')),
            BLUE_CONTAINER_RIGHT: this.createPooledTrap(() => this.buildSubwayTrainTrap(0, 1, 'BLUE_CARGO')),
            RAILWAY_BARRIER: this.createPooledTrap(() => this.buildRailwayChevronBarrierTrap(0)),
            RAILWAY_CLEARANCE_GANTRY: this.createPooledTrap(() => this.buildRailwayClearanceGantryTrap(0))
        };
    }

    createPooledTrap(builderFn) {
        const trap = builderFn();
        trap.pooled = true;
        trap.group.visible = false;
        this.scene.add(trap.group);
        return trap;
    }

    // Uploads every geometry VBO & compiles every shader BEFORE gameplay starts!
    prewarmGPU() {
        const hiddenItems = [];
        Object.values(this.chunkPools).forEach((list) => {
            if (list[0] && !list[0].mesh.visible) {
                list[0].mesh.visible = true;
                hiddenItems.push(list[0].mesh);
            }
        });
        Object.values(this.trapPool).forEach((t) => {
            t.group.visible = true;
            hiddenItems.push(t.group);
        });
        if (this.coinPool[0]) {
            this.coinPool[0].holder.visible = true;
            hiddenItems.push(this.coinPool[0].holder);
        }

        this.renderer.compile(this.scene, this.camera);

        hiddenItems.forEach((obj) => { obj.visible = false; });
    }

    setStartingBiome(biome) {
        this.startingBiome = biome;
    }

    // ============================================================
    // 3 SEAMLESS TIKTOK BIOMES
    // ============================================================
    getBiomeForChunk(index) {
        if (this.startingBiome === 'MINE') return 'MINE';
        if (this.startingBiome === 'TEMPLE') return 'TEMPLE';
        if (this.startingBiome === 'BRIDGE') return 'BRIDGE';
        if (index < 4) return 'TEMPLE';
        const cycle = (index - 4) % 12;
        if (cycle < 4) return 'BRIDGE';
        if (cycle < 8) return 'MINE';
        return 'TEMPLE';
    }

    getBiomeAtZ(worldZ) {
        const approxIdx = Math.max(0, Math.round(-worldZ / this.chunkLength));
        return this.getBiomeForChunk(approxIdx);
    }

    generateChunk(zPos, index) {
        const biome = this.getBiomeForChunk(index);
        const prevBiome = index > 0 ? this.getBiomeForChunk(index - 1) : 'TEMPLE';

        const pool = this.chunkPools[biome];
        let entry = pool.pop();
        if (!entry) {
            const roadWidth = this.laneWidth * 3 + 1.5;
            const g = new THREE.Group();
            const fl = [];
            if (biome === 'TEMPLE') this.buildTempleCausewayChunk(g, roadWidth, index, fl);
            else if (biome === 'BRIDGE') this.buildSuspensionBridgeChunk(g, roadWidth, index);
            else this.buildCrystalMineChunk(g, roadWidth, index, fl);
            this.scene.add(g);
            entry = { mesh: g, flames: fl, biome: biome };
        }

        entry.mesh.position.z = zPos;
        entry.mesh.visible = true;
        entry.z = zPos;
        entry.index = index;
        this.chunks.push(entry);

        for (let i = 0; i < entry.flames.length; i++) {
            this.animatedFlames.push(entry.flames[i]);
        }

        if (biome !== prevBiome && (biome === 'MINE' || prevBiome === 'MINE') && this.portalPool.length > 0) {
            const portal = this.portalPool.pop();
            portal.position.z = zPos + this.chunkLength * 0.46;
            portal.visible = true;
            this.activePortals.push({ mesh: portal, z: portal.position.z });
        }

        if (index > 0) {
            this.spawnCoins(zPos);
        }
    }

    recycleChunk(entry) {
        entry.mesh.visible = false;
        if (entry.flames.length > 0) {
            const flameSet = new Set(entry.flames);
            this.animatedFlames = this.animatedFlames.filter(f => !flameSet.has(f));
        }
        this.chunkPools[entry.biome].push(entry);
    }

    // Helper: Creates a BoxGeometry with crisp world-scale UVs on all 6 faces (prevents stretched soil/rock textures!)
    makeTiledBox(w, h, d, uvScale = 0.26) {
        const g = new THREE.BoxGeometry(w, h, d);
        const norm = g.attributes.normal;
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            const nx = Math.abs(norm.getX(i));
            const ny = Math.abs(norm.getY(i));
            let su = w, sv = h;
            if (ny > 0.5) { su = w; sv = d; }
            else if (nx > 0.5) { su = d; sv = h; }
            uv.setXY(i, uv.getX(i) * su * uvScale, uv.getY(i) * sv * uvScale);
        }
        return g;
    }

    // ------------------------------------------------------------
    // BIOME 1: SUNLIT ANCIENT MAYAN STONE CAUSEWAY (MERGED PROPS)
    // ------------------------------------------------------------
    buildTempleCausewayChunk(chunk, roadWidth, index, flameList = []) {
        const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, this.chunkLength), this.materials.road);
        road.rotation.x = -Math.PI / 2;
        chunk.add(road);

        // Merge walls + viaduct + stepped Mayan ruin terraces & broken temple columns into 1 masonry draw call
        const wallParts = [
            this.transformGeo(this.makeTiledBox(roadWidth + 1.1, 14, this.chunkLength, 0.22), 0, -7.02, 0)
        ];
        const parapetParts = [];
        const curbParts = [];
        const glyphParts = [];
        const soilTerraceParts = [];
        const terraceParts = [];
        const ancientCliffParts = [];
        const rockBorderParts = [];
        const statueParts = [];
        const bushParts = [];
        const edgeFernParts = [];
        const vineParts = [];

        [-1, 1].forEach((side) => {
            const wallX = side * (roadWidth / 2 + 0.42);
            parapetParts.push(this.transformGeo(this.makeTiledBox(0.86, 0.92, this.chunkLength, 0.32), wallX, 0.46, 0));
            curbParts.push(this.transformGeo(this.makeTiledBox(1.08, 0.18, this.chunkLength, 0.35), wallX, 0.96, 0));

            // Stepped chiseled ancient stone plinth / kerb molding right at the bottom of the parapet wall on the floor!
            curbParts.push(this.transformGeo(
                this.makeTiledBox(0.34, 0.22, this.chunkLength, 0.36),
                side * (roadWidth / 2 - 0.08), 0.11, 0
            ));
            parapetParts.push(this.transformGeo(
                this.makeTiledBox(0.22, 0.10, this.chunkLength, 0.38),
                side * (roadWidth / 2 - 0.24), 0.05, 0
            ));

            // Weathered mossy stone rubble & lush green grass/fern tufts sprouting along the bottom of the stone wall!
            for (let w = 0; w < 6; w++) {
                const wz = -17.5 + w * 7.0 + (side > 0 ? 1.4 : -1.4);
                const wx = side * (roadWidth / 2 - 0.18 - (w % 2) * 0.08);
                rockBorderParts.push(this.transformGeo(
                    new THREE.DodecahedronGeometry(0.22 + (w % 2) * 0.08, 0),
                    wx, 0.10, wz,
                    w * 0.5, w * 1.1, 0,
                    1.35, 0.58, 1.15
                ));
                if (w % 2 === 0) {
                    edgeFernParts.push(this.transformGeo(
                        this.sharedGeo.fernRosette.clone(),
                        wx - side * 0.08, 0.05, wz + 0.55,
                        0, w * 1.3 + side, 0,
                        0.48, 0.44, 0.48
                    ));
                } else {
                    bushParts.push(this.transformGeo(
                        this.sharedGeo.shrubCluster.clone(),
                        wx, 0.08, wz + 0.35,
                        0, w * 0.9, 0,
                        0.36, 0.26, 0.42
                    ));
                }
            }

            for (let p = -1; p <= 1; p++) {
                glyphParts.push(this.transformGeo(new THREE.BoxGeometry(1.20, 1.28, 1.28), wallX, 0.64, p * 14));
            }

            // Carved crouching Mayan stone guardian statue perched on parapet pier (matching TikTok 00:01!)
            const jz = side < 0 ? -14 : 14;
            statueParts.push(this.transformGeo(
                this.sharedGeo.crouchingGuardian.clone(),
                wallX, 1.26, jz,
                0, side < 0 ? 0.28 : -0.28, 0,
                0.92, 0.92, 0.92
            ));

            // 1. Rich dark-brown tropical forest soil embankment directly outside the causeway parapet (top at y = +0.48m!)
            soilTerraceParts.push(this.transformGeo(
                this.makeTiledBox(11.8, 3.2, this.chunkLength, 0.30),
                side * (roadWidth / 2 + 6.4), -1.12, 0
            ));

            // 2. Mossy jungle earth terrace stepping up toward the ancient side cliffs
            terraceParts.push(this.transformGeo(
                this.makeTiledBox(18.0, 16.0, this.chunkLength, 0.20),
                side * (roadWidth / 2 + 17.5), -7.15, 0
            ));

            // Scattered mossy retaining boulders along the soil bank
            for (let r = 0; r < 3; r++) {
                const rz = -13 + r * 13 + side * 2.0;
                rockBorderParts.push(this.transformGeo(
                    new THREE.DodecahedronGeometry(0.95 + (r % 2) * 0.35, 0),
                    side * (roadWidth / 2 + 2.05 + (r % 2) * 0.65), 0.35, rz,
                    r * 0.4, r * 0.9, 0,
                    1.35, 0.72, 1.15
                ));
            }

            // 3. Stepped Ancient Mayan Temple Ruin Sanctuary & Broken Colonnade Pillars on BOTH sides!
            const ruinZ = side > 0 ? 9.5 : -9.5;
            const ruinX = side * (roadWidth / 2 + 8.8);
            wallParts.push(this.transformGeo(this.makeTiledBox(4.8, 2.2, 6.8, 0.28), ruinX, 1.3, ruinZ, 0, side * 0.12, 0));
            wallParts.push(this.transformGeo(this.makeTiledBox(3.5, 2.0, 4.8, 0.28), ruinX + side * 0.5, 3.2, ruinZ, 0, side * 0.12, 0));
            glyphParts.push(this.transformGeo(new THREE.BoxGeometry(3.8, 0.95, 5.1), ruinX + side * 0.5, 4.45, ruinZ, 0, side * 0.12, 0));
            // Weathered ancient stone pillars flanking the ruin terrace
            wallParts.push(this.transformGeo(new THREE.CylinderGeometry(0.48, 0.54, 4.8, 10), ruinX - side * 1.4, 2.8, ruinZ - 2.6));
            wallParts.push(this.transformGeo(new THREE.CylinderGeometry(0.46, 0.52, 3.6, 10), ruinX - side * 1.4, 2.2, ruinZ + 2.6));

            // 4. Continuous Towering 17m Craggy Spiral-Carved Ancient Cliff Walls closing BOTH side horizons!
            const cliffRotY = side < 0 ? 0.05 : (Math.PI - 0.05);
            [-9.5, 9.5].forEach((cz, cIdx) => {
                ancientCliffParts.push(this.transformGeo(
                    this.sharedGeo.spiralCliffWall.clone(),
                    side * (roadWidth / 2 + 19.2 + (cIdx % 2) * 1.1), 0.2, cz,
                    0, cliffRotY + (cIdx === 0 ? 0.06 : -0.06), 0
                ));
            });

            // Lush roadside shrubs + high cliff-crown tropical foliage + hanging cliff vines!
            for (let b = 0; b < 3; b++) {
                const bz = -15 + b * 14 + (side > 0 ? 3 : -2);
                const sc = 1.15 + (b % 2) * 0.28;
                bushParts.push(this.transformGeo(
                    this.sharedGeo.shrubCluster.clone(),
                    side * (roadWidth / 2 + 4.8 + (b % 2) * 2.2), 0.52, bz,
                    0, b * 1.1 + side * 0.5, 0,
                    sc * 1.15, sc * 0.95, sc * 1.15
                ));
                // Jungle canopy crowning the top of the spiral cliffs
                bushParts.push(this.transformGeo(
                    this.sharedGeo.shrubCluster.clone(),
                    side * (roadWidth / 2 + 16.5), 15.2 + (b % 2) * 0.8, -12 + b * 12,
                    0, b * 0.9, 0,
                    3.0, 2.0, 3.0
                ));
            }

        });

        // Colossal 15.5m Chiseled Bayon/Mayan Stone Cliff Face placed in the open vista bay (unobstructed by side arches!)
        const faceSide = (index % 2 === 0) ? -1 : 1;
        const fx = faceSide * (roadWidth / 2 + 12.6);
        const fy = 1.45;
        const fz = (faceSide < 0) ? -9.5 : 9.5;
        const fRot = -faceSide * 0.54;
        const guardianFaceGeo = this.transformGeo(this.sharedGeo.guardianFace.clone(), fx, fy, fz, 0, fRot, 0);
        glyphParts.push(this.transformGeo(this.sharedGeo.guardianCrown.clone(), fx, fy, fz, 0, fRot, 0));
        bushParts.push(this.transformGeo(this.sharedGeo.shrubCluster.clone(), fx, fy + 14.1, fz, 0, fRot, 0, 2.5, 1.45, 2.3));
        const shadowPart = [this.transformGeo(this.sharedGeo.guardianShadow.clone(), fx, fy, fz, 0, fRot, 0)];

        chunk.add(new THREE.Mesh(this.mergeGeos(wallParts), this.materials.wall));
        chunk.add(new THREE.Mesh(this.mergeGeos(parapetParts), this.materials.parapet));
        chunk.add(new THREE.Mesh(this.mergeGeos(curbParts), this.materials.curb));
        chunk.add(new THREE.Mesh(this.mergeGeos(glyphParts), this.materials.glyph));
        chunk.add(new THREE.Mesh(this.mergeGeos(soilTerraceParts), this.materials.soil));
        chunk.add(new THREE.Mesh(this.mergeGeos(terraceParts), this.materials.cliffJungle));
        chunk.add(new THREE.Mesh(this.mergeGeos(rockBorderParts), this.materials.canyonCliff));
        chunk.add(new THREE.Mesh(this.mergeGeos(ancientCliffParts), this.materials.ancientCliff));
        if (statueParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(statueParts), this.materials.statueStone));
        chunk.add(new THREE.Mesh(guardianFaceGeo, this.materials.guardianStone));
        chunk.add(new THREE.Mesh(this.mergeGeos(shadowPart), this.materials.darkIron));
        chunk.add(new THREE.Mesh(this.mergeGeos(bushParts), this.materials.leaves2));
        if (edgeFernParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(edgeFernParts), this.materials.fern));
        if (vineParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(vineParts), this.materials.vines));

        this.buildSideAqueductArches(chunk, roadWidth, index);
        this.buildMahoganyTreesAndFerns(chunk, roadWidth, index, true, 0.48);

        this.buildIronFireBraziers(chunk, roadWidth, 0, flameList);
    }

    // ------------------------------------------------------------
    // BIOME 2: AUTHENTIC TIKTOK WEATHERED TIMBER BRIDGE & LOG-RAIL BOLLARDS
    // (100% Same-to-Same with eae94aa6.jpg & 11d922c7.jpg!)
    // ------------------------------------------------------------
    buildSuspensionBridgeChunk(chunk, roadWidth, index) {
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth + 0.45, this.chunkLength), this.materials.bridge);
        deck.rotation.x = -Math.PI / 2;
        chunk.add(deck);

        // Cool misty waterfall-blue chasm haze plane deep below the open side railing gaps!
        const chasmGlow = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth + 14.0, this.chunkLength), this.materials.chasmMist);
        chasmGlow.rotation.x = -Math.PI / 2;
        chasmGlow.position.y = -6.8;
        chunk.add(chasmGlow);

        const driftwoodParts = [];
        const underWoodParts = [];
        const ropeParts = [];
        const masonryParts = [];
        const edgeMossParts = [];
        const edgeFernParts = [];
        const vineParts = [];

        // Heavy longitudinal timber stringers underneath the bridge deck
        [-roadWidth * 0.45, -roadWidth * 0.16, roadWidth * 0.16, roadWidth * 0.45].forEach((sx) => {
            underWoodParts.push(this.transformGeo(new THREE.BoxGeometry(0.46, 0.56, this.chunkLength), sx, -0.32, 0));
        });

        // Ancient weathered stone bridge support piers underneath the timber deck
        [-12, 12].forEach((pz) => {
            masonryParts.push(this.transformGeo(this.makeTiledBox(roadWidth + 1.8, 12.0, 2.4, 0.25), 0, -6.4, pz));
        });

        const postSpacing = 5.25; // 8 stout weathered bollards per 42m chunk!
        const postCount = Math.round(this.chunkLength / postSpacing);

        [-1, 1].forEach((side) => {
            const postX = side * (roadWidth / 2 + 0.34);

            // 1. Weathered side curb sill beam + uneven 3D hand-hewn plank ends jutting along both floor edges!
            driftwoodParts.push(this.transformGeo(
                this.makeTiledBox(0.44, 0.18, this.chunkLength, 0.35),
                side * (roadWidth / 2 + 0.16), 0.08, 0
            ));
            for (let p = 0; p < 24; p++) {
                const pz = -this.chunkLength / 2 + 0.88 + p * (this.chunkLength / 24);
                const jut = 0.28 + ((p * 7 + (side > 0 ? 3 : 1)) % 4) * 0.09;
                driftwoodParts.push(this.transformGeo(
                    new THREE.BoxGeometry(0.55 + jut, 0.12, 1.38),
                    side * (roadWidth / 2 + 0.22 + jut * 0.5), -0.04 + (p % 2) * 0.02, pz
                ));
            }

            // 2. Stout Weathered Driftwood Bollard Posts + Top & Bottom Multi-Coiled Hemp Rope Collars (Matches eae94aa6.jpg!)
            const postZList = [];
            for (let i = 0; i <= postCount; i++) {
                const pz = -this.chunkLength / 2 + i * postSpacing;
                postZList.push(pz);
                if (i < postCount) {
                    // Protruding cross-tie beam end underneath each bollard
                    underWoodParts.push(this.transformGeo(
                        new THREE.BoxGeometry(1.35, 0.32, 0.48),
                        side * (roadWidth / 2 + 0.28), -0.18, pz
                    ));
                    // Stepped weathered stone/timber bollard base collar sitting on the bridge edge
                    masonryParts.push(this.transformGeo(
                        new THREE.CylinderGeometry(0.42, 0.46, 0.22, 10),
                        postX, 0.18, pz
                    ));
                    // Stout cylindrical weathered grey-bark bollard post + beveled flat cap
                    driftwoodParts.push(
                        this.transformGeo(new THREE.CylinderGeometry(0.33, 0.37, 1.36, 12), postX, 0.82, pz),
                        this.transformGeo(new THREE.CylinderGeometry(0.38, 0.35, 0.10, 12), postX, 1.52, pz)
                    );
                    // Multi-strand pale hemp rope lashings wrapped tightly around TOP & BOTTOM of every bollard!
                    [1.26, 1.17, 1.08, 0.38, 0.29].forEach((ry) => {
                        ropeParts.push(this.transformGeo(
                            new THREE.TorusGeometry(0.365, 0.048, 6, 12),
                            postX, ry, pz,
                            Math.PI * 0.5, 0, 0
                        ));
                    });
                }
            }

            // 3. Sturdy Horizontal Timber Log Rails + Diagonal Wooden Brace Struts + Lush Post-Base Green Moss & Ferns!
            for (let i = 0; i < postZList.length - 1; i++) {
                const z0 = postZList[i];
                const z1 = postZList[i + 1];
                const zm = (z0 + z1) * 0.5;
                const bayLen = z1 - z0;

                // Upper & lower horizontal weathered timber log rails (matches thick horizontal poles in eae94aa6.jpg & 11d922c7.jpg!)
                driftwoodParts.push(
                    this.transformGeo(new THREE.CylinderGeometry(0.105, 0.105, bayLen, 8), postX, 1.15, zm, Math.PI * 0.5, 0, 0),
                    this.transformGeo(new THREE.CylinderGeometry(0.082, 0.082, bayLen, 8), postX, 0.48, zm, Math.PI * 0.5, 0, 0)
                );

                // Angled wooden diagonal brace strut tucked cleanly between lower & upper rails (matches 11d922c7.jpg!)
                const diagTilt = (i % 2 === 0) ? 1.42 : -1.42;
                driftwoodParts.push(this.transformGeo(
                    new THREE.CylinderGeometry(0.068, 0.068, bayLen * 0.84, 7),
                    postX - side * 0.04, 0.81, zm,
                    diagTilt, 0, 0
                ));

                // Taut lashed hemp support rope arcing lightly beneath the upper timber rail
                const rCurve = new THREE.CatmullRomCurve3([
                    new THREE.Vector3(postX - side * 0.05, 1.08, z0 + 0.25),
                    new THREE.Vector3(postX - side * 0.05, 0.82, zm),
                    new THREE.Vector3(postX - side * 0.05, 1.08, z1 - 0.25)
                ]);
                ropeParts.push(new THREE.TubeGeometry(rCurve, 6, 0.042, 5, false));

                // Low outer emerald-green moss tufts & hanging vines tucked neatly along the sill (never hiding post bases or braces!)
                if (i % 2 === 0) {
                    edgeMossParts.push(this.transformGeo(
                        this.sharedGeo.shrubCluster.clone(),
                        postX + side * 0.34, -0.04, zm,
                        0, i * 1.3 + side, 0,
                        0.32, 0.24, 0.46
                    ));
                }
                edgeFernParts.push(this.transformGeo(
                    this.sharedGeo.fernRosette.clone(),
                    postX + side * 0.22, 0.04, z0 + 1.15,
                    0, i * 0.9 + side, 0,
                    0.46, 0.42, 0.46
                ));
                if (i % 2 === 0) {
                    vineParts.push(this.transformGeo(
                        new THREE.PlaneGeometry(2.6, 1.35),
                        postX + side * 0.28, -0.32, zm,
                        0, side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 0
                    ));
                }
            }
        });

        chunk.add(new THREE.Mesh(this.mergeGeos(driftwoodParts), this.materials.driftwoodPost));
        chunk.add(new THREE.Mesh(this.mergeGeos(underWoodParts), this.materials.obstacleWood));
        chunk.add(new THREE.Mesh(this.mergeGeos(ropeParts), this.materials.bridgeRope));
        chunk.add(new THREE.Mesh(this.mergeGeos(edgeMossParts), this.materials.leaves1));
        chunk.add(new THREE.Mesh(this.mergeGeos(edgeFernParts), this.materials.fern));

        // Canyon Cliff Shelves + Rich Dark Soil Beds set across a 4.2m misty gorge gap (keeps railing gap open & airy like eae94aa6.jpg!)
        const cliffParts = [];
        const bridgeSoilParts = [];
        const ancientCliffParts = [];
        const glyphParts = [];
        const cliffShrubs = [];

        [-1, 1].forEach((side) => {
            // Solid mossy canyon limestone cliff shelf starting 4.6m outside the bridge railing!
            cliffParts.push(this.transformGeo(
                this.makeTiledBox(18.0, 18.0, this.chunkLength, 0.18),
                side * (roadWidth / 2 + 13.6), -8.92, 0
            ));

            // Continuous rich dark-brown forest soil bed atop the canyon ledge under all bridge trees & ferns!
            bridgeSoilParts.push(this.transformGeo(
                this.makeTiledBox(12.2, 0.85, this.chunkLength, 0.30),
                side * (roadWidth / 2 + 10.8), -0.20, 0
            ));

            // Stepped ancient Mayan cliff-side ruin shrine on both canyon walls
            const rz = side < 0 ? 8.5 : -8.5;
            const rx = side * (roadWidth / 2 + 12.4);
            masonryParts.push(this.transformGeo(this.makeTiledBox(4.4, 2.8, 5.8, 0.28), rx, 1.4, rz, 0, side * 0.1, 0));
            glyphParts.push(this.transformGeo(new THREE.BoxGeometry(3.6, 1.05, 4.8), rx + side * 0.4, 3.25, rz, 0, side * 0.1, 0));

            // Towering 17m Craggy Spiral-Carved Ancient Canyon Cliff Monoliths framing BOTH sides of the bridge!
            const cliffRotY = side < 0 ? 0.06 : (Math.PI - 0.06);
            [-9.5, 9.5].forEach((cz, cIdx) => {
                ancientCliffParts.push(this.transformGeo(
                    this.sharedGeo.spiralCliffWall.clone(),
                    side * (roadWidth / 2 + 21.4 + (cIdx % 2) * 1.1), 0.0, cz,
                    0, cliffRotY + (cIdx === 0 ? -0.05 : 0.05), 0
                ));
            });

            // Lush shrubs along the canyon rim + cliff-top jungle foliage + hanging canyon vines
            for (let b = 0; b < 3; b++) {
                const bz = -14 + b * 14;
                cliffShrubs.push(this.transformGeo(
                    this.sharedGeo.shrubCluster.clone(),
                    side * (roadWidth / 2 + 6.2 + (b % 2) * 1.8), 0.28, bz,
                    0, b * 1.2 + side, 0,
                    1.22, 0.98, 1.22
                ));
                cliffShrubs.push(this.transformGeo(
                    this.sharedGeo.shrubCluster.clone(),
                    side * (roadWidth / 2 + 18.8), 15.0 + (b % 2) * 0.7, -12 + b * 12,
                    0, b * 0.8, 0,
                    3.0, 2.0, 3.0
                ));
            }

            vineParts.push(this.transformGeo(
                this.sharedGeo.cliffVines.clone(),
                side * (roadWidth / 2 + 16.4), 9.4, side < 0 ? -6.5 : 6.5,
                0, side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 0
            ));
        });

        // Merged Colossal 15.5m Sunlit Bayon/Mayan Carved Stone Cliff Face overlooking the bridge (matches eae94aa6.jpg!)
        const faceSide = (index % 2 === 0) ? 1 : -1;
        const bfx = faceSide * (roadWidth / 2 + 11.4);
        const bfy = 0.0;
        const bfz = (faceSide < 0) ? -1.5 : 1.5;
        const bfRot = -faceSide * 0.68;
        const bridgeStatues = [this.transformGeo(this.sharedGeo.guardianFace.clone(), bfx, bfy, bfz, 0, bfRot, 0)];
        const bridgeShadows = [this.transformGeo(this.sharedGeo.guardianShadow.clone(), bfx, bfy, bfz, 0, bfRot, 0)];
        glyphParts.push(this.transformGeo(this.sharedGeo.guardianCrown.clone(), bfx, bfy, bfz, 0, bfRot, 0));
        cliffShrubs.push(this.transformGeo(this.sharedGeo.shrubCluster.clone(), bfx, bfy + 14.1, bfz, 0, bfRot, 0, 2.5, 1.45, 2.3));

        chunk.add(new THREE.Mesh(this.mergeGeos(masonryParts), this.materials.wall));
        chunk.add(new THREE.Mesh(this.mergeGeos(glyphParts), this.materials.glyph));
        chunk.add(new THREE.Mesh(this.mergeGeos(cliffParts), this.materials.canyonCliff));
        chunk.add(new THREE.Mesh(this.mergeGeos(bridgeSoilParts), this.materials.soil));
        chunk.add(new THREE.Mesh(this.mergeGeos(ancientCliffParts), this.materials.ancientCliff));
        chunk.add(new THREE.Mesh(this.mergeGeos(bridgeStatues), this.materials.statueStone));
        chunk.add(new THREE.Mesh(this.mergeGeos(bridgeShadows), this.materials.darkIron));
        chunk.add(new THREE.Mesh(this.mergeGeos(cliffShrubs), this.materials.leaves2));
        chunk.add(new THREE.Mesh(this.mergeGeos(vineParts), this.materials.vines));

        // Every bridge tree sits rooted in sculpted brown soil mounds + mossy rocks + ferns atop the canyon shelf!
        this.buildMahoganyTreesAndFerns(chunk, roadWidth + 8.2, index, false, 0.22);
    }

    // ------------------------------------------------------------
    // BIOME 3: SUBWAY SURFERS METROPOLIS RAILWAY LINES
    // (100% Matches Subway Surfers screenshots e6196d69.jpg, 9468adf5.jpg, 8b0a9d6b.jpg, f565e49c.jpg!)
    // ------------------------------------------------------------
    buildCrystalMineChunk(chunk, roadWidth, index, flameList = []) {
        // 1. Dark Slate Ballast Ground Floor Plane (matches Subway Surfers screenshots!)
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth + 7.5, this.chunkLength), this.materials.mineFloor);
        floor.rotation.x = -Math.PI / 2;
        chunk.add(floor);

        const darkIronParts = [];
        const steelRailParts = [];
        const sidewalkParts = [];
        const curbLineParts = [];
        const windowGlassParts = [];
        const buildingBeigeParts = [];
        const buildingBlueParts = [];
        const buildingCoralParts = [];
        const buildingWhiteParts = [];
        const buildingTealParts = [];
        const awningRedParts = [];
        const awningBlueParts = [];
        const palmTrunkParts = [];
        const palmFrondParts = [];
        const billboardParts = [];
        const gantryParts = [];

        // 2. Profiled 3D Steel I-Rails & 3D Railroad Sleepers along all 3 tracks
        this.lanes.forEach((laneX) => {
            // Dual gleaming steel rails
            [-0.56, 0.56].forEach((railOff) => {
                darkIronParts.push(this.transformGeo(new THREE.BoxGeometry(0.14, 0.05, this.chunkLength), laneX + railOff, 0.03, 0));
                steelRailParts.push(this.transformGeo(new THREE.BoxGeometry(0.09, 0.09, this.chunkLength), laneX + railOff, 0.10, 0));
            });
            // 3D Physical cross-ties (sleepers) spaced along each track
            for (let sz = -this.chunkLength / 2 + 1.2; sz <= this.chunkLength / 2 - 1.0; sz += 1.5) {
                darkIronParts.push(this.transformGeo(new THREE.BoxGeometry(2.1, 0.10, 0.38), laneX, 0.05, sz));
            }
        });

        // 3. Flanking Elevated Sidewalks & Curbing (left: x = -6.4, right: x = +6.4)
        [-1, 1].forEach((side) => {
            const swX = side * 6.4;
            // Concrete sidewalk platform
            sidewalkParts.push(this.transformGeo(new THREE.BoxGeometry(2.6, 0.38, this.chunkLength), swX, 0.19, 0));
            // Yellow safety warning curb edge facing the railway tracks
            curbLineParts.push(this.transformGeo(new THREE.BoxGeometry(0.12, 0.12, this.chunkLength), side * 5.16, 0.38, 0));

            // Tubular steel roadway safety guardrail along the edge of the sidewalk
            const grX = side * 5.25;
            darkIronParts.push(
                this.transformGeo(new THREE.BoxGeometry(0.08, 0.08, this.chunkLength), grX, 0.95, 0),
                this.transformGeo(new THREE.BoxGeometry(0.06, 0.06, this.chunkLength), grX, 0.58, 0)
            );
            for (let pz = -this.chunkLength / 2 + 2; pz <= this.chunkLength / 2 - 2; pz += 5.2) {
                darkIronParts.push(this.transformGeo(new THREE.BoxGeometry(0.10, 0.82, 0.10), grX, 0.54, pz));
            }
        });

        // 4. Modern Metropolitan High-Rise Buildings Flanking Both Sides of the Railway!
        // (Vibrant Subway Surfers color palette: beige, slate blue, coral, clean white, teal)
        const buildingDefs = [
            { z: -14, depth: 13.0, hL: 20.0, hR: 24.0, colL: 'BEIGE', colR: 'BLUE' },
            { z: 0,   depth: 13.5, hL: 26.0, hR: 19.0, colL: 'CORAL', colR: 'WHITE' },
            { z: 14,  depth: 13.0, hL: 18.0, hR: 25.0, colL: 'TEAL',  colR: 'BEIGE' }
        ];

        buildingDefs.forEach((bDef, bIdx) => {
            [-1, 1].forEach((side) => {
                const bH = (side < 0) ? bDef.hL : bDef.hR;
                const bColor = (side < 0) ? bDef.colL : bDef.colR;
                const bWidth = 8.5;
                const bDepth = bDef.depth;
                const bX = side * (7.6 + bWidth / 2);
                const bY = bH / 2;
                const bZ = bDef.z;

                const bGeo = this.transformGeo(new THREE.BoxGeometry(bWidth, bH, bDepth), bX, bY, bZ);
                if (bColor === 'BEIGE') buildingBeigeParts.push(bGeo);
                else if (bColor === 'BLUE') buildingBlueParts.push(bGeo);
                else if (bColor === 'CORAL') buildingCoralParts.push(bGeo);
                else if (bColor === 'WHITE') buildingWhiteParts.push(bGeo);
                else buildingTealParts.push(bGeo);

                // Concrete roofline parapet & cornice trim
                sidewalkParts.push(this.transformGeo(new THREE.BoxGeometry(bWidth + 0.4, 0.5, bDepth + 0.4), bX, bH + 0.25, bZ));

                // Rooftop HVAC chiller unit
                darkIronParts.push(this.transformGeo(new THREE.BoxGeometry(2.4, 1.4, 2.6), bX, bH + 0.9, bZ));
                // Rooftop antenna mast
                darkIronParts.push(this.transformGeo(new THREE.CylinderGeometry(0.04, 0.06, 5.0, 5), bX + side * 1.5, bH + 3.0, bZ + 2.0));

                // Building front facade window grids (reflective glass panels facing tracks)
                const facadeX = side * 7.55;
                const floors = Math.floor((bH - 5.0) / 3.4);
                for (let fl = 0; fl < floors; fl++) {
                    const winY = 4.8 + fl * 3.4;
                    for (let w = -1; w <= 1; w++) {
                        const winZ = bZ + w * 3.6;
                        windowGlassParts.push(this.transformGeo(new THREE.BoxGeometry(0.12, 2.2, 2.4), facadeX, winY, winZ));
                    }
                }

                // Ground-floor storefront awnings (striped canvas projecting over sidewalk)
                const awnGeo = this.transformGeo(new THREE.BoxGeometry(2.4, 0.18, 4.6), side * 6.5, 3.4, bZ, 0, 0, side * 0.32);
                if ((bIdx + (side < 0 ? 0 : 1)) % 2 === 0) awningRedParts.push(awnGeo);
                else awningBlueParts.push(awnGeo);
            });
        });

        // 5. Iconic "SHOW DOWN" & "SUBWAY SURF" Billboard Signs on Building Facades!
        // (Matches Subway Surfers screenshots e6196d69.jpg, 9468adf5.jpg, 8b0a9d6b.jpg!)
        [-1, 1].forEach((side) => {
            const bbX = side * 7.50;
            const bbZ = (side < 0) ? -2.0 : 2.0;
            billboardParts.push(this.transformGeo(new THREE.BoxGeometry(0.16, 4.4, 7.8), bbX, 9.8, bbZ, 0, (side > 0 ? Math.PI : 0), 0));
            // Backing steel support frame
            darkIronParts.push(
                this.transformGeo(new THREE.BoxGeometry(0.24, 4.6, 8.0), side * 7.62, 9.8, bbZ),
                this.transformGeo(new THREE.BoxGeometry(0.12, 1.2, 0.12), bbX, 12.3, bbZ - 2.8),
                this.transformGeo(new THREE.BoxGeometry(0.12, 1.2, 0.12), bbX, 12.3, bbZ + 2.8)
            );
        });

        // 6. Tropical Palm Trees Planted along Sidewalks (Subway Surfers signature city greenery!)
        [-1, 1].forEach((side) => {
            [-12, 12].forEach((pz) => {
                const tx = side * 6.6;
                // Curved trunk leaning slightly toward tracks
                palmTrunkParts.push(this.transformGeo(new THREE.CylinderGeometry(0.20, 0.28, 6.2, 7), tx, 3.2, pz, 0, 0, -side * 0.12));
                // 6 Gracefully fanning palm fronds
                for (let f = 0; f < 6; f++) {
                    const ang = (f / 6) * Math.PI * 2;
                    palmFrondParts.push(this.transformGeo(
                        new THREE.BoxGeometry(0.42, 0.05, 3.2),
                        tx + Math.cos(ang) * 1.3,
                        6.1 - Math.sin(f * 0.8) * 0.3,
                        pz + Math.sin(ang) * 1.3,
                        Math.sin(ang) * 0.35,
                        ang,
                        -Math.cos(ang) * 0.35
                    ));
                }
            });
        });

        // 7. Overhead Railway Electrification Catenary Gantries & Power Cables!
        // (Iconic overhead arches spanning across all 3 tracks every 14m)
        [-14, 14].forEach((gz) => {
            // Twin vertical structural steel pylons on sidewalk edges
            [-5.4, 5.4].forEach((px) => {
                gantryParts.push(
                    this.transformGeo(new THREE.BoxGeometry(0.34, 8.8, 0.34), px, 4.4, gz),
                    this.transformGeo(new THREE.BoxGeometry(0.55, 0.40, 0.55), px, 0.38, gz)
                );
            });
            // Horizontal steel truss crossbeam spanning all 3 tracks
            gantryParts.push(this.transformGeo(new THREE.BoxGeometry(11.4, 0.38, 0.42), 0, 7.6, gz));
            // 45-degree corner gusset braces
            gantryParts.push(
                this.transformGeo(new THREE.BoxGeometry(0.18, 1.8, 0.18), -4.6, 6.9, gz, 0, 0, -Math.PI / 4),
                this.transformGeo(new THREE.BoxGeometry(0.18, 1.8, 0.18),  4.6, 6.9, gz, 0, 0,  Math.PI / 4)
            );
            // 3 Hanging ceramic electrical insulators right above each of the 3 tracks
            this.lanes.forEach((lx) => {
                darkIronParts.push(
                    this.transformGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.55, 8), lx, 7.15, gz),
                    this.transformGeo(new THREE.TorusGeometry(0.10, 0.03, 6, 10), lx, 7.30, gz, Math.PI / 2, 0, 0)
                );
            });
        });

        // 3 Continuous Copper Catenary Power Cables extending along chunk above each of the 3 tracks
        this.lanes.forEach((lx) => {
            darkIronParts.push(this.transformGeo(new THREE.CylinderGeometry(0.016, 0.016, this.chunkLength, 5), lx, 6.85, 0));
        });

        // 8. Parked Subway Trains, Trams & Cargo Boxcars on Side Siding Track under the Sunny Sky!
        const sidingSide = (index % 2 === 0) ? -1 : 1;
        const sidingX = sidingSide * 5.4;
        const sidingStyle = (index % 4 === 0) ? 'SUBWAY' : ((index % 4 === 1) ? 'BLUE_CARGO' : ((index % 4 === 2) ? 'TRAM' : 'CARGO'));

        const sidingParts = {
            subwayBody: [], subwayRedStripe: [], subwayRoof: [], subwayGlass: [],
            subwayHeadlight: [], headlightBeam: [], tramBody: [], tramTeal: [],
            cargoBox: [], blueContainer: [], darkIron: [], steelRail: [], contactShadow: []
        };

        // Siding steel rails & ties underneath the parked train
        [-0.52, 0.52].forEach((ro) => {
            sidingParts.steelRail.push(this.transformGeo(new THREE.BoxGeometry(0.10, 0.09, 15.0), sidingX + ro, 0.12, 0));
            sidingParts.darkIron.push(this.transformGeo(new THREE.BoxGeometry(0.16, 0.08, 15.0), sidingX + ro, 0.04, 0));
        });
        for (let sz = -7.0; sz <= 7.0; sz += 1.4) {
            sidingParts.darkIron.push(this.transformGeo(new THREE.BoxGeometry(1.65, 0.10, 0.28), sidingX, 0.05, sz));
        }

        this.buildTrainCarComponents(sidingParts, null, chunk, sidingX, 0, sidingStyle);

        // Add all merged component meshes to the chunk
        if (darkIronParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(darkIronParts), this.materials.darkIron));
        if (steelRailParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(steelRailParts), this.materials.steelRail));
        if (sidewalkParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(sidewalkParts), this.materials.sidewalkCurb));
        if (curbLineParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(curbLineParts), this.materials.chevronBarrier));
        if (windowGlassParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(windowGlassParts), this.materials.cityWindowGlass));
        if (buildingBeigeParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(buildingBeigeParts), this.materials.cityBuildingBeige));
        if (buildingBlueParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(buildingBlueParts), this.materials.cityBuildingBlue));
        if (buildingCoralParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(buildingCoralParts), this.materials.cityBuildingCoral));
        if (buildingWhiteParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(buildingWhiteParts), this.materials.cityBuildingWhite));
        if (buildingTealParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(buildingTealParts), this.materials.cityBuildingTeal));
        if (awningRedParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(awningRedParts), this.materials.cityAwning));
        if (awningBlueParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(awningBlueParts), this.materials.cityAwningBlue));
        if (palmTrunkParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(palmTrunkParts), this.materials.palmTrunk));
        if (palmFrondParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(palmFrondParts), this.materials.palmFrond));
        if (billboardParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(billboardParts), this.materials.billboardShowdown));
        if (gantryParts.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(gantryParts), this.materials.catenaryGantry));

        Object.keys(sidingParts).forEach((matKey) => {
            const list = sidingParts[matKey];
            if (list.length > 0 && this.materials[matKey]) {
                chunk.add(new THREE.Mesh(this.mergeGeos(list), this.materials[matKey]));
            }
        });
    }

    buildTempleMawPortal(chunk, roadWidth, zOffset) {
        const portal = new THREE.Group();
        portal.position.set(0, 0, zOffset);

        const glyphParts = [
            this.transformGeo(new THREE.BoxGeometry(2.8, 9.0, 3.0), -(roadWidth / 2 + 1.15), 4.5, 0),
            this.transformGeo(new THREE.BoxGeometry(2.8, 9.0, 3.0), (roadWidth / 2 + 1.15), 4.5, 0),
            this.transformGeo(new THREE.BoxGeometry(roadWidth + 5.6, 3.4, 3.2), 0, 9.0, 0)
        ];
        portal.add(new THREE.Mesh(this.mergeGeos(glyphParts), this.materials.glyph));

        // Flanking carved ancient stone temple buttresses & stepped monster-maw brow framing the mine entrance (matches 11d922c7.jpg!)
        const stoneFrameParts = [
            this.transformGeo(this.makeTiledBox(6.4, 12.2, 3.8, 0.24), -(roadWidth / 2 + 4.4), 6.0, -0.3),
            this.transformGeo(this.makeTiledBox(6.4, 12.2, 3.8, 0.24), (roadWidth / 2 + 4.4), 6.0, -0.3),
            this.transformGeo(this.makeTiledBox(3.8, 7.2, 3.4, 0.26), -(roadWidth / 2 + 3.4), 3.6, 0.9),
            this.transformGeo(this.makeTiledBox(3.8, 7.2, 3.4, 0.26), (roadWidth / 2 + 3.4), 3.6, 0.9),
            this.transformGeo(this.makeTiledBox(roadWidth + 8.8, 3.6, 3.4, 0.24), 0, 11.4, -0.4),
            // Angry slanted Mayan monster-maw brow ridges & carved nose keystone above the cave mouth!
            this.transformGeo(this.makeTiledBox(3.8, 0.90, 1.5, 0.28), -2.25, 8.35, 1.45, 0, 0, -0.22),
            this.transformGeo(this.makeTiledBox(3.8, 0.90, 1.5, 0.28), 2.25, 8.35, 1.45, 0, 0, 0.22),
            this.transformGeo(this.makeTiledBox(1.65, 2.25, 1.7, 0.28), 0, 8.55, 1.55)
        ];
        portal.add(new THREE.Mesh(this.mergeGeos(stoneFrameParts), this.materials.statueStone));

        // Glowing emerald-aqua Mayan guardian eyes set beneath the monster-maw brow!
        const portalEyeParts = [
            this.transformGeo(new THREE.SphereGeometry(0.56, 10, 8), -2.15, 7.68, 1.48, 0, 0, -0.18, 1.35, 0.62, 0.55),
            this.transformGeo(new THREE.SphereGeometry(0.56, 10, 8), 2.15, 7.68, 1.48, 0, 0, 0.18, 1.35, 0.62, 0.55)
        ];
        portal.add(new THREE.Mesh(this.mergeGeos(portalEyeParts), this.materials.emeraldCrystal));

        const crestParts = [
            this.transformGeo(this.makeTiledBox(roadWidth * 0.82, 2.2, 2.8, 0.26), 0, 11.6, 0.5),
            this.transformGeo(this.makeTiledBox(roadWidth * 0.52, 1.6, 2.2, 0.26), 0, 13.3, 0.5)
        ];
        portal.add(new THREE.Mesh(this.mergeGeos(crestParts), this.materials.wall));

        const fangParts = [];
        for (let fx = -roadWidth * 0.42; fx <= roadWidth * 0.42; fx += 1.65) {
            fangParts.push(this.transformGeo(new THREE.ConeGeometry(0.32, 0.95, 5), fx, 6.95, 0.85, Math.PI, 0, 0));
        }
        portal.add(new THREE.Mesh(this.mergeGeos(fangParts), this.materials.curb));

        const vineCurtain = new THREE.Mesh(this.sharedGeo.archVines, this.materials.vines);
        vineCurtain.position.set(0, -0.3, 0.9);
        portal.add(vineCurtain);

        chunk.add(portal);
    }

    buildSideAqueductArches(chunk, roadWidth, index) {
        const archParts = [
            this.transformGeo(this.sharedGeo.sideArch.clone(), roadWidth / 2 + 5.0, 0.42, -5.5, 0, -0.42, 0),
            this.transformGeo(this.sharedGeo.sideArch.clone(), -(roadWidth / 2 + 5.0), 0.42, 7.5, 0, 0.42, 0)
        ];

        if (index % 3 === 2) {
            archParts.push(this.transformGeo(this.sharedGeo.overArch.clone(), 0, 0, 10));
            const vines = new THREE.Mesh(this.sharedGeo.archVines, this.materials.vines);
            vines.position.set(0, 0, 10);
            chunk.add(vines);
        }

        chunk.add(new THREE.Mesh(this.mergeGeos(archParts), this.materials.pillarWall));
    }

    buildMahoganyTreesAndFerns(chunk, roadWidth, index, includeGroundFerns = true, baseY = 0.42) {
        const leafMats = [this.materials.leaves1, this.materials.leaves2, this.materials.leaves3];
        const soilGeos = [];
        const stoneGeos = [];
        const woodGeos = [];
        const coreGeos = [];
        const crownBuckets = [[], [], []];
        const fernGeos = [];
        const boughVineGeos = [];
        const shadowGeos = [];

        [-1, 1].forEach((side, sIdx) => {
            const key = side < 0 ? 'Left' : 'Right';
            const woodGeo = this.sharedGeo['treeWood' + key];
            const coreGeo = this.sharedGeo['treeCore' + key];
            const canopyGeo = this.sharedGeo['treeCanopy' + key];

            for (let t = 0; t < 2; t++) {
                const tz = -14 + t * 24 + (sIdx * 5);
                const tx = side * (roadWidth / 2 + 3.85 + t * 1.35);
                const moundRot = (index * 1.3 + t * 2.1 + sIdx * 0.9);

                // 1. Rich dark-brown sculpted organic soil mound + mossy border stones directly under EVERY tree!
                soilGeos.push(this.transformGeo(
                    this.sharedGeo.treeSoilMound.clone(),
                    tx, baseY, tz,
                    0, moundRot, 0
                ));
                stoneGeos.push(this.transformGeo(
                    this.sharedGeo.treeSoilStones.clone(),
                    tx, baseY + 0.08, tz,
                    0, moundRot + 0.4, 0
                ));

                // 2. Mahogany trunk & 5 spreading buttress roots plunging visibly into the soil mound!
                const treeY = baseY + 0.34;
                woodGeos.push(this.transformGeo(woodGeo.clone(), tx, treeY, tz));
                coreGeos.push(this.transformGeo(coreGeo.clone(), tx, treeY, tz));

                const matIdx = (index + t + sIdx) % 3;
                crownBuckets[matIdx].push(this.transformGeo(canopyGeo.clone(), tx, treeY, tz));

                // Soft dappled tree-canopy sunlight shadow cast across the causeway road!
                if (includeGroundFerns) {
                    shadowGeos.push(this.transformGeo(
                        this.sharedGeo.shadowQuad.clone(),
                        side * (roadWidth * 0.24), 0.02, tz + 0.5,
                        0, 0, 0,
                        4.8, 1.0, 5.6
                    ));
                }

                // 3. Ferns sprouting right out of the dark brown tree soil bed around the roots!
                fernGeos.push(this.transformGeo(
                    this.sharedGeo.fernRosette.clone(),
                    tx - side * 1.55, baseY + 0.36, tz + 1.15,
                    0, moundRot, 0,
                    1.08, 1.05, 1.08
                ));
                fernGeos.push(this.transformGeo(
                    this.sharedGeo.fernRosette.clone(),
                    tx + side * 0.85, baseY + 0.32, tz - 1.45,
                    0, moundRot + 1.7, 0,
                    0.95, 0.95, 0.95
                ));
            }

            if (includeGroundFerns) {
                for (let f = 0; f < 3; f++) {
                    const fx = side * (roadWidth / 2 + 1.68);
                    const fz = -16 + f * 15;
                    fernGeos.push(this.transformGeo(
                        this.sharedGeo.fernRosette.clone(),
                        fx, baseY + 0.44, fz,
                        0, f * 0.8 + sIdx, 0
                    ));
                }
            }
        });

        if (soilGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(soilGeos), this.materials.soil));
        if (stoneGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(stoneGeos), this.materials.canyonCliff));
        if (woodGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(woodGeos), this.materials.mahoganyBark));
        if (coreGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(coreGeos), this.materials.canopyCore));
        crownBuckets.forEach((bucket, mIdx) => {
            if (bucket.length > 0) {
                chunk.add(new THREE.Mesh(this.mergeGeos(bucket), leafMats[mIdx]));
            }
        });
        if (fernGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(fernGeos), this.materials.fern));
        if (boughVineGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(boughVineGeos), this.materials.vines));
        if (shadowGeos.length > 0) chunk.add(new THREE.Mesh(this.mergeGeos(shadowGeos), this.materials.contactShadow));
    }

    buildColossalGuardianHead(chunk, x, y, z, rotY) {
        const head = new THREE.Group();
        head.position.set(x, y, z);
        head.rotation.y = rotY;
        head.add(new THREE.Mesh(this.sharedGeo.guardianFace, this.materials.guardianStone));
        head.add(new THREE.Mesh(this.sharedGeo.guardianShadow, this.materials.darkIron));
        head.add(new THREE.Mesh(this.sharedGeo.guardianCrown, this.materials.glyph));
        const mossCap = new THREE.Mesh(this.sharedGeo.shrubCluster, this.materials.leaves1);
        mossCap.position.set(0, 14.1, -0.2);
        mossCap.scale.set(2.4, 1.4, 2.2);
        head.add(mossCap);
        chunk.add(head);
    }

    buildIronFireBraziers(chunk, roadWidth, zCenter, flameList = []) {
        const pedParts = [];
        const bowlParts = [];
        const coalParts = [];
        [-1, 1].forEach((side) => {
            const bx = side * (roadWidth / 2 + 0.42);
            pedParts.push(this.transformGeo(new THREE.BoxGeometry(0.92, 0.68, 0.92), bx, 1.38, zCenter));
            pedParts.push(this.transformGeo(new THREE.BoxGeometry(1.06, 0.16, 1.06), bx, 1.76, zCenter));
            bowlParts.push(this.transformGeo(new THREE.CylinderGeometry(0.86, 0.38, 0.56, 16), bx, 2.05, zCenter));
            bowlParts.push(this.transformGeo(new THREE.TorusGeometry(0.86, 0.07, 7, 16), bx, 2.32, zCenter, Math.PI * 0.5, 0, 0));
            coalParts.push(this.transformGeo(new THREE.CylinderGeometry(0.78, 0.78, 0.10, 16), bx, 2.30, zCenter));

            const plume = this.createFlamePlume(1.75, 1.38);
            plume.position.set(bx, 2.20, zCenter);
            chunk.add(plume);
            flameList.push({ flame: plume, baseScale: 1.38 });
        });
        chunk.add(new THREE.Mesh(this.mergeGeos(pedParts), this.materials.wall));
        chunk.add(new THREE.Mesh(this.mergeGeos(bowlParts), this.materials.darkIron));
        chunk.add(new THREE.Mesh(this.mergeGeos(coalParts), this.materials.emberCoal));
    }

    // ============================================================
    // AUTHENTIC TIKTOK VIDEO TRAP BUILDERS (PRE-POOLED & MERGED)
    // ============================================================

    buildFireHurdle(zPos) {
        const fireTrap = new THREE.Group();
        fireTrap.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 0.5;

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(roadSpan + 0.9, 1, 2.2);
        sh.position.y = 0.02;
        fireTrap.add(sh);

        const baseBar = new THREE.Mesh(new THREE.BoxGeometry(roadSpan, 0.42, 0.92), this.materials.hurdleBlue);
        baseBar.position.y = 0.21;
        fireTrap.add(baseBar);

        const topBevel = new THREE.Mesh(new THREE.BoxGeometry(roadSpan + 0.14, 0.12, 1.0), this.materials.hurdleCyan);
        topBevel.position.y = 0.45;
        fireTrap.add(topBevel);

        const ironParts = [];
        const coalParts = [];
        [-roadSpan * 0.5, -roadSpan * 0.17, roadSpan * 0.17, roadSpan * 0.5].forEach((bx) => {
            ironParts.push(this.transformGeo(new THREE.BoxGeometry(0.36, 0.58, 1.08), bx, 0.29, 0));
        });

        const flameFlakes = [];
        const flameCount = 7;
        const stepX = roadSpan / (flameCount + 1);

        for (let f = 1; f <= flameCount; f++) {
            const fx = -roadSpan / 2 + f * stepX;
            ironParts.push(this.transformGeo(new THREE.CylinderGeometry(0.30, 0.34, 0.11, 10), fx, 0.49, 0));
            coalParts.push(this.transformGeo(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 10), fx, 0.54, 0));

            const hScale = 1.15 + ((f * 3) % 4) * 0.06;
            const plume = this.createFlamePlume(0.86, hScale);
            plume.position.set(fx, 0.46, 0);
            fireTrap.add(plume);
            flameFlakes.push(plume);
        }
        fireTrap.add(new THREE.Mesh(this.mergeGeos(ironParts), this.materials.darkIron));
        fireTrap.add(new THREE.Mesh(this.mergeGeos(coalParts), this.materials.emberCoal));

        return {
            type: 'JUMP',
            subType: 'FIRE_HURDLE',
            group: fireTrap,
            flames: flameFlakes,
            hasFireGlow: true,
            worldZ: zPos,
            requiredAction: 'JUMP',
            label: 'JUMP!',
            color: '#FF6600',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.55,
            lane: 'ALL'
        };
    }

    buildSpikedRoller(zPos) {
        const rollerTrap = new THREE.Group();
        rollerTrap.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 0.9;

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(roadSpan + 0.6, 1, 2.1);
        sh.position.y = 0.02;
        rollerTrap.add(sh);

        const spinner = new THREE.Group();
        spinner.position.y = 0.72;

        // Heavy bark-textured timber log bound with forged iron hoops & gleaming steel spikes!
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, roadSpan, 14), this.materials.obstacleWood);
        drum.rotation.z = Math.PI / 2;
        spinner.add(drum);

        const hoopParts = [];
        const spikeParts = [];
        for (let rx = -roadSpan * 0.42; rx <= roadSpan * 0.42; rx += roadSpan / 7.5) {
            hoopParts.push(this.transformGeo(new THREE.TorusGeometry(0.46, 0.065, 6, 12), rx, 0, 0, 0, Math.PI / 2, 0));
            for (let a = 0; a < 6; a++) {
                const ang = (a / 6) * Math.PI * 2;
                spikeParts.push(this.transformGeo(new THREE.ConeGeometry(0.135, 0.62, 5), rx, Math.cos(ang) * 0.68, Math.sin(ang) * 0.68, ang, 0, 0));
            }
        }
        spinner.add(new THREE.Mesh(this.mergeGeos(hoopParts), this.materials.darkIron));
        spinner.add(new THREE.Mesh(this.mergeGeos(spikeParts), this.materials.spikes));
        rollerTrap.add(spinner);

        const mountParts = [
            this.transformGeo(new THREE.BoxGeometry(0.75, 1.32, 0.95), -(roadSpan * 0.5 + 0.2), 0.66, 0),
            this.transformGeo(new THREE.BoxGeometry(0.75, 1.32, 0.95), (roadSpan * 0.5 + 0.2), 0.66, 0)
        ];
        rollerTrap.add(new THREE.Mesh(this.mergeGeos(mountParts), this.materials.wall));

        return {
            type: 'JUMP',
            subType: 'SPIKED_ROLLER',
            group: rollerTrap,
            spinnerMesh: spinner,
            worldZ: zPos,
            requiredAction: 'JUMP',
            label: 'JUMP!',
            color: '#FF6600',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.55,
            lane: 'ALL'
        };
    }

    buildTreeRoots(zPos) {
        return this.buildSpikedRoller(zPos);
    }

    // AUTHENTIC TIKTOK CRYSTAL MINE FLOOR BUZZSAW TRAP (00:24-00:25 in TikTok!)
    buildMineSawblade(zPos) {
        const sawGroup = new THREE.Group();
        sawGroup.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 0.8;

        // Dark recessed floor slot + heavy riveted iron slot lips across all 3 minecart tracks!
        const slotVoid = new THREE.Mesh(new THREE.PlaneGeometry(roadSpan - 0.3, 1.05), this.materials.voidBlack);
        slotVoid.rotation.x = -Math.PI * 0.5;
        slotVoid.position.y = 0.03;
        sawGroup.add(slotVoid);

        const housingParts = [
            this.transformGeo(new THREE.BoxGeometry(roadSpan + 0.3, 0.30, 0.36), 0, 0.15, 0.62),
            this.transformGeo(new THREE.BoxGeometry(roadSpan + 0.3, 0.30, 0.36), 0, 0.15, -0.62),
            this.transformGeo(new THREE.BoxGeometry(0.95, 0.56, 1.65), -(roadSpan * 0.5), 0.28, 0),
            this.transformGeo(new THREE.BoxGeometry(0.95, 0.56, 1.65), (roadSpan * 0.5), 0.28, 0)
        ];
        sawGroup.add(new THREE.Mesh(this.mergeGeos(housingParts), this.materials.darkIron));

        const lipTrimParts = [
            this.transformGeo(new THREE.BoxGeometry(roadSpan, 0.08, 0.18), 0, 0.32, 0.52),
            this.transformGeo(new THREE.BoxGeometry(roadSpan, 0.08, 0.18), 0, 0.32, -0.52)
        ];
        sawGroup.add(new THREE.Mesh(this.mergeGeos(lipTrimParts), this.materials.steelRail));

        // Colossal transverse buzzsaw + flanking side cog-saws spinning in X-Y across the track (matches 00:24!)
        const makeBuzzsawWheel = (cx, cy, cz, r, toothCount) => {
            const w = new THREE.Group();
            w.position.set(cx, cy, cz);

            const bladeParts = [
                this.transformGeo(new THREE.CylinderGeometry(r, r, 0.11, 28), 0, 0, 0, Math.PI * 0.5, 0, 0)
            ];
            for (let t = 0; t < toothCount; t++) {
                const ang = (t / toothCount) * Math.PI * 2;
                const tx = Math.cos(ang) * (r + 0.14);
                const ty = Math.sin(ang) * (r + 0.14);
                // Hooked shark-fin saw tooth canted forward along spin direction!
                bladeParts.push(this.transformGeo(
                    new THREE.ConeGeometry(0.18, 0.46, 4),
                    tx, ty, 0,
                    0, 0, ang - Math.PI * 0.5 - 0.42,
                    1.0, 1.0, 0.36
                ));
            }
            w.add(new THREE.Mesh(this.mergeGeos(bladeParts), this.materials.spikes));

            const hubParts = [
                this.transformGeo(new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.17, 18), 0, 0, 0, Math.PI * 0.5, 0, 0),
                this.transformGeo(new THREE.TorusGeometry(r * 0.72, 0.06, 6, 20), 0, 0, 0)
            ];
            w.add(new THREE.Mesh(this.mergeGeos(hubParts), this.materials.darkIron));
            w.add(new THREE.Mesh(
                this.transformGeo(new THREE.CylinderGeometry(r * 0.18, r * 0.18, 0.22, 12), 0, 0, 0, Math.PI * 0.5, 0, 0),
                this.materials.emberCoal
            ));
            sawGroup.add(w);
            return w;
        };

        const centerSaw = makeBuzzsawWheel(0, -0.04, 0, 1.48, 20);
        const leftSaw = makeBuzzsawWheel(-this.laneWidth * 1.02, -0.10, -0.16, 1.16, 16);
        const rightSaw = makeBuzzsawWheel(this.laneWidth * 1.02, -0.10, 0.16, 1.16, 16);

        return {
            type: 'JUMP',
            subType: 'MINE_SAWBLADE',
            group: sawGroup,
            sawWheelsZ: [centerSaw, leftSaw, rightSaw],
            worldZ: zPos,
            requiredAction: 'JUMP',
            label: 'JUMP!',
            color: '#FF6600',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.6,
            lane: 'ALL'
        };
    }

    buildChasmGap(zPos) {
        const chasmTrap = new THREE.Group();
        chasmTrap.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 1.5;
        const gapLength = 4.0;

        const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(roadSpan, gapLength), this.materials.voidBlack);
        voidMesh.rotation.x = -Math.PI / 2;
        voidMesh.position.y = 0.04;
        chasmTrap.add(voidMesh);

        // Jagged fractured sandstone blocks + tilted collapsed slabs plunging into the abyss!
        const lipParts = [];
        const slabParts = [];
        [-1, 1].forEach((dir) => {
            const edgeZ = dir * (gapLength / 2);
            for (let x = -roadSpan / 2 + 0.55; x <= roadSpan / 2 - 0.55; x += 1.18) {
                lipParts.push(this.transformGeo(new THREE.BoxGeometry(1.02, 0.30, 0.52), x, 0.14, edgeZ, 0, (x * 0.2) % 0.3, 0));
                slabParts.push(this.transformGeo(
                    new THREE.BoxGeometry(0.92, 0.18, 0.95),
                    x, 0.08, edgeZ - dir * 0.42,
                    dir * 0.52, 0, (x % 2 === 0 ? 0.08 : -0.08)
                ));
            }
        });
        chasmTrap.add(new THREE.Mesh(this.mergeGeos(lipParts), this.materials.curb));
        chasmTrap.add(new THREE.Mesh(this.mergeGeos(slabParts), this.materials.wall));

        return {
            type: 'JUMP',
            subType: 'CHASM_GAP',
            group: chasmTrap,
            worldZ: zPos,
            requiredAction: 'JUMP',
            label: 'JUMP!',
            color: '#FF6600',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.75,
            lane: 'ALL'
        };
    }

    buildOverheadFlameTrap(zPos) {
        const gate = new THREE.Group();
        gate.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 1.5;

        const pillarParts = [
            this.transformGeo(new THREE.BoxGeometry(1.7, 6.2, 1.8), -(roadSpan * 0.5 + 0.5), 3.1, 0),
            this.transformGeo(new THREE.BoxGeometry(1.7, 6.2, 1.8), (roadSpan * 0.5 + 0.5), 3.1, 0)
        ];
        gate.add(new THREE.Mesh(this.mergeGeos(pillarParts), this.materials.pillarWall));

        const topBeam = new THREE.Mesh(new THREE.BoxGeometry(roadSpan + 3.2, 1.4, 2.0), this.materials.glyph);
        topBeam.position.set(0, 6.5, 0);
        gate.add(topBeam);

        // Sculpted Snarling Mayan Dragon / Jaguar Gargoyle Head with Horns, Fangs & Glowing Eyes!
        const gx = -roadSpan * 0.5 + 0.48;
        const gargParts = [
            this.transformGeo(new THREE.BoxGeometry(1.75, 1.72, 1.85), gx, 2.28, 0),
            this.transformGeo(new THREE.BoxGeometry(1.32, 0.62, 1.55), gx + 0.96, 2.60, 0, 0, 0, -0.08),
            this.transformGeo(new THREE.BoxGeometry(1.18, 0.44, 1.38), gx + 0.88, 1.64, 0, 0, 0, 0.14),
            this.transformGeo(new THREE.BoxGeometry(0.55, 0.38, 1.92), gx + 0.65, 2.92, 0, 0, 0, -0.22)
        ];
        gate.add(new THREE.Mesh(this.mergeGeos(gargParts), this.materials.glyph));

        const hornAndMawParts = [
            this.transformGeo(new THREE.ConeGeometry(0.28, 1.15, 6), gx + 0.05, 3.48, 0.68, -0.28, 0, 0.48),
            this.transformGeo(new THREE.ConeGeometry(0.28, 1.15, 6), gx + 0.05, 3.48, -0.68, 0.28, 0, 0.48),
            this.transformGeo(new THREE.BoxGeometry(1.1, 0.52, 1.18), gx + 0.82, 2.14, 0)
        ];
        gate.add(new THREE.Mesh(this.mergeGeos(hornAndMawParts), this.materials.darkIron));

        const fangParts = [
            this.transformGeo(new THREE.ConeGeometry(0.13, 0.42, 5), gx + 1.42, 2.16, 0.52, Math.PI, 0, 0),
            this.transformGeo(new THREE.ConeGeometry(0.13, 0.42, 5), gx + 1.42, 2.16, -0.52, Math.PI, 0, 0),
            this.transformGeo(new THREE.ConeGeometry(0.11, 0.34, 5), gx + 1.10, 2.18, 0.56, Math.PI, 0, 0),
            this.transformGeo(new THREE.ConeGeometry(0.11, 0.34, 5), gx + 1.10, 2.18, -0.56, Math.PI, 0, 0)
        ];
        gate.add(new THREE.Mesh(this.mergeGeos(fangParts), this.materials.curb));

        const glowParts = [
            this.transformGeo(new THREE.SphereGeometry(0.19, 8, 8), gx + 0.72, 2.74, 0.88),
            this.transformGeo(new THREE.SphereGeometry(0.19, 8, 8), gx + 0.72, 2.74, -0.88),
            this.transformGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10), gx + 1.05, 2.14, 0, 0, 0, Math.PI / 2)
        ];
        gate.add(new THREE.Mesh(this.mergeGeos(glowParts), this.materials.emberCoal));

        // 1 Seamless Continuous Pressurized Horizontal GLSL Blowtorch Stream across all 3 lanes!
        const fireStream = new THREE.Mesh(this.sharedGeo.flameJetMerged, this.materials.fireJetShader);
        fireStream.position.set(gx + 1.08, 2.14, 0);
        gate.add(fireStream);

        return {
            type: 'DUCK',
            subType: 'OVERHEAD_FLAME',
            group: gate,
            hasFireGlow: true,
            worldZ: zPos,
            requiredAction: 'DUCK',
            label: 'DUCK / SQUAT!',
            color: '#00E5FF',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.55,
            lane: 'ALL'
        };
    }

    // Zero-allocation parallel-rope pendulum kinematics for the Twin Swinging Battering Logs Trap!
    setClashingLogsPose(trap, theta) {
        const cfg = trap.clashingLogs;
        if (!cfg) return;
        const dx = cfg.ropeLen * Math.sin(theta);
        const dy = cfg.ropeLen * (1.0 - Math.cos(theta));

        cfg.leftBody.position.set(-dx, cfg.closedY + dy, 0);
        cfg.rightBody.position.set(dx, cfg.closedY + dy, 0);

        cfg.leftInnerRope.rotation.z = -theta;
        cfg.leftOuterRope.rotation.z = -theta;
        cfg.rightInnerRope.rotation.z = theta;
        cfg.rightOuterRope.rotation.z = theta;

        cfg.leftShadow.position.x = -cfg.halfCenter - dx;
        cfg.rightShadow.position.x = cfg.halfCenter + dx;
    }

    // AUTHENTIC TIKTOK TWIN PENDULUM SWINGING / CLASHING BATTERING LOGS TRAP (00:05 & 00:12 in TikTok!)
    buildSpikedLintel(zPos) {
        const logGroup = new THREE.Group();
        logGroup.position.set(0, 0, zPos);

        const logLen = 5.36;
        const innerGap = 0.014;
        const halfCenter = innerGap + 0.12 + logLen * 0.5; // 2.814m from road center when slammed together
        const closedY = 2.08; // Standing eye/head height (1.85m..2.32m) hits it; ducking (0.90m..1.16m) clears cleanly!
        const ropeLen = 10.60;
        const knotLocalY = 0.58;
        const overheadAnchorY = closedY + knotLocalY + ropeLen;

        const makeSuspendedRopePivot = (anchorX) => {
            const pivot = new THREE.Group();
            pivot.position.set(anchorX, overheadAnchorY, 0);

            const rParts = [
                // Main taut braided hemp suspension rope descending from overhead canopy
                this.transformGeo(new THREE.CylinderGeometry(0.052, 0.056, ropeLen, 8), 0, -ropeLen * 0.5, 0),
                // Signature chunky monkey-fist / hangman rope knot 1.15m above the log (matching 708ed2d4.jpg!)
                this.transformGeo(new THREE.SphereGeometry(0.115, 8, 7), 0, -(ropeLen - 1.15), 0, 0, 0, 0, 1.05, 1.35, 1.05),
                this.transformGeo(new THREE.TorusGeometry(0.088, 0.038, 6, 10), 0, -(ropeLen - 1.03), 0, Math.PI * 0.5, 0, 0),
                this.transformGeo(new THREE.TorusGeometry(0.088, 0.038, 6, 10), 0, -(ropeLen - 1.27), 0, Math.PI * 0.5, 0, 0)
            ];
            pivot.add(new THREE.Mesh(this.mergeGeos(rParts), this.materials.rope));
            logGroup.add(pivot);
            return pivot;
        };

        const buildSingleSwingingLog = (side) => {
            const body = new THREE.Group();
            const centerX = side * halfCenter;

            // 1. Organically sculpted, rough-bark tapered tree trunk (r=0.50m at cut inner end -> r=0.59m at outer end)
            const cyl = new THREE.CylinderGeometry(0.50, 0.59, logLen, 16, 8, true);
            const cp = cyl.attributes.position;
            const cuv = cyl.attributes.uv;
            for (let i = 0; i < cp.count; i++) {
                let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
                const ang = Math.atan2(z, x);
                const along = y / logLen; // -0.5 .. +0.5
                const ridge = 1.0 + 0.045 * Math.sin(ang * 6.0 + along * 5.0) + 0.032 * Math.cos(ang * 3.0 - along * 8.0);
                const camber = Math.sin((along + 0.5) * Math.PI) * 0.045;
                cp.setXYZ(i, x * ridge, y, z * ridge + camber);
                // Match mahoganyBark's horizontal stroke orientation so bark furrows run purely along the log!
                cuv.setXY(i, (along + 0.5) * 1.4, (ang / (Math.PI * 2) + 0.5) * 1.4);
            }
            cyl.computeVertexNormals();
            const woodGeo = this.transformGeo(cyl, centerX, 0, 0, 0, 0, side * Math.PI * 0.5);
            body.add(new THREE.Mesh(woodGeo, this.materials.mahoganyBark));

            // 2. Axe-hewn beveled golden-cream sapwood & ring-grained heartwood ends (clearly visible from front & side, matching 708ed2d4.jpg!)
            const innerTipX = side * innerGap;
            const innerChamferCenter = side * (innerGap + 0.065);
            const outerX = side * (innerGap + 0.12 + logLen);
            const capParts = [
                this.transformGeo(new THREE.CylinderGeometry(0.42, 0.505, 0.13, 16, 1, true), innerChamferCenter, 0, 0, 0, 0, side * Math.PI * 0.5),
                this.transformGeo(new THREE.CircleGeometry(0.425, 16), innerTipX, 0, 0, 0, -side * Math.PI * 0.5, 0),
                this.transformGeo(new THREE.CircleGeometry(0.59, 16), outerX, 0, 0, 0, side * Math.PI * 0.5, 0)
            ];
            body.add(new THREE.Mesh(this.mergeGeos(capParts), this.materials.logEnd));

            // 3. Heavy triple-coiled braided hemp rope lashings + top hitch collars at inner & outer stations!
            const lashingParts = [];
            [
                [side * 0.72, 0.515],
                [side * 4.42, 0.575]
            ].forEach(([lx, rad]) => {
                [-0.095, 0, 0.095].forEach((off) => {
                    lashingParts.push(this.transformGeo(
                        new THREE.TorusGeometry(rad + 0.032, 0.050, 7, 16),
                        lx + off, 0, 0,
                        0, Math.PI * 0.5, 0
                    ));
                });
                // Chunky knotted hitch loop right on top of the log where the vertical rope attaches
                lashingParts.push(this.transformGeo(new THREE.SphereGeometry(0.11, 8, 6), lx, knotLocalY, 0, 0, 0, 0, 1.25, 0.9, 1.15));
                lashingParts.push(this.transformGeo(new THREE.TorusGeometry(0.09, 0.036, 6, 10), lx, knotLocalY + 0.04, 0, Math.PI * 0.5, 0, 0));
            });
            body.add(new THREE.Mesh(this.mergeGeos(lashingParts), this.materials.rope));

            // 4. 3D Criss-Crossing Jungle Liana Vine Coils + Lush Leaf Sprigs wrapped boldly ON TOP of the bark!
            const vineParts = [];
            [
                [1.38, 2.38, 2.15, 0.35],
                [1.52, 2.22, -2.05, 2.45]
            ].forEach(([startDist, spanDist, turns, phase]) => {
                const pts = [];
                for (let s = 0; s <= 16; s++) {
                    const t = s / 16;
                    const vx = side * (startDist + t * spanDist);
                    const r = 0.578 + t * 0.036;
                    const a = t * Math.PI * turns + phase;
                    pts.push(new THREE.Vector3(vx, Math.sin(a) * r, Math.cos(a) * r + 0.02));
                }
                vineParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.052, 6, false));
            });
            body.add(new THREE.Mesh(this.mergeGeos(vineParts), this.materials.lianaVine));

            const leafSprigs = [];
            [1.65, 2.25, 2.85, 3.45].forEach((ld, idx) => {
                const lx = side * ld;
                const zSide = (idx % 2 === 0) ? 0.34 : -0.28;
                leafSprigs.push(this.transformGeo(
                    new THREE.PlaneGeometry(1.18, 0.98),
                    lx, 0.64 + (idx % 2) * 0.08, zSide,
                    zSide > 0 ? -0.28 : 0.28, side * 0.22, (idx % 2 === 0 ? 0.35 : -0.35)
                ));
            });
            body.add(new THREE.Mesh(this.mergeGeos(leafSprigs), this.materials.leaves1));

            logGroup.add(body);
            return body;
        };

        const leftBody = buildSingleSwingingLog(-1);
        const rightBody = buildSingleSwingingLog(1);

        const leftInnerRope = makeSuspendedRopePivot(-0.72);
        const leftOuterRope = makeSuspendedRopePivot(-4.42);
        const rightInnerRope = makeSuspendedRopePivot(0.72);
        const rightOuterRope = makeSuspendedRopePivot(4.42);

        const leftShadow = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        leftShadow.scale.set(5.2, 1, 1.65);
        leftShadow.position.set(-halfCenter, 0.02, 0);
        const rightShadow = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        rightShadow.scale.set(5.2, 1, 1.65);
        rightShadow.position.set(halfCenter, 0.02, 0);
        logGroup.add(leftShadow, rightShadow);

        const trapObj = {
            type: 'DUCK',
            subType: 'SPIKED_LINTEL',
            group: logGroup,
            clashingLogs: {
                leftBody,
                rightBody,
                leftInnerRope,
                leftOuterRope,
                rightInnerRope,
                rightOuterRope,
                leftShadow,
                rightShadow,
                closedY,
                ropeLen,
                halfCenter
            },
            clashed: false,
            clashTimer: 0,
            worldZ: zPos,
            requiredAction: 'DUCK',
            label: 'DUCK / SQUAT!',
            color: '#00E5FF',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.55,
            lane: 'ALL'
        };

        this.setClashingLogsPose(trapObj, 0.30);
        return trapObj;
    }

    buildStoneArchGate(zPos, forceMine = null) {
        const gateGroup = new THREE.Group();
        gateGroup.position.set(0, 0, zPos);

        const roadSpan = this.laneWidth * 3 + 1.6;
        const inMine = (forceMine !== null) ? forceMine : (this.getBiomeAtZ(zPos) === 'MINE');

        if (inMine) {
            // AUTHENTIC TIKTOK CRYSTAL MINE OVERHEAD TROLLEY CROSS-GIRDER BARRICADE (00:20-00:21 in TikTok!)
            const girderW = roadSpan - 0.8;
            const ironParts = [
                // Main riveted steel box-girder beam spanning across the 3 minecart tracks
                this.transformGeo(new THREE.BoxGeometry(girderW, 0.78, 0.82), 0, 2.34, 0)
            ];
            const steelParts = [
                this.transformGeo(new THREE.BoxGeometry(girderW + 0.16, 0.14, 0.96), 0, 1.88, 0),
                this.transformGeo(new THREE.BoxGeometry(girderW + 0.16, 0.14, 0.96), 0, 2.78, 0)
            ];

            // 7 Vertical I-beam web stiffener ribs across the girder face (matches [ | | | | | ] at 00:21!)
            for (let r = -3; r <= 3; r++) {
                const rx = r * (girderW / 7.4);
                steelParts.push(this.transformGeo(new THREE.BoxGeometry(0.18, 0.76, 0.92), rx, 2.34, 0));
            }

            // Twin elevated side minecart trolley carriages + overhead steel guide rails + roof chains!
            [-1, 1].forEach((side) => {
                const tx = side * (roadSpan * 0.5 - 0.12);
                // Side trolley tub & hanger bracket
                ironParts.push(
                    this.transformGeo(new THREE.BoxGeometry(1.18, 0.58, 1.52), tx, 1.98, 0),
                    this.transformGeo(new THREE.BoxGeometry(0.42, 0.92, 0.55), tx - side * 0.35, 2.34, 0),
                    // Overhead pulley chains rising to cavern ceiling
                    this.transformGeo(new THREE.CylinderGeometry(0.055, 0.055, 5.8, 6), tx, 5.25, -0.35),
                    this.transformGeo(new THREE.CylinderGeometry(0.055, 0.055, 5.8, 6), tx, 5.25, 0.35)
                );
                // Elevated side guide rail + 2 flanged trolley wheels
                steelParts.push(
                    this.transformGeo(new THREE.BoxGeometry(0.24, 0.16, 4.8), tx, 1.52, 0),
                    this.transformGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), tx, 1.66, 0.52, 0, 0, Math.PI * 0.5),
                    this.transformGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), tx, 1.66, -0.52, 0, 0, Math.PI * 0.5)
                );
            });

            gateGroup.add(new THREE.Mesh(this.mergeGeos(ironParts), this.materials.darkIron));
            gateGroup.add(new THREE.Mesh(this.mergeGeos(steelParts), this.materials.steelRail));
        } else {
            const lintel = new THREE.Mesh(new THREE.BoxGeometry(roadSpan, 1.18, 1.45), this.materials.glyph);
            lintel.position.set(0, 2.38, 0);
            gateGroup.add(lintel);

            const lowerLip = new THREE.Mesh(new THREE.BoxGeometry(roadSpan + 0.35, 0.20, 1.62), this.materials.curb);
            lowerLip.position.set(0, 1.82, 0);
            gateGroup.add(lowerLip);

            const wallCrestParts = [
                this.transformGeo(new THREE.BoxGeometry(roadSpan + 0.5, 0.26, 1.74), 0, 3.06, 0),
                this.transformGeo(new THREE.BoxGeometry(roadSpan * 0.42, 0.68, 1.48), 0, 3.52, 0)
            ];
            gateGroup.add(new THREE.Mesh(this.mergeGeos(wallCrestParts), this.materials.wall));

            const vg = new THREE.PlaneGeometry(roadSpan * 0.84, 0.78);
            const uvs = vg.attributes.uv;
            for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * 3.2);
            const vineMesh = new THREE.Mesh(vg, this.materials.vines);
            vineMesh.position.set(0, 1.50, 0.78);
            gateGroup.add(vineMesh);

            const pierParts = [
                this.transformGeo(new THREE.BoxGeometry(1.32, 3.35, 1.62), -(roadSpan * 0.5 + 0.35), 1.65, 0),
                this.transformGeo(new THREE.BoxGeometry(1.32, 3.35, 1.62), (roadSpan * 0.5 + 0.35), 1.65, 0)
            ];
            gateGroup.add(new THREE.Mesh(this.mergeGeos(pierParts), this.materials.pillarWall));

            // Twin carved crouching stone Mayan guardian statues flanking the ancient gate (matching TikTok 00:01!)
            const gateStatues = [
                this.transformGeo(this.sharedGeo.crouchingGuardian.clone(), -(roadSpan * 0.5 + 0.38), 0.96, 1.45, 0, 0.18, 0, 0.9, 0.9, 0.9),
                this.transformGeo(this.sharedGeo.crouchingGuardian.clone(), (roadSpan * 0.5 + 0.38), 0.96, 1.45, 0, -0.18, 0, 0.9, 0.9, 0.9)
            ];
            gateGroup.add(new THREE.Mesh(this.mergeGeos(gateStatues), this.materials.statueStone));
        }

        return {
            type: 'DUCK',
            subType: 'STONE_ARCH_GATE',
            group: gateGroup,
            worldZ: zPos,
            requiredAction: 'DUCK',
            label: 'DUCK / SQUAT!',
            color: '#00E5FF',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.5,
            lane: 'ALL'
        };
    }

    buildRollingBoulder(zPos, openLane) {
        const boulderGroup = new THREE.Group();
        boulderGroup.position.set(0, 0, zPos);

        const boulderX = (openLane === -1) ? 1.35 : -1.35;
        const radius = 1.44;

        // Craggy sculpted granite boulder with organic rock displacement + forged iron bands
        const rockGeo = new THREE.IcosahedronGeometry(radius, 2);
        const rp = rockGeo.attributes.position;
        for (let i = 0; i < rp.count; i++) {
            const vx = rp.getX(i), vy = rp.getY(i), vz = rp.getZ(i);
            const n = 0.93 + 0.13 * Math.sin(vx * 3.1 + vy * 2.3) * Math.cos(vz * 2.9);
            rp.setXYZ(i, vx * n, vy * n, vz * n);
        }
        rockGeo.computeVertexNormals();

        const ball = new THREE.Group();
        ball.position.set(boulderX, radius, 0);
        ball.add(new THREE.Mesh(rockGeo, this.materials.boulderArmor));

        const bandParts = [
            new THREE.TorusGeometry(radius * 0.98, 0.11, 7, 18),
            this.transformGeo(new THREE.TorusGeometry(radius * 0.98, 0.11, 7, 18), 0, 0, 0, 0, Math.PI / 2, 0),
            this.transformGeo(new THREE.TorusGeometry(radius * 0.98, 0.10, 7, 18), 0, 0, 0, Math.PI / 2, 0, 0)
        ];
        ball.add(new THREE.Mesh(this.mergeGeos(bandParts), this.materials.darkIron));
        boulderGroup.add(ball);

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(3.2, 1, 3.2);
        sh.position.set(boulderX, 0.03, 0);
        boulderGroup.add(sh);

        const isLeftDodge = (openLane === -1);
        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: 'ROLLING_BOULDER',
            group: boulderGroup,
            boulderMesh: ball,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.6,
            lane: 'SELECTIVE'
        };
    }

    // AUTHENTIC TIKTOK HOODED GRIM REAPER / PHANTOM SKELETON RUNAWAY MINECART TRAP (00:18-00:19!)
    buildReaperMinecart(zPos, openLane) {
        const cartGroup = new THREE.Group();
        cartGroup.position.set(0, 0, zPos);

        const cartX = (openLane === -1) ? 1.35 : -1.35;

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(4.9, 1, 4.2);
        sh.position.set(cartX, 0.03, 0);
        cartGroup.add(sh);

        // Animated cart body group (for subtle menacing rail rock as it hurtles toward the player!)
        const bodyGroup = new THREE.Group();
        bodyGroup.position.set(cartX, 0, 0);
        cartGroup.add(bodyGroup);

        // 1. Flared Trapezoidal Stone/Slate Minecart Tub + Heavy Stepped Upper Rim Cornice (matches 00:19!)
        const tubGeo = new THREE.BoxGeometry(4.15, 1.44, 3.35, 2, 2, 2);
        const tp = tubGeo.attributes.position;
        for (let i = 0; i < tp.count; i++) {
            const vx = tp.getX(i), vy = tp.getY(i), vz = tp.getZ(i);
            const flare = 0.84 + ((vy + 0.72) / 1.44) * 0.24; // Flared wider toward the top rim!
            tp.setXYZ(i, vx * flare, vy, vz * (0.88 + ((vy + 0.72) / 1.44) * 0.18));
        }
        tubGeo.computeVertexNormals();

        const stoneParts = [
            this.transformGeo(tubGeo, 0, 1.16, 0),
            // Thick beveled upper stone/iron rim collar around top of cart (prominent in 00:19!)
            this.transformGeo(this.makeTiledBox(4.68, 0.24, 3.82, 0.30), 0, 1.94, 0),
            this.transformGeo(this.makeTiledBox(4.42, 0.16, 3.56, 0.30), 0, 1.76, 0)
        ];
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(stoneParts), this.materials.reaperCartStone));

        // 2. Riveted Iron Undercarriage Chassis, Corner Straps & Front Cowcatcher Bumper
        const ironParts = [
            // Undercarriage chassis frame & axle bolsters
            this.transformGeo(new THREE.BoxGeometry(3.55, 0.30, 3.15), 0, 0.44, 0),
            this.transformGeo(new THREE.BoxGeometry(3.95, 0.20, 0.38), 0, 0.42, 1.68),
            // Angled front cowcatcher plow bars
            this.transformGeo(new THREE.BoxGeometry(3.45, 0.26, 0.46), 0, 0.32, 1.92, 0.35, 0, 0),
            // Corner forged-iron reinforcement straps & horizontal front bands
            this.transformGeo(new THREE.BoxGeometry(4.32, 0.14, 0.14), 0, 1.32, 1.66),
            this.transformGeo(new THREE.BoxGeometry(4.02, 0.14, 0.14), 0, 0.84, 1.56)
        ];
        [-1, 1].forEach((sx) => {
            [-1, 1].forEach((sz) => {
                ironParts.push(this.transformGeo(
                    new THREE.BoxGeometry(0.24, 1.42, 0.24),
                    sx * 1.92, 1.16, sz * 1.50,
                    -sz * 0.14, 0, sx * 0.18
                ));
            });
        });
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(ironParts), this.materials.darkIron));

        // Glowing green emerald crystal ore heaped inside the runaway cart!
        const oreParts = [];
        for (let c = 0; c < 6; c++) {
            const ox = -1.25 + (c % 3) * 1.25 + (c > 2 ? 0.25 : -0.2);
            const oz = c < 3 ? -0.55 : 0.35;
            oreParts.push(this.transformGeo(
                new THREE.CylinderGeometry(0.05, 0.34, 0.95, 6),
                ox, 2.02, oz,
                (c % 2 === 0 ? 0.28 : -0.22), c * 0.7, (c - 2.5) * 0.18
            ));
        }
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(oreParts), this.materials.emeraldCrystal));

        // 3. 4 Spinning Flanged Steel Rail Wheels (aligned on the rails underneath!)
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(cartX, 0.44, 0);
        const steelWheelParts = [];
        const hubWheelParts = [];
        [-1.35 + 0.52, -1.35 - 0.52, 1.35 - 0.52, 1.35 + 0.52].forEach((wx) => {
            // Position 2 axle pairs at z = +1.05 and z = -1.05 across outer rails
        });
        [-1.58, 1.58].forEach((wx) => {
            [-1.02, 1.02].forEach((wz) => {
                steelWheelParts.push(
                    this.transformGeo(new THREE.CylinderGeometry(0.42, 0.42, 0.20, 14), wx, 0, wz, 0, 0, Math.PI * 0.5),
                    this.transformGeo(new THREE.CylinderGeometry(0.50, 0.50, 0.06, 14), wx + (wx > 0 ? -0.10 : 0.10), 0, wz, 0, 0, Math.PI * 0.5)
                );
                hubWheelParts.push(
                    this.transformGeo(new THREE.BoxGeometry(0.26, 0.72, 0.12), wx, 0, wz),
                    this.transformGeo(new THREE.BoxGeometry(0.26, 0.12, 0.72), wx, 0, wz)
                );
            });
        });
        [-1.02, 1.02].forEach((wz) => {
            hubWheelParts.push(this.transformGeo(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), 0, 0, wz, 0, 0, Math.PI * 0.5));
        });
        wheelGroup.add(new THREE.Mesh(this.mergeGeos(steelWheelParts), this.materials.steelRail));
        wheelGroup.add(new THREE.Mesh(this.mergeGeos(hubWheelParts), this.materials.darkIron));
        cartGroup.add(wheelGroup);

        // 4. THE HOODED GRIM REAPER / SKELETON WRAITH DRIVER LEANING OVER THE FRONT RIM (Matches 7b4ec428.jpg!)
        const cloakParts = [
            // Hunched robed torso & broad dark mantle shoulders leaning forward over the cart
            this.transformGeo(new THREE.CylinderGeometry(0.62, 0.96, 1.38, 10), 0, 2.34, 0.36, 0.28, 0, 0, 1.28, 1.0, 0.88),
            this.transformGeo(new THREE.SphereGeometry(0.78, 10, 8), 0, 2.86, 0.48, 0.2, 0, 0, 1.42, 0.62, 0.86),
            // Deep pointed Grim Reaper cowl/hood arching over the skull + swept-back hood peak
            this.transformGeo(new THREE.SphereGeometry(0.54, 12, 10), 0, 3.30, 0.76, 0.18, 0, 0, 1.08, 1.18, 1.15),
            this.transformGeo(new THREE.ConeGeometry(0.48, 1.05, 8), 0, 3.64, 0.34, -0.82, 0, 0, 1.02, 1.0, 0.92),
            // Dark recessed shadow cavity inside the cowl framing the pale white skull
            this.transformGeo(new THREE.SphereGeometry(0.40, 10, 8), 0, 3.24, 0.94, 0, 0, 0, 0.92, 1.05, 0.55)
        ];

        // Outstretched cloaked arms reaching left & right to grip the front corners of the cart rim + billowing tattered cape!
        [-1, 1].forEach((side) => {
            const armCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(side * 0.78, 2.82, 0.52),
                new THREE.Vector3(side * 1.28, 2.46, 1.08),
                new THREE.Vector3(side * 1.56, 2.04, 1.66)
            ]);
            cloakParts.push(new THREE.TubeGeometry(armCurve, 8, 0.24, 7, false));
            // Hanging tattered Grim Reaper sleeve drape under each outstretched arm
            cloakParts.push(this.transformGeo(
                new THREE.ConeGeometry(0.36, 1.12, 5),
                side * 1.22, 2.08, 1.06,
                0.35, 0, side * 0.24,
                0.55, 1.0, 1.25
            ));
            // Sweeping tattered black cloak streamers billowing backward & outward in the wind (matches 00:19!)
            cloakParts.push(
                this.transformGeo(new THREE.ConeGeometry(0.62, 2.45, 5), side * 1.15, 2.42, -0.68, -1.18, side * 0.32, side * 0.28, 0.85, 1.0, 0.28),
                this.transformGeo(new THREE.ConeGeometry(0.48, 2.15, 5), side * 1.68, 2.12, -0.42, -1.05, side * 0.52, side * 0.42, 0.75, 1.0, 0.24)
            );
        });

        // Sunken dark eye sockets & nasal cavity on the skull
        [-0.135, 0.135].forEach((ex) => {
            cloakParts.push(this.transformGeo(new THREE.SphereGeometry(0.105, 8, 8), ex, 3.28, 1.24, 0, 0, 0, 1.05, 0.92, 0.55));
        });
        cloakParts.push(this.transformGeo(new THREE.ConeGeometry(0.065, 0.16, 4), 0, 3.13, 1.28, 0.2, 0, 0, 0.85, 1.0, 0.5));
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(cloakParts), this.materials.reaperCloak));

        // Pale Bone-White Sculpted Skull Face + Skeletal Clawed Hands gripping the front minecart rim!
        const boneParts = [
            // Cranium, cheekbones & menacing grinning jaw inside the dark hood (pops crisply from 40m away!)
            this.transformGeo(new THREE.SphereGeometry(0.34, 12, 10), 0, 3.32, 1.02, 0, 0, 0, 0.96, 1.06, 0.92),
            this.transformGeo(new THREE.BoxGeometry(0.54, 0.18, 0.30), 0, 3.16, 1.14),
            this.transformGeo(new THREE.BoxGeometry(0.34, 0.22, 0.28), 0, 2.98, 1.12, 0.12, 0, 0),
            // Grinning skeletal teeth row
            this.transformGeo(new THREE.BoxGeometry(0.30, 0.08, 0.10), 0, 3.04, 1.26)
        ];
        [-1, 1].forEach((side) => {
            const hx = side * 1.58;
            // Bony hand + 4 hooked skeletal claws gripping right over the front stone rim!
            boneParts.push(this.transformGeo(new THREE.BoxGeometry(0.34, 0.14, 0.28), hx, 2.08, 1.76, 0.35, 0, 0));
            for (let f = -1.5; f <= 1.5; f += 1.0) {
                boneParts.push(this.transformGeo(
                    new THREE.ConeGeometry(0.042, 0.28, 5),
                    hx + f * 0.075, 1.94, 1.92,
                    Math.PI * 0.76, 0, 0
                ));
            }
        });
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(boneParts), this.materials.boneSkull));

        // Piercing glowing phantom eyes inside the skull sockets
        const eyeGlowParts = [
            this.transformGeo(new THREE.SphereGeometry(0.048, 7, 7), -0.135, 3.28, 1.30),
            this.transformGeo(new THREE.SphereGeometry(0.048, 7, 7), 0.135, 3.28, 1.30)
        ];
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(eyeGlowParts), this.materials.phantomGlow));

        // Curved Grim Reaper Scythe strapped diagonally across back/shoulder!
        const scytheShaft = this.transformGeo(
            new THREE.CylinderGeometry(0.055, 0.065, 3.15, 7),
            0.32, 2.95, 0.02,
            -0.12, 0, -0.36
        );
        bodyGroup.add(new THREE.Mesh(scytheShaft, this.materials.mineTimber));

        const bladeCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.84, 4.28, -0.14),
            new THREE.Vector3(0.18, 4.54, -0.06),
            new THREE.Vector3(-0.58, 4.32, 0.04),
            new THREE.Vector3(-1.12, 3.82, 0.12)
        ]);
        const scytheBlade = new THREE.TubeGeometry(bladeCurve, 12, 0.085, 4, false);
        const sbp = scytheBlade.attributes.position;
        for (let i = 0; i < sbp.count; i++) {
            // Flatten tube into a razor-sharp crescent reaper blade tapering toward the tip!
            const vx = sbp.getX(i);
            const t = Math.max(0.18, Math.min(1.15, (vx + 1.15) / 2.0));
            sbp.setZ(i, sbp.getZ(i) * 0.22);
            sbp.setY(i, 4.25 + (sbp.getY(i) - 4.25) * t);
        }
        scytheBlade.computeVertexNormals();
        bodyGroup.add(new THREE.Mesh(scytheBlade, this.materials.spikes));

        const isLeftDodge = (openLane === -1);
        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: 'REAPER_MINECART',
            group: cartGroup,
            cartBody: bodyGroup,
            cartWheels: wheelGroup,
            oncomingSpeed: 7.8,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.95,
            lane: 'SELECTIVE'
        };
    }

    // AUTHENTIC TIKTOK SPIKED RUNAWAY TIMBER & IRON WAGON TRAP (00:16-00:17 on Bridge / Portal!)
    buildSpikedRunawayCart(zPos, openLane) {
        const wagonGroup = new THREE.Group();
        wagonGroup.position.set(0, 0, zPos);

        const cartX = (openLane === -1) ? 1.35 : -1.35;

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(4.8, 1, 4.0);
        sh.position.set(cartX, 0.03, 0);
        wagonGroup.add(sh);

        const bodyGroup = new THREE.Group();
        bodyGroup.position.set(cartX, 0, 0);
        wagonGroup.add(bodyGroup);

        // Heavy rough-timber reinforced battering wagon box
        const woodParts = [
            this.transformGeo(this.makeTiledBox(4.15, 1.58, 3.25, 0.35), 0, 1.34, 0),
            this.transformGeo(this.makeTiledBox(4.42, 0.24, 3.52, 0.35), 0, 2.20, 0),
            this.transformGeo(this.makeTiledBox(3.85, 0.45, 2.85, 0.35), 0, 2.48, -0.1)
        ];
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(woodParts), this.materials.mineTimber));

        const ironParts = [
            this.transformGeo(new THREE.BoxGeometry(4.36, 0.26, 0.36), 0, 0.62, 1.68),
            this.transformGeo(new THREE.BoxGeometry(4.36, 0.20, 0.24), 0, 1.45, 1.66),
            this.transformGeo(new THREE.BoxGeometry(3.65, 0.28, 3.05), 0, 0.52, 0)
        ];
        [-1.85, 0, 1.85].forEach((bx) => {
            ironParts.push(this.transformGeo(new THREE.BoxGeometry(0.22, 1.72, 3.38), bx, 1.36, 0));
        });
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(ironParts), this.materials.darkIron));

        // Gleaming steel spikes projecting forward off the battering ram & downward under the chassis (matches 00:17!)
        const spikeParts = [];
        for (let sx = -1.72; sx <= 1.72; sx += 0.68) {
            spikeParts.push(
                this.transformGeo(new THREE.ConeGeometry(0.16, 0.68, 5), sx, 0.64, 2.08, Math.PI * 0.5, 0, 0),
                this.transformGeo(new THREE.ConeGeometry(0.15, 0.62, 5), sx, 1.45, 2.02, Math.PI * 0.5, 0, 0),
                this.transformGeo(new THREE.ConeGeometry(0.14, 0.54, 5), sx, 0.28, 1.48, Math.PI * 0.88, 0, 0)
            );
        }
        bodyGroup.add(new THREE.Mesh(this.mergeGeos(spikeParts), this.materials.spikes));

        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(cartX, 0.46, 0);
        const rimParts = [];
        const spokeParts = [];
        [-1.65, 1.65].forEach((wx) => {
            [-1.02, 1.02].forEach((wz) => {
                rimParts.push(this.transformGeo(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 14), wx, 0, wz, 0, 0, Math.PI * 0.5));
                spokeParts.push(this.transformGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 10), wx, 0, wz, 0, 0, Math.PI * 0.5));
            });
        });
        wheelGroup.add(new THREE.Mesh(this.mergeGeos(rimParts), this.materials.darkIron));
        wheelGroup.add(new THREE.Mesh(this.mergeGeos(spokeParts), this.materials.mineTimber));
        wagonGroup.add(wheelGroup);

        const isLeftDodge = (openLane === -1);
        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: 'SPIKED_CART',
            group: wagonGroup,
            cartBody: bodyGroup,
            cartWheels: wheelGroup,
            oncomingSpeed: 7.4,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.9,
            lane: 'SELECTIVE'
        };
    }

    // AUTHENTIC TIKTOK CARVED ANGRY STONE MAYAN TIKI IDOL MONOLITH (00:00 in TikTok!)
    buildIdolBarrier(zPos, openLane) {
        const barrierGroup = new THREE.Group();
        barrierGroup.position.set(0, 0, zPos);

        const blockX = (openLane === -1) ? 1.35 : -1.35;
        const blockW = this.laneWidth * 1.72; // 4.64m wide cleanly blocking 2 lanes

        const sh = new THREE.Mesh(this.sharedGeo.shadowQuad, this.materials.contactShadow);
        sh.scale.set(blockW + 0.8, 1, 2.9);
        sh.position.set(blockX, 0.02, 0);
        barrierGroup.add(sh);

        // Sculpted stone idol face, angry slanted brows, broad nose, grimacing Mayan teeth & flanking ears
        const stoneParts = [
            // Stepped ancient stone plinth base
            this.transformGeo(this.makeTiledBox(blockW + 0.36, 0.44, 2.24, 0.30), blockX, 0.22, 0),
            this.transformGeo(this.makeTiledBox(blockW + 0.12, 0.34, 2.02, 0.30), blockX, 0.58, 0),
            // Main carved Tiki monolith head block
            this.transformGeo(this.makeTiledBox(blockW - 0.32, 2.48, 1.82, 0.28), blockX, 1.96, 0),
            // Flanking carved ear/pillar flanges
            this.transformGeo(this.makeTiledBox(0.46, 2.05, 1.42, 0.30), blockX - blockW * 0.46, 1.85, 0),
            this.transformGeo(this.makeTiledBox(0.46, 2.05, 1.42, 0.30), blockX + blockW * 0.46, 1.85, 0),
            // Angry V-slanted stone brow ridges
            this.transformGeo(new THREE.BoxGeometry(1.48, 0.34, 0.46), blockX - 0.86, 2.66, 0.96, 0, 0, -0.22),
            this.transformGeo(new THREE.BoxGeometry(1.48, 0.34, 0.46), blockX + 0.86, 2.66, 0.96, 0, 0, 0.22),
            // Broad carved Tiki nose bridge & nostrils
            this.transformGeo(new THREE.BoxGeometry(0.76, 0.86, 0.52), blockX, 2.12, 1.02),
            this.transformGeo(new THREE.BoxGeometry(1.08, 0.32, 0.48), blockX, 1.78, 1.02),
            // Heavy grimacing rectangular Mayan mouth frame + upper & lower stone teeth!
            this.transformGeo(new THREE.BoxGeometry(2.68, 0.22, 0.44), blockX, 1.46, 0.98),
            this.transformGeo(new THREE.BoxGeometry(2.68, 0.24, 0.44), blockX, 0.86, 0.98)
        ];
        for (let tx = -1.0; tx <= 1.0; tx += 0.5) {
            stoneParts.push(
                this.transformGeo(new THREE.BoxGeometry(0.36, 0.18, 0.32), blockX + tx, 1.28, 0.98),
                this.transformGeo(new THREE.BoxGeometry(0.36, 0.18, 0.32), blockX + tx, 1.04, 0.98)
            );
        }
        barrierGroup.add(new THREE.Mesh(this.mergeGeos(stoneParts), this.materials.statueStone));

        // Deep dark recessed eyes & mouth cavity
        const darkCavityParts = [
            this.transformGeo(new THREE.BoxGeometry(0.92, 0.42, 0.24), blockX - 0.88, 2.34, 0.88),
            this.transformGeo(new THREE.BoxGeometry(0.92, 0.42, 0.24), blockX + 0.88, 2.34, 0.88),
            this.transformGeo(new THREE.BoxGeometry(2.38, 0.46, 0.24), blockX, 1.16, 0.88)
        ];
        barrierGroup.add(new THREE.Mesh(this.mergeGeos(darkCavityParts), this.materials.darkIron));

        // Ornate carved Mayan glyph headdress / crown crest (matches 00:00!)
        const crownParts = [
            this.transformGeo(new THREE.BoxGeometry(blockW + 0.16, 0.42, 1.98), blockX, 3.38, 0),
            this.transformGeo(new THREE.BoxGeometry(blockW * 0.68, 0.56, 1.66), blockX, 3.84, 0),
            // Carved stone eye pupils
            this.transformGeo(new THREE.SphereGeometry(0.16, 8, 8), blockX - 0.88, 2.32, 0.98),
            this.transformGeo(new THREE.SphereGeometry(0.16, 8, 8), blockX + 0.88, 2.32, 0.98)
        ];
        barrierGroup.add(new THREE.Mesh(this.mergeGeos(crownParts), this.materials.glyph));

        const isLeftDodge = (openLane === -1);
        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: 'IDOL_BARRIER',
            group: barrierGroup,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.48,
            lane: 'SELECTIVE'
        };
    }

    buildCollapsedEdge(zPos, openLane) {
        const edgeGroup = new THREE.Group();
        edgeGroup.position.set(0, 0, zPos);

        const brokenX = (openLane === -1) ? 1.4 : -1.4;
        const brokenWidth = this.laneWidth * 2 + 0.4;
        const sectionLength = 6.6;

        const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(brokenWidth, sectionLength), this.materials.voidBlack);
        voidMesh.rotation.x = -Math.PI / 2;
        voidMesh.position.set(brokenX, 0.04, 0);
        edgeGroup.add(voidMesh);

        const fractureX = (openLane === -1) ? -this.laneWidth / 2 : this.laneWidth / 2;
        const tiltSign = (openLane === -1) ? -1 : 1;
        const rubbleParts = [];
        const slabParts = [];
        for (let z = -sectionLength / 2 + 0.5; z <= sectionLength / 2 - 0.5; z += 1.15) {
            rubbleParts.push(this.transformGeo(new THREE.BoxGeometry(0.55, 0.36, 0.94), fractureX, 0.16, z, 0, (z * 0.25) % 0.3, 0));
            slabParts.push(this.transformGeo(
                new THREE.BoxGeometry(0.95, 0.18, 0.88),
                fractureX - tiltSign * 0.48, 0.08, z,
                0, 0, tiltSign * 0.52
            ));
        }
        edgeGroup.add(new THREE.Mesh(this.mergeGeos(rubbleParts), this.materials.curb));
        edgeGroup.add(new THREE.Mesh(this.mergeGeos(slabParts), this.materials.wall));

        const isLeftDodge = (openLane === -1);
        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: 'COLLAPSED_EDGE',
            group: edgeGroup,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.95,
            lane: 'SELECTIVE'
        };
    }

    // ============================================================
    // AUTHENTIC SUBWAY SURFERS TRAIN, TRAM & CHEVRON BARRIER TRAPS
    // ============================================================

    buildTrainCarComponents(bodyParts, wheelList, parentGroup, trackX, zOff, cStyle) {
        if (cStyle === 'SUBWAY') {
            // Sleek Passenger Subway Car (matches Subway Surfers left train in 4e84dbae.jpg & 00288df9.jpg)
            bodyParts.subwayBody.push(
                this.transformGeo(this.makeTiledBox(2.42, 2.40, 11.2, 0.35), trackX, 1.68, zOff),
                this.transformGeo(this.makeTiledBox(2.38, 2.22, 1.6, 0.35), trackX, 1.58, zOff + 6.35)
            );
            bodyParts.subwayRedStripe.push(
                this.transformGeo(new THREE.BoxGeometry(2.46, 0.32, 11.4), trackX, 1.52, zOff),
                this.transformGeo(new THREE.BoxGeometry(2.42, 0.32, 1.7), trackX, 1.52, zOff + 6.35)
            );
            bodyParts.subwayRoof.push(
                this.transformGeo(new THREE.CylinderGeometry(1.72, 1.72, 12.2, 14, 1, false, 0, Math.PI), trackX, 2.65, zOff, 0, 0, Math.PI / 2, 0.58, 1.0, 1.0),
                this.transformGeo(new THREE.BoxGeometry(1.50, 0.34, 1.9), trackX, 3.68, zOff - 3.4),
                this.transformGeo(new THREE.BoxGeometry(1.50, 0.34, 1.9), trackX, 3.68, zOff),
                this.transformGeo(new THREE.BoxGeometry(1.50, 0.34, 1.9), trackX, 3.68, zOff + 3.4)
            );
            bodyParts.subwayGlass.push(
                this.transformGeo(new THREE.BoxGeometry(1.92, 1.05, 0.20), trackX, 2.12, zOff + 7.05, -0.20, 0, 0)
            );
            bodyParts.subwayHeadlight.push(
                this.transformGeo(new THREE.CylinderGeometry(0.20, 0.20, 0.16, 12), trackX - 0.74, 1.12, zOff + 7.15, Math.PI / 2, 0, 0),
                this.transformGeo(new THREE.CylinderGeometry(0.20, 0.20, 0.16, 12), trackX + 0.74, 1.12, zOff + 7.15, Math.PI / 2, 0, 0),
                this.transformGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10), trackX, 2.95, zOff + 6.95, Math.PI / 2, 0, 0)
            );
            bodyParts.headlightBeam.push(
                this.transformGeo(new THREE.PlaneGeometry(2.4, 16.0), trackX, 0.05, zOff + 14.5, -Math.PI / 2, 0, 0)
            );
            bodyParts.darkIron.push(
                this.transformGeo(new THREE.BoxGeometry(2.25, 0.32, 0.40), trackX, 0.30, zOff + 7.02, 0.26, 0, 0),
                this.transformGeo(new THREE.BoxGeometry(0.30, 0.30, 0.90), trackX, 0.38, zOff + 7.28),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff - 3.8),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff + 3.8)
            );
            bodyParts.contactShadow.push(
                this.transformGeo(this.sharedGeo.shadowQuad.clone(), trackX, 0.03, zOff, 0, 0, 0, 2.9, 1.0, 13.5)
            );
        } else if (cStyle === 'TRAM') {
            // Modern Streamlined Tram Car (matches Subway Surfers tram in 4e84dbae.jpg & 83f664ba.jpg)
            bodyParts.tramBody.push(
                this.transformGeo(this.makeTiledBox(2.40, 2.40, 10.4, 0.35), trackX, 1.68, zOff),
                this.transformGeo(new THREE.CylinderGeometry(1.20, 1.20, 2.40, 14, 1, false, -Math.PI / 2, Math.PI), trackX, 1.68, zOff + 5.2, 0, 0, Math.PI / 2)
            );
            bodyParts.tramTeal.push(
                this.transformGeo(new THREE.BoxGeometry(2.44, 0.76, 11.0), trackX, 0.86, zOff)
            );
            bodyParts.subwayRoof.push(
                this.transformGeo(new THREE.CylinderGeometry(1.72, 1.72, 11.2, 14, 1, false, 0, Math.PI), trackX, 2.65, zOff, 0, 0, Math.PI / 2, 0.58, 1.0, 1.0)
            );
            bodyParts.subwayGlass.push(
                this.transformGeo(new THREE.BoxGeometry(2.05, 1.12, 0.26), trackX, 2.08, zOff + 6.05, -0.18, 0, 0)
            );
            bodyParts.subwayHeadlight.push(
                this.transformGeo(new THREE.BoxGeometry(0.42, 0.18, 0.14), trackX - 0.70, 1.02, zOff + 6.25),
                this.transformGeo(new THREE.BoxGeometry(0.42, 0.18, 0.14), trackX + 0.70, 1.02, zOff + 6.25)
            );
            bodyParts.headlightBeam.push(
                this.transformGeo(new THREE.PlaneGeometry(2.4, 15.0), trackX, 0.05, zOff + 13.5, -Math.PI / 2, 0, 0)
            );
            bodyParts.darkIron.push(
                // Articulated roof pantograph
                this.transformGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 6), trackX, 3.65, zOff, 0.55, 0, 0),
                this.transformGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 6), trackX, 3.65, zOff, -0.55, 0, 0),
                this.transformGeo(new THREE.BoxGeometry(1.80, 0.06, 0.40), trackX, 4.38, zOff),
                this.transformGeo(new THREE.BoxGeometry(0.26, 0.26, 0.88), trackX, 0.36, zOff + 6.32),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff - 3.5),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff + 3.5)
            );
            bodyParts.contactShadow.push(
                this.transformGeo(this.sharedGeo.shadowQuad.clone(), trackX, 0.03, zOff, 0, 0, 0, 2.8, 1.0, 12.5)
            );
        } else if (cStyle === 'BLUE_CARGO') {
            // Vibrant Blue Corrugated Shipping Container Boxcar (matches e6196d69.jpg & f565e49c.jpg!)
            bodyParts.blueContainer.push(
                this.transformGeo(this.makeTiledBox(2.46, 2.80, 10.4, 0.35), trackX, 1.88, zOff)
            );
            bodyParts.darkIron.push(
                this.transformGeo(new THREE.BoxGeometry(2.56, 0.38, 11.2), trackX, 0.48, zOff),
                this.transformGeo(new THREE.BoxGeometry(0.92, 0.06, 10.4), trackX, 3.31, zOff),
                this.transformGeo(new THREE.BoxGeometry(0.30, 0.30, 0.90), trackX, 0.38, zOff + 5.85),
                this.transformGeo(new THREE.BoxGeometry(0.30, 0.30, 0.90), trackX, 0.38, zOff - 5.85),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff - 3.5),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff + 3.5)
            );
            bodyParts.contactShadow.push(
                this.transformGeo(this.sharedGeo.shadowQuad.clone(), trackX, 0.03, zOff, 0, 0, 0, 2.9, 1.0, 12.0)
            );
        } else {
            // Freight Cargo Boxcar (matches Subway Surfers cargo boxcar in 83f664ba.jpg & 00288df9.jpg)
            bodyParts.cargoBox.push(
                this.transformGeo(this.makeTiledBox(2.46, 2.80, 10.4, 0.35), trackX, 1.88, zOff)
            );
            bodyParts.darkIron.push(
                this.transformGeo(new THREE.BoxGeometry(2.56, 0.38, 11.2), trackX, 0.48, zOff),
                this.transformGeo(new THREE.BoxGeometry(0.92, 0.06, 10.4), trackX, 3.31, zOff),
                this.transformGeo(new THREE.BoxGeometry(0.30, 0.30, 0.90), trackX, 0.38, zOff + 5.85),
                this.transformGeo(new THREE.BoxGeometry(0.30, 0.30, 0.90), trackX, 0.38, zOff - 5.85),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff - 3.5),
                this.transformGeo(new THREE.BoxGeometry(2.10, 0.28, 2.6), trackX, 0.46, zOff + 3.5)
            );
            bodyParts.contactShadow.push(
                this.transformGeo(this.sharedGeo.shadowQuad.clone(), trackX, 0.03, zOff, 0, 0, 0, 2.9, 1.0, 12.0)
            );
        }

        // 8 Flanged Steel Wheels positioned directly on the track rails at trackX ± 0.52
        const bogieZ = (cStyle === 'SUBWAY') ? 3.8 : 3.5;
        const wheelOffsets = [
            [-0.52, -bogieZ - 0.75], [-0.52, -bogieZ + 0.75],
            [ 0.52, -bogieZ - 0.75], [ 0.52, -bogieZ + 0.75],
            [-0.52,  bogieZ - 0.75], [-0.52,  bogieZ + 0.75],
            [ 0.52,  bogieZ - 0.75], [ 0.52,  bogieZ + 0.75]
        ];

        if (wheelList && parentGroup) {
            const wheelMeshGroup = new THREE.Group();
            wheelMeshGroup.position.set(trackX, 0.42, zOff);
            const wGeos = wheelOffsets.map(([wx, wz]) => {
                const isLeft = (wx < 0);
                return this.transformGeo(this.sharedGeo.trainWheel.clone(), wx, 0, wz, 0, isLeft ? Math.PI : 0, 0);
            });
            wheelMeshGroup.add(new THREE.Mesh(this.mergeGeos(wGeos), this.materials.steelRail));
            parentGroup.add(wheelMeshGroup);
            wheelList.push(wheelMeshGroup);
        } else {
            wheelOffsets.forEach(([wx, wz]) => {
                const isLeft = (wx < 0);
                bodyParts.steelRail.push(
                    this.transformGeo(this.sharedGeo.trainWheel.clone(), trackX + wx, 0.42, zOff + wz, 0, isLeft ? Math.PI : 0, 0)
                );
            });
        }
    }

    buildSubwayTrainTrap(zPos, openLane, style = 'SUBWAY') {
        const trainGroup = new THREE.Group();
        trainGroup.position.set(0, 0, zPos);

        const bodyGroup = new THREE.Group();
        trainGroup.add(bodyGroup);

        const wheelList = [];

        // openLane === -1 -> Left track (-2.7) is open -> Block Center (0) and Right (2.7)
        // openLane === 1  -> Right track (2.7) is open -> Block Center (0) and Left (-2.7)
        const blockedTracks = (openLane === -1) ? [0, 2.7] : [-2.7, 0];

        const leadStyle = style;
        const flankStyle = (style === 'SUBWAY') ? 'BLUE_CARGO' : ((style === 'BLUE_CARGO') ? 'TRAM' : ((style === 'TRAM') ? 'CARGO' : 'SUBWAY'));

        const trainSpecs = [
            { trackX: blockedTracks[0], style: leadStyle, zOff: 0 },
            { trackX: blockedTracks[1], style: flankStyle, zOff: (openLane === -1 ? 2.4 : -2.4) }
        ];

        const bodyParts = {
            subwayBody: [],
            subwayRedStripe: [],
            subwayRoof: [],
            subwayGlass: [],
            subwayHeadlight: [],
            headlightBeam: [],
            tramBody: [],
            tramTeal: [],
            cargoBox: [],
            blueContainer: [],
            darkIron: [],
            steelRail: [],
            contactShadow: []
        };

        trainSpecs.forEach(({ trackX, style: cStyle, zOff }) => {
            this.buildTrainCarComponents(bodyParts, wheelList, bodyGroup, trackX, zOff, cStyle);
        });

        Object.keys(bodyParts).forEach((matKey) => {
            const list = bodyParts[matKey];
            if (list.length > 0 && this.materials[matKey]) {
                bodyGroup.add(new THREE.Mesh(this.mergeGeos(list), this.materials[matKey]));
            }
        });

        const isLeftDodge = (openLane === -1);
        const oncomingSpeed = (style === 'SUBWAY') ? 8.8 : ((style === 'TRAM') ? 8.2 : ((style === 'BLUE_CARGO') ? 8.0 : 7.6));

        return {
            type: isLeftDodge ? 'LEFT' : 'RIGHT',
            subType: style + '_TRAIN',
            group: trainGroup,
            cartBody: bodyGroup,
            trainWheels: wheelList,
            oncomingSpeed: oncomingSpeed,
            worldZ: zPos,
            requiredAction: isLeftDodge ? 'LEFT' : 'RIGHT',
            targetLane: openLane,
            label: isLeftDodge ? 'LEAN LEFT!' : 'LEAN RIGHT!',
            color: isLeftDodge ? '#BF55EC' : '#2ECC71',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 2.6,
            lane: 'SELECTIVE'
        };
    }

    buildRailwayChevronBarrierTrap(zPos) {
        const barrierGroup = new THREE.Group();
        barrierGroup.position.set(0, 0, zPos);

        const bodyParts = {
            subwayBody: [], subwayRedStripe: [], subwayRoof: [], subwayGlass: [],
            subwayHeadlight: [], headlightBeam: [], tramBody: [], tramTeal: [],
            cargoBox: [], blueContainer: [], darkIron: [], steelRail: [], contactShadow: []
        };

        // Center track (x = 0): Signature Red & White Chevron Barrier with 4 Rubber Buffers (Matches e6196d69.jpg, 9468adf5.jpg, f565e49c.jpg!)
        const chevronParts = [
            this.transformGeo(new THREE.BoxGeometry(2.40, 1.10, 0.16), 0, 1.22, 0)
        ];
        [-0.85, 0.85].forEach((bx) => {
            [0.86, 1.58].forEach((by) => {
                bodyParts.darkIron.push(
                    this.transformGeo(new THREE.CylinderGeometry(0.26, 0.26, 0.20, 16), bx, by, 0.15, Math.PI / 2, 0, 0)
                );
            });
        });
        [-0.78, 0.78].forEach((px) => {
            bodyParts.darkIron.push(
                this.transformGeo(new THREE.BoxGeometry(0.20, 1.35, 0.22), px, 0.68, -0.04),
                this.transformGeo(new THREE.BoxGeometry(0.16, 1.30, 0.16), px, 0.68, -0.42, 0.58, 0, 0),
                this.transformGeo(new THREE.BoxGeometry(0.28, 0.14, 1.25), px, 0.08, -0.24)
            );
        });
        bodyParts.darkIron.push(
            this.transformGeo(new THREE.BoxGeometry(2.45, 0.12, 0.36), 0, 0.06, 0)
        );
        bodyParts.contactShadow.push(
            this.transformGeo(this.sharedGeo.shadowQuad.clone(), 0, 0.02, 0, 0, 0, 0, 2.6, 1.0, 1.8)
        );

        // Flanking Left Track (-2.7): Silver Passenger Subway Train (matches e6196d69.jpg & 9468adf5.jpg!)
        this.buildTrainCarComponents(bodyParts, null, barrierGroup, -2.7, 0, 'SUBWAY');

        // Flanking Right Track (+2.7): Blue Corrugated Shipping Container Boxcar (matches e6196d69.jpg & f565e49c.jpg!)
        this.buildTrainCarComponents(bodyParts, null, barrierGroup, 2.7, 0, 'BLUE_CARGO');

        barrierGroup.add(new THREE.Mesh(this.mergeGeos(chevronParts), this.materials.chevronBarrier));

        Object.keys(bodyParts).forEach((matKey) => {
            const list = bodyParts[matKey];
            if (list.length > 0 && this.materials[matKey]) {
                barrierGroup.add(new THREE.Mesh(this.mergeGeos(list), this.materials[matKey]));
            }
        });

        return {
            type: 'JUMP',
            subType: 'RAILWAY_BARRIER',
            group: barrierGroup,
            worldZ: zPos,
            requiredAction: 'JUMP',
            label: 'JUMP!',
            color: '#FFE600',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.75,
            lane: 'CENTER'
        };
    }

    buildRailwayClearanceGantryTrap(zPos) {
        const gantryGroup = new THREE.Group();
        gantryGroup.position.set(0, 0, zPos);

        const bodyParts = {
            subwayBody: [], subwayRedStripe: [], subwayRoof: [], subwayGlass: [],
            subwayHeadlight: [], headlightBeam: [], tramBody: [], tramTeal: [],
            cargoBox: [], blueContainer: [], darkIron: [], steelRail: [], contactShadow: []
        };

        // Center track (x = 0): Overhead Red & White Striped Clearance Barrier (clearance 2.05m — DUCK!)
        const chevronParts = [
            this.transformGeo(new THREE.BoxGeometry(2.65, 0.44, 0.22), 0, 2.05, 0)
        ];
        // Support stanchions anchored between tracks
        [-1.38, 1.38].forEach((gx) => {
            bodyParts.darkIron.push(
                this.transformGeo(new THREE.BoxGeometry(0.22, 2.85, 0.24), gx, 1.42, 0),
                this.transformGeo(new THREE.BoxGeometry(0.36, 0.16, 0.42), gx, 0.08, 0),
                this.transformGeo(new THREE.BoxGeometry(0.14, 0.95, 0.14), gx, 2.00, 0, 0, 0, (gx < 0 ? -0.7 : 0.7))
            );
        });
        // Twin amber caution beacon lights on top of gantry
        [-0.75, 0.75].forEach((bx) => {
            bodyParts.subwayHeadlight.push(
                this.transformGeo(new THREE.SphereGeometry(0.14, 8, 8), bx, 2.38, 0)
            );
        });
        // Flexible rubber warning clearance fringe hanging below
        bodyParts.darkIron.push(
            this.transformGeo(new THREE.BoxGeometry(2.45, 0.26, 0.06), 0, 1.72, 0)
        );
        bodyParts.contactShadow.push(
            this.transformGeo(this.sharedGeo.shadowQuad.clone(), 0, 0.02, 0, 0, 0, 0, 2.6, 1.0, 1.6)
        );

        // Flanking Left Track (-2.7): Modern Commuter Tram
        this.buildTrainCarComponents(bodyParts, null, gantryGroup, -2.7, 0, 'TRAM');

        // Flanking Right Track (+2.7): Tan Corrugated Cargo Boxcar
        this.buildTrainCarComponents(bodyParts, null, gantryGroup, 2.7, 0, 'CARGO');

        gantryGroup.add(new THREE.Mesh(this.mergeGeos(chevronParts), this.materials.chevronBarrier));

        Object.keys(bodyParts).forEach((matKey) => {
            const list = bodyParts[matKey];
            if (list.length > 0 && this.materials[matKey]) {
                gantryGroup.add(new THREE.Mesh(this.mergeGeos(list), this.materials[matKey]));
            }
        });

        return {
            type: 'DUCK',
            subType: 'CLEARANCE_GANTRY',
            group: gantryGroup,
            worldZ: zPos,
            requiredAction: 'DUCK',
            label: 'DUCK!',
            color: '#E67E22',
            prompted: false,
            passed: false,
            cleared: false,
            hitRadius: 1.75,
            lane: 'CENTER'
        };
    }

    // ZERO-ALLOCATION POOLED TRAP ACTIVATION (0.00ms!)
    activatePooledTrap(poolKey, trapZ) {
        const trap = this.trapPool[poolKey];
        trap.worldZ = trapZ;
        trap.group.position.set(0, 0, trapZ);
        trap.group.visible = true;
        trap.prompted = false;
        trap.passed = false;
        trap.cleared = false;
        if (trap.clashingLogs) {
            trap.clashed = false;
            trap.clashTimer = 0;
            this.setClashingLogsPose(trap, 0.30);
        }
        if (trap.cartBody) {
            trap.cartBody.rotation.z = 0;
        }
        if (trap.trainWheels) {
            for (let i = 0; i < trap.trainWheels.length; i++) {
                trap.trainWheels[i].rotation.x = 0;
            }
        }
        return trap;
    }

    releaseActiveTrap() {
        if (!this.activeTrap) return;
        if (this.activeTrap.pooled) {
            this.activeTrap.group.visible = false;
        } else {
            this.scene.remove(this.activeTrap.group);
        }
        this.activeTrap = null;
    }

    spawnNextTrap() {
        if (this.activeTrap || !this.isRunning || this.isGameOver) return;

        this.trapSpawnCount = (this.trapSpawnCount || 0) + 1;
        const motions = ['JUMP', 'DUCK', 'LEFT', 'RIGHT'];
        const pool = motions.filter(m => m !== this.lastTrapMotion);

        let chosenMotion;
        if (this.startingBiome === 'MINE') {
            chosenMotion = pool[Math.floor(Math.random() * pool.length)];
        } else if (this.trapSpawnCount === 1) {
            // Showcase the iconic Hooded Grim Reaper Runaway Cart right away (RIGHT dodge, matching 7b4ec428.jpg!)
            chosenMotion = 'RIGHT';
        } else if (this.trapSpawnCount === 2) {
            chosenMotion = 'DUCK';
        } else if (this.trapSpawnCount === 3) {
            chosenMotion = 'LEFT';
        } else {
            chosenMotion = pool[Math.floor(Math.random() * pool.length)];
        }
        this.lastTrapMotion = chosenMotion;

        const spawnDistance = Math.max(38, this.speed * 1.75);
        let trapZ = this.playerZ - spawnDistance;
        const biome = this.getBiomeAtZ(trapZ);

        let key = 'FIRE_HURDLE';

        if (chosenMotion === 'JUMP') {
            if (biome === 'MINE') {
                // Signature Subway Surfers Flanked Chevron Barrier Trap (Jump between Subway Train & Blue Container car!)
                key = 'RAILWAY_BARRIER';
                if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
            } else {
                const r = Math.random();
                if (r < 0.46) {
                    key = 'FIRE_HURDLE';
                    window.soundEngine.playFireRumble();
                } else if (r < 0.82) {
                    key = 'SPIKED_ROLLER';
                } else {
                    key = 'CHASM_GAP';
                    window.soundEngine.playChasmWind();
                }
            }
        } else if (chosenMotion === 'DUCK') {
            if (biome === 'MINE') {
                // Signature Subway Surfers Overhead Clearance Gantry Trap (Duck under striped bar flanked by trains!)
                key = 'RAILWAY_CLEARANCE_GANTRY';
                if (window.soundEngine.playPoliceWhistle) window.soundEngine.playPoliceWhistle();
            } else if (this.trapSpawnCount <= 2) {
                key = 'SPIKED_LINTEL';
            } else if (biome === 'BRIDGE') {
                // On the Wooden Suspension Bridge, feature the Twin Swinging Logs prominently (matching 00:12 in TikTok!)
                key = Math.random() < 0.70 ? 'SPIKED_LINTEL' : 'ARCH_TEMPLE';
            } else {
                const r = Math.random();
                if (r < 0.46) {
                    key = 'SPIKED_LINTEL';
                } else if (r < 0.78) {
                    key = 'OVERHEAD_FLAME';
                    window.soundEngine.playFireRumble();
                } else {
                    key = 'ARCH_TEMPLE';
                }
            }
        } else {
            const isLeft = (chosenMotion === 'LEFT');
            const r = Math.random();

            if (biome !== 'MINE' && this.trapSpawnCount === 1) {
                key = 'REAPER_CART_RIGHT';
                if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
            } else if (biome !== 'MINE' && this.trapSpawnCount === 3) {
                key = 'SPIKED_CART_LEFT';
                if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
            } else if (biome === 'MINE') {
                // Authentic Subway Surfers Train Traps: Silver Subway Trains, Blue Containers, Trams & Boxcars!
                if (r < 0.28) {
                    key = isLeft ? 'SUBWAY_TRAIN_LEFT' : 'SUBWAY_TRAIN_RIGHT';
                    if (window.soundEngine.playTrainHorn) window.soundEngine.playTrainHorn();
                } else if (r < 0.58) {
                    key = isLeft ? 'BLUE_CONTAINER_LEFT' : 'BLUE_CONTAINER_RIGHT';
                    if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
                } else if (r < 0.84) {
                    key = isLeft ? 'TRAM_LEFT' : 'TRAM_RIGHT';
                    if (window.soundEngine.playTramBell) window.soundEngine.playTramBell();
                } else {
                    key = isLeft ? 'CARGO_BOXCAR_LEFT' : 'CARGO_BOXCAR_RIGHT';
                    if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
                }
            } else if (biome === 'BRIDGE') {
                if (r < 0.38) {
                    key = isLeft ? 'SPIKED_CART_LEFT' : 'SPIKED_CART_RIGHT';
                    if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
                } else if (r < 0.72) {
                    key = isLeft ? 'BOULDER_LEFT' : 'BOULDER_RIGHT';
                    window.soundEngine.playBoulderRumble();
                } else {
                    key = isLeft ? 'REAPER_CART_LEFT' : 'REAPER_CART_RIGHT';
                    if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
                }
            } else {
                if (r < 0.36) {
                    key = isLeft ? 'IDOL_LEFT' : 'IDOL_RIGHT';
                } else if (r < 0.68) {
                    key = isLeft ? 'REAPER_CART_LEFT' : 'REAPER_CART_RIGHT';
                    if (window.soundEngine.playMinecartRumble) window.soundEngine.playMinecartRumble();
                } else if (r < 0.90) {
                    key = isLeft ? 'BOULDER_LEFT' : 'BOULDER_RIGHT';
                    window.soundEngine.playBoulderRumble();
                } else {
                    key = isLeft ? 'EDGE_LEFT' : 'EDGE_RIGHT';
                    window.soundEngine.playChasmWind();
                }
            }
        }

        const candidate = this.trapPool[key];
        if (candidate && candidate.oncomingSpeed) {
            // Spawn fast oncoming runaway carts further down the track so reaction window stays balanced (~1.7s)
            trapZ -= candidate.oncomingSpeed * 1.45;
        }

        this.activeTrap = this.activatePooledTrap(key, trapZ);
    }

    spawnCoins(chunkZ) {
        const laneIdx = Math.floor(Math.random() * 3);
        const laneX = this.lanes[laneIdx];
        let spawned = 0;

        for (let i = 0; i < this.coinPool.length && spawned < 5; i++) {
            const c = this.coinPool[i];
            if (!c.inUse) {
                const zOff = -14 + spawned * 2.8;
                c.inUse = true;
                c.collected = false;
                c.laneIndex = laneIdx;
                c.worldZ = chunkZ + zOff;
                c.holder.position.set(laneX, 0, c.worldZ);
                c.holder.visible = true;
                this.coins.push(c);
                spawned++;
            }
        }
    }

    // ============================================================
    // GAME LIFECYCLE & ULTRA-SMOOTH MAIN LOOP
    // ============================================================
    start() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.resetWorld();
        this.isRunning = true;
        this.isGameOver = false;
        this.lastTime = performance.now();

        window.soundEngine.startBGM(125);
        this.animFrameId = requestAnimationFrame((time) => this.gameLoop(time));
    }

    resetWorld() {
        while (this.chunks.length > 0) {
            this.recycleChunk(this.chunks.pop());
        }
        while (this.activePortals.length > 0) {
            const p = this.activePortals.pop();
            p.mesh.visible = false;
            this.portalPool.push(p.mesh);
        }
        this.releaseActiveTrap();

        for (let i = 0; i < this.coinPool.length; i++) {
            this.coinPool[i].inUse = false;
            this.coinPool[i].holder.visible = false;
        }
        this.coins.length = 0;
        this.animatedFlames.length = 0;

        this.trapCooldownTimer = 1.2;
        this.trapSpawnCount = 0;
        this.lastTrapType = null;
        this.lastTrapMotion = null;

        this.currentLaneIndex = 1;
        this.targetPlayerX = 0;
        this.playerX = 0;
        this.playerY = 0;
        this.playerZ = 0;
        this.smoothBank = 0;
        this.isJumping = false;
        this.isDucking = false;
        this.jumpProgress = 0;
        this.duckProgress = 0;
        this.continuousTargetX = 0;
        this.continuousBodyY = 0;
        this.rawBodyDiffX = 0;
        this.rawBodyDiffY = 0;
        this.lastKeyboardSteerTime = -9999;

        this.speed = this.baseSpeed;
        this.distance = 0;
        this.score = 0;
        this.combo = 1;
        this.comboStreak = 0;
        this.lives = this.maxLives;
        this.reactionTimes = [];

        for (let i = 0; i < this.visibleChunks; i++) {
            this.generateChunk(-i * this.chunkLength, i);
        }
    }

    setCameraMode(mode) {
        this.cameraMode = mode;
        if (this.playerGroup) {
            this.playerGroup.visible = (mode !== 'firstPerson');
        }
        if (this.chaserGroup) {
            this.chaserGroup.visible = (mode !== 'firstPerson');
        }
    }

    gameLoop(currentTime) {
        if (!this.isRunning) return;

        // Clamp delta smoothly to avoid large frame jumps
        const rawDelta = (currentTime - this.lastTime) * 0.001;
        const delta = Math.max(0.001, Math.min(rawDelta, 0.05));
        this.lastTime = currentTime;

        if (!this.isPaused && !this.isGameOver) {
            this.update(delta);
        }

        this.renderer.render(this.scene, this.camera);
        if (this.isRunning) {
            this.animFrameId = requestAnimationFrame((time) => this.gameLoop(time));
        }
    }

    update(delta) {
        // 1. Steady Constant Forward Pace
        const forwardStep = this.speed * delta;
        this.playerZ -= forwardStep;
        this.distance += forwardStep;
        this.speed = this.baseSpeed;

        // 2. Smooth Biome Atmosphere & Single Pooled Accent Light (Subway Surfers sunny blue skies on Railway Lines!)
        const currentBiome = this.getBiomeAtZ(this.playerZ - 12);
        const inMine = (currentBiome === 'MINE');
        const fogLerp = 1 - Math.exp(-3.8 * delta);
        const targetFogColor = inMine ? this.srgb(0x8ac4f8) : this.srgb(this.skyHazeHex);
        const targetFogDensity = inMine ? 0.0028 : 0.0030;
        this.scene.fog.color.lerp(targetFogColor, fogLerp);
        this.scene.fog.density += (targetFogDensity - this.scene.fog.density) * fogLerp;

        const targetSun = inMine ? 1.75 : 1.6;
        const targetHemi = inMine ? 0.75 : 0.62;
        this.sunLight.intensity += (targetSun - this.sunLight.intensity) * fogLerp;
        this.hemiLight.intensity += (targetHemi - this.hemiLight.intensity) * fogLerp;

        if (this.activeTrap && this.activeTrap.hasFireGlow) {
            this.accentLight.color.setHex(0xff6a00);
            this.accentLight.intensity = 2.0;
            this.accentLight.position.set(0, 1.8, this.activeTrap.worldZ + 0.6);
        } else {
            this.accentLight.intensity = 0.0;
        }

        // 3. Butter-Smooth Frame-Rate-Independent Left / Right Tracking
        const keyboardActive = (performance.now() - this.lastKeyboardSteerTime) < 1200;
        const useContinuous = this.isContinuousTracking && !keyboardActive;
        const desiredX = useContinuous ? this.continuousTargetX : this.lanes[this.currentLaneIndex];
        this.targetPlayerX = desiredX;

        const steerAlpha = 1 - Math.exp(-26 * delta);
        this.playerX += (desiredX - this.playerX) * steerAlpha;

        // 4. Instant Lag-Free Vertical Jump / Duck Kinematics
        let totalY = 0;

        if (this.isJumping) {
            this.jumpProgress += delta / this.jumpDuration;
            if (this.jumpProgress >= 1.0) {
                this.isJumping = false;
                this.jumpProgress = 0;
            } else {
                // Fast athletic liftoff arc (never dragged down by webcam squat dip!)
                totalY = Math.sin(this.jumpProgress * Math.PI) * 2.35;
            }
        } else if (this.isDucking) {
            this.duckProgress += delta / this.duckDuration;
            if (this.duckProgress >= 1.0) {
                this.isDucking = false;
                this.duckProgress = 0;
            } else {
                totalY = -Math.sin(this.duckProgress * Math.PI) * 0.95;
            }
        } else if (useContinuous) {
            totalY = this.continuousBodyY;
        }

        this.playerY = totalY;

        this.updatePlayerAvatar();
        this.updateCamera(delta);
        this.updateWorldChunks();
        this.updateSingleTrap(delta);

        if (this.isGameOver) return;

        this.updateCoins(delta);
        this.animateFlamesAndTraps(delta);

        if (this.distantGroup) {
            this.distantGroup.position.z = this.playerZ;
        }

        if (this.onHUDUpdate) {
            this.onHUDUpdate({
                distance: Math.floor(this.distance),
                score: this.score,
                combo: this.combo,
                lives: this.lives,
                speed: Math.floor(this.speed * 3.6),
                currentLane: this.currentLaneIndex - 1
            });
        }
    }

    updatePlayerAvatar() {
        if (!this.playerGroup || !this.playerGroup.visible) return;

        this.playerGroup.position.set(this.playerX, Math.max(0, this.playerY), this.playerZ);

        const runCadence = this.distance * 1.8;
        if (!this.isJumping && !this.isDucking) {
            this.leftLeg.rotation.x = Math.sin(runCadence) * 0.65;
            this.rightLeg.rotation.x = -Math.sin(runCadence) * 0.65;
            this.leftArm.rotation.x = -Math.sin(runCadence) * 0.55;
            this.rightArm.rotation.x = Math.sin(runCadence) * 0.55;
            this.playerGroup.rotation.z = (this.targetPlayerX - this.playerX) * -0.12;
            this.playerGroup.scale.set(1, 1, 1);
        } else if (this.isDucking) {
            this.playerGroup.scale.set(1.15, 0.5, 1.15);
        } else {
            this.playerGroup.scale.set(1, 1, 1);
            this.leftLeg.rotation.x = 0.4;
            this.rightLeg.rotation.x = 0.4;
        }

        // Animate Chasing Security Inspector & Bulldog (Matches 9468adf5.jpg & f565e49c.jpg!)
        if (this.chaserGroup && this.chaserGroup.visible) {
            this.chaserGroup.position.set(this.playerX * 0.85, 0, this.playerZ + 4.2);
            if (this.inspLeftLeg) this.inspLeftLeg.rotation.x = -Math.sin(runCadence) * 0.70;
            if (this.inspRightLeg) this.inspRightLeg.rotation.x = Math.sin(runCadence) * 0.70;
            if (this.inspLeftArm) this.inspLeftArm.rotation.x = Math.sin(runCadence) * 0.60;
            if (this.inspRightArm) this.inspRightArm.rotation.x = -Math.sin(runCadence) * 0.60;

            const dogCadence = this.distance * 3.6;
            if (this.dogLeg1) this.dogLeg1.rotation.x = Math.sin(dogCadence) * 0.75;
            if (this.dogLeg2) this.dogLeg2.rotation.x = -Math.sin(dogCadence) * 0.75;
            if (this.dogLeg3) this.dogLeg3.rotation.x = -Math.sin(dogCadence) * 0.75;
            if (this.dogLeg4) this.dogLeg4.rotation.x = Math.sin(dogCadence) * 0.75;
        }
    }

    updateCamera(delta = 0.016) {
        // Natural athletic running stride cadence: vertical footfall bounce + subtle lateral stride shift + smooth bank
        const grounded = (!this.isJumping && !this.isDucking);
        const stridePhase = this.distance * 0.78;
        const stepBob = grounded ? Math.abs(Math.sin(stridePhase)) * 0.068 - 0.032 : 0;
        const strideSway = grounded ? Math.cos(stridePhase) * 0.026 : 0;
        const rawBank = (this.targetPlayerX - this.playerX) * -0.038 - strideSway * 0.32;
        this.smoothBank += (rawBank - this.smoothBank) * (1 - Math.exp(-16 * delta));

        if (this.cameraMode === 'firstPerson') {
            const eyeHeight = Math.max(0.68, 1.85 + this.playerY + stepBob);
            const pitchLookOffset = this.isDucking ? -0.32 : (this.isJumping ? 0.12 : -0.19);
            this.camera.position.set(this.playerX + strideSway, eyeHeight, this.playerZ);
            this.camera.lookAt(this.playerX + strideSway * 0.35, eyeHeight + pitchLookOffset, this.playerZ - 22);
            this.camera.rotation.z = this.smoothBank;
        } else {
            // Authentic Subway Surfers 3rd-Person Perspective (Framing Runner + Chasing Guard & Dog ahead!)
            const camTargetY = 3.9 + this.playerY * 0.5 + stepBob * 0.5;
            this.camera.position.set(this.playerX * 0.85 + strideSway * 0.5, camTargetY, this.playerZ + 7.8);
            this.camera.lookAt(this.playerX, 1.8 + this.playerY, this.playerZ - 14);
            this.camera.rotation.z = this.smoothBank * 0.6;
        }
    }

    updateWorldChunks() {
        const oldestChunk = this.chunks[0];
        if (oldestChunk && oldestChunk.z > this.playerZ + this.chunkLength * 1.25) {
            this.chunks.shift();
            this.recycleChunk(oldestChunk);

            const newestChunk = this.chunks[this.chunks.length - 1];
            this.generateChunk(newestChunk.z - this.chunkLength, newestChunk.index + 1);
        }

        for (let i = this.activePortals.length - 1; i >= 0; i--) {
            if (this.activePortals[i].z > this.playerZ + 20) {
                const p = this.activePortals.splice(i, 1)[0];
                p.mesh.visible = false;
                this.portalPool.push(p.mesh);
            }
        }
    }

    updateSingleTrap(delta) {
        if (!this.activeTrap) {
            this.trapCooldownTimer -= delta;
            if (this.trapCooldownTimer <= 0) {
                this.spawnNextTrap();
            }
            return;
        }

        const trap = this.activeTrap;
        const distToPlayer = trap.worldZ - this.playerZ;
        const closingSpeed = this.speed + (trap.oncomingSpeed || 0);

        if (!trap.prompted && distToPlayer < 0 && distToPlayer > -closingSpeed * 1.4) {
            trap.prompted = true;
            this.reactionStartTime = performance.now();
            window.soundEngine.speakCue(trap.type);

            if (this.onReflexCue) {
                this.onReflexCue({
                    type: trap.type,
                    label: trap.label,
                    color: trap.color,
                    timeMs: Math.round((-distToPlayer / closingSpeed) * 1000)
                });
            }
        }

        const hitWindow = Math.max(trap.hitRadius, closingSpeed * delta * 1.5);
        if (!trap.passed && distToPlayer >= -hitWindow) {
            let success = false;

            if (trap.type === 'JUMP') {
                if (this.isJumping || this.playerY > 0.45) success = true;
            } else if (trap.type === 'DUCK') {
                if (this.isDucking || this.playerY < -0.20) success = true;
            } else if (trap.type === 'LEFT') {
                if (this.playerX < -0.60 || this.currentLaneIndex === 0) success = true;
            } else if (trap.type === 'RIGHT') {
                if (this.playerX > 0.60 || this.currentLaneIndex === 2) success = true;
            }

            trap.passed = true;
            if (success) {
                trap.cleared = true;
                this.handleReflexSuccess(trap);
            } else {
                this.handleReflexFailure(trap);
            }

            this.trapCooldownTimer = 1.2;
        }

        if (distToPlayer > 16) {
            this.releaseActiveTrap();
        }
    }

    handleReflexSuccess() {
        const reactionTime = Math.round(performance.now() - this.reactionStartTime);
        this.reactionTimes.push(reactionTime);

        const rating = (reactionTime < 460) ? 'PERFECT' : 'GREAT';

        this.comboStreak++;
        if (this.comboStreak >= 3) {
            this.combo = Math.min(8, this.combo + 1);
            this.comboStreak = 0;
        }

        window.soundEngine.playSuccessRating(rating);

        if (this.onReflexFeedback) {
            this.onReflexFeedback({
                status: rating,
                text: `${rating}!`,
                color: rating === 'PERFECT' ? '#FFE600' : '#00FFCC',
                reactionMs: reactionTime
            });
        }
    }

    handleReflexFailure() {
        this.lives--;
        this.combo = 1;
        this.comboStreak = 0;

        window.soundEngine.playHit();

        if (this.onReflexFeedback) {
            this.onReflexFeedback({
                status: 'MISS',
                text: 'MISS! -1 LIFE',
                color: '#FF2222',
                reactionMs: 0
            });
        }

        if (this.lives <= 0) {
            this.gameOver();
        }
    }

    updateCoins(delta) {
        const spinStep = delta * 4.2;
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i];
            coin.spinMesh.rotation.y += spinStep;

            if (!coin.collected) {
                const distZ = Math.abs(coin.worldZ - this.playerZ);
                if (distZ < 1.45) {
                    const distX = Math.abs(coin.holder.position.x - this.playerX);
                    const isMatchingLane = (this.currentLaneIndex === coin.laneIndex) || (distX < 1.35);
                    if (isMatchingLane && Math.abs(this.playerY) < 1.65) {
                        coin.collected = true;
                        coin.holder.visible = false;
                        this.score += 1;
                        window.soundEngine.playCoin();
                    }
                }
            }

            if (coin.worldZ > this.playerZ + 12) {
                coin.inUse = false;
                coin.holder.visible = false;
                this.coins.splice(i, 1);
            }
        }
    }

    animateFlamesAndTraps(delta = 0.016) {
        // Drive all real-time GLSL FBM roaring fire & ember shaders on the GPU in 1 uniform update!
        const nowSec = performance.now() * 0.001;
        this.fireUniforms.uTime.value = nowSec;

        if (this.activeTrap && this.activeTrap.boulderMesh) {
            this.activeTrap.boulderMesh.rotation.x -= delta * 7.5;
            this.activeTrap.group.position.z += delta * 4.5;
            this.activeTrap.worldZ = this.activeTrap.group.position.z;
        }

        if (this.activeTrap && this.activeTrap.oncomingSpeed) {
            const trap = this.activeTrap;
            trap.group.position.z += delta * trap.oncomingSpeed;
            trap.worldZ = trap.group.position.z;
            if (trap.cartWheels) {
                trap.cartWheels.rotation.x += delta * 14.5;
            }
            if (trap.trainWheels) {
                for (let i = 0; i < trap.trainWheels.length; i++) {
                    trap.trainWheels[i].rotation.x += delta * 18.0;
                }
            }
            if (trap.cartBody) {
                trap.cartBody.rotation.z = Math.sin(nowSec * 15.0) * 0.022;
            }
        }

        if (this.activeTrap && this.activeTrap.spinnerMesh) {
            this.activeTrap.spinnerMesh.rotation.x -= delta * 8.5;
        }

        if (this.activeTrap && this.activeTrap.sawWheelsZ) {
            const saws = this.activeTrap.sawWheelsZ;
            for (let i = 0; i < saws.length; i++) {
                saws[i].rotation.z -= delta * (i === 0 ? 9.5 : -11.5);
            }
        }

        // Real-time pendulum swing & center clash recoil for the Twin Swinging Battering Logs Trap!
        if (this.activeTrap && this.activeTrap.clashingLogs) {
            const trap = this.activeTrap;
            const distAhead = this.playerZ - trap.worldZ;
            let theta = 0;

            if (distAhead >= 31.0) {
                // Held wide open on left & right over parapets/railings (~5.9m center gap, matches abfc4938.jpg!)
                theta = 0.30;
            } else if (distAhead > 11.5) {
                // Accelerating gravity pendulum swing inward across the road (matches 708ed2d4.jpg!)
                const u = (31.0 - distAhead) / 19.5;
                theta = 0.30 * (1.0 - u * u);
            } else {
                // Logs SLAM together in the center right ahead of the runner (matches c44a4033.jpg!)
                if (!trap.clashed) {
                    trap.clashed = true;
                    trap.clashTimer = 0;
                    if (window.soundEngine && window.soundEngine.playLogClash) {
                        window.soundEngine.playLogClash();
                    }
                }
                trap.clashTimer += delta;
                theta = Math.abs(Math.sin(trap.clashTimer * 24.0)) * Math.exp(-trap.clashTimer * 11.0) * 0.012;
            }

            this.setClashingLogsPose(trap, theta);
        }
    }

    // ============================================================
    // CONTINUOUS 1:1 BODY MOTION MAPPING (SMOOTH & INSTANT)
    // ============================================================
    setBodyContinuous(diffX, diffY) {
        this.isContinuousTracking = true;
        this.rawBodyDiffX = diffX;
        this.rawBodyDiffY = diffY;

        this.continuousTargetX = Math.max(-3.6, Math.min(3.6, diffX * 23.0));

        // Prevent pre-jump slight knee-flex from dipping camera before jump liftoff!
        if (diffY > 0.022) {
            this.continuousBodyY = -Math.min(1.15, (diffY - 0.022) * 12.5);
        } else if (diffY < -0.012) {
            this.continuousBodyY = Math.min(1.75, (-diffY - 0.012) * 14.5);
        } else {
            this.continuousBodyY = 0;
        }

        if (this.continuousTargetX < -1.05) {
            this.currentLaneIndex = 0;
        } else if (this.continuousTargetX > 1.05) {
            this.currentLaneIndex = 2;
        } else {
            this.currentLaneIndex = 1;
        }
    }

    // ============================================================
    // PLAYER ACTION INPUTS (INSTANT JUMP, DUCK, LEFT, RIGHT)
    // ============================================================
    triggerJump() {
        if (this.isJumping || this.isGameOver || !this.isRunning) return;
        this.isJumping = true;
        this.isDucking = false;
        this.jumpProgress = 0;
        this.duckProgress = 0;
        window.soundEngine.playJump();
    }

    triggerDuck() {
        if (this.isDucking || this.isGameOver || !this.isRunning) return;
        this.isDucking = true;
        this.isJumping = false;
        this.duckProgress = 0;
        this.jumpProgress = 0;
        window.soundEngine.playDuck();
    }

    triggerMoveLeft(fromKeyboard = false) {
        if (fromKeyboard) this.lastKeyboardSteerTime = performance.now();
        if (this.currentLaneIndex > 0) {
            this.currentLaneIndex--;
            window.soundEngine.playDodge(-1);
        }
    }

    triggerMoveRight(fromKeyboard = false) {
        if (fromKeyboard) this.lastKeyboardSteerTime = performance.now();
        if (this.currentLaneIndex < 2) {
            this.currentLaneIndex++;
            window.soundEngine.playDodge(1);
        }
    }

    triggerCenter() {
        this.currentLaneIndex = 1;
    }

    bindKeyboardControls() {
        window.addEventListener('keydown', (e) => {
            if (!this.isRunning || this.isGameOver || e.repeat) return;

            switch (e.code) {
                case 'ArrowUp':
                case 'KeyW':
                case 'Space':
                    e.preventDefault();
                    this.triggerJump();
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    e.preventDefault();
                    this.triggerDuck();
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    e.preventDefault();
                    this.triggerMoveLeft(true);
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    e.preventDefault();
                    this.triggerMoveRight(true);
                    break;
                case 'KeyV':
                case 'KeyC':
                    e.preventDefault();
                    this.setCameraMode(this.cameraMode === 'firstPerson' ? 'thirdPerson' : 'firstPerson');
                    break;
            }
        });
    }

    gameOver() {
        this.isRunning = false;
        this.isGameOver = true;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        window.soundEngine.stopBGM();

        if (this.onHUDUpdate) {
            this.onHUDUpdate({
                distance: Math.floor(this.distance),
                score: this.score,
                combo: this.combo,
                lives: Math.max(0, this.lives),
                speed: Math.floor(this.speed * 3.6),
                currentLane: this.currentLaneIndex - 1
            });
        }

        let avgReaction = 0;
        if (this.reactionTimes.length > 0) {
            avgReaction = Math.round(
                this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length
            );
        }

        if (this.onGameOver) {
            this.onGameOver({
                distance: Math.floor(this.distance),
                score: this.score,
                avgReaction: avgReaction
            });
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer || !this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}

window.templeGame = new TempleGame();
