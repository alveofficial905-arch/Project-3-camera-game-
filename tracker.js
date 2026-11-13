// ============================================================
// TEMPLE RUN IRL - ULTRA-LOW-LATENCY WEBCAM MOTION TRACKER
// Non-blocking 320x240 Pose pipeline, zero-blur batched canvas,
// velocity-assisted instant Jump & symmetric 1:1 Left/Right
// ============================================================

class MotionTracker {
    constructor() {
        this.videoElement = null;
        this.pipCanvas = null;
        this.pipCtx = null;
        this.pose = null;
        this.isTracking = false;
        this.useMediaPipe = false;
        this.isBusy = false;
        this.lastVideoTime = -1;
        this.lastSendTime = 0;

        // Calibration baselines
        this.baselineY = 0.5;
        this.baselineX = 0.5;
        this.isCalibrating = false;
        this.calibrationSamples = [];
        this.calibrated = false;
        this.warmupSamples = [];

        // High-sensitivity instant thresholds
        this.jumpThreshold = 0.036;
        this.duckThreshold = 0.048;
        this.dodgeThreshold = 0.032;

        // Current physical state & low-latency tracking
        this.currentX = 0.5;
        this.currentY = 0.5;
        this.prevY = 0.5;
        this.smoothX = 0.5;
        this.smoothY = 0.5;
        this.currentLane = 0;
        this.currentState = 'STANDING';

        // Cooldowns & landing guard
        this.lastJumpTime = 0;
        this.lastDuckTime = 0;
        this.cooldownMs = 340;

        // Workout stats (kept for internal compatibility)
        this.workoutStats = {
            squatCount: 0,
            jumpCount: 0,
            dodgeCount: 0,
            activeSeconds: 0,
            calories: 0
        };

        // Callback hooks
        this.onAction = null;
        this.onContinuousMotion = null;
        this.onStateChange = null;
    }

    async init(videoElement, pipCanvas, onActionCallback) {
        this.videoElement = videoElement;
        this.pipCanvas = pipCanvas;
        this.pipCtx = pipCanvas.getContext('2d', { alpha: false, desynchronized: true }) || pipCanvas.getContext('2d');
        this.onAction = onActionCallback;

        try {
            // 320x240 @ 30fps matches MediaPipe Lite's 256x256 input with 4x less main-thread copy cost!
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 320 },
                    height: { ideal: 240 },
                    frameRate: { ideal: 30, max: 30 },
                    facingMode: 'user'
                },
                audio: false
            });

            this.videoElement.setAttribute('autoplay', '');
            this.videoElement.setAttribute('muted', '');
            this.videoElement.setAttribute('playsinline', '');
            this.videoElement.muted = true;
            this.videoElement.srcObject = stream;
            await new Promise((resolve) => {
                let resolved = false;
                const done = () => {
                    if (resolved) return;
                    resolved = true;
                    try { this.videoElement.play(); } catch (_) {}
                    resolve();
                };
                this.videoElement.onloadedmetadata = done;
                setTimeout(done, 1500);
            });

            this.pipCanvas.width = 320;
            this.pipCanvas.height = 240;

            await this.initMediaPipe();
            this.isTracking = true;
            this.startLoop();
            return { success: true };
        } catch (err) {
            console.error("Webcam initialization failed:", err);
            return { success: false, error: err.message };
        }
    }

    async initMediaPipe() {
        if (typeof window.Pose !== 'undefined') {
            try {
                this.pose = new window.Pose({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
                });

                this.pose.setOptions({
                    modelComplexity: 0,      // Lite model for fastest inference
                    smoothLandmarks: false,  // Disable internal lag filter for instant Jump & Left/Right!
                    enableSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                this.pose.onResults((results) => this.onPoseResults(results));
                this.useMediaPipe = true;
            } catch (e) {
                console.warn("MediaPipe Pose failed to initialize, using optical fallback:", e);
                this.useMediaPipe = false;
            }
        } else {
            this.useMediaPipe = false;
        }
    }

    // Non-blocking frame-gated loop so Three.js WebGL gets full 60-120 FPS headroom
    startLoop() {
        const tick = () => {
            if (!this.isTracking) return;

            const now = performance.now();
            const vid = this.videoElement;
            const hasNewVideoFrame = vid && vid.readyState >= 2 && vid.currentTime !== this.lastVideoTime;

            if (hasNewVideoFrame && !this.isBusy && (now - this.lastSendTime >= 30)) {
                this.lastVideoTime = vid.currentTime;
                this.lastSendTime = now;

                if (this.useMediaPipe && this.pose) {
                    this.isBusy = true;
                    this.pose.send({ image: vid }).then(() => {
                        this.isBusy = false;
                    }).catch(() => {
                        this.isBusy = false;
                        this.processOpticalFrame();
                    });
                } else {
                    this.processOpticalFrame();
                }
            }

            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    onPoseResults(results) {
        this.renderPIP(results.image, results.poseLandmarks);

        if (!results.poseLandmarks) return;

        const lm = results.poseLandmarks;
        const nose = lm[0];
        const leftShoulder = lm[11];
        const rightShoulder = lm[12];

        const rawX = (leftShoulder.x + rightShoulder.x) * 0.5;
        const currentX = 1.0 - rawX;
        const currentY = nose.y * 0.4 + (leftShoulder.y + rightShoulder.y) * 0.3;

        this.processCoordinates(currentX, currentY);
    }

    processOpticalFrame() {
        const ctx = this.pipCtx;
        const w = this.pipCanvas.width;
        const h = this.pipCanvas.height;

        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(this.videoElement, 0, 0, w, h);
        ctx.restore();

        try {
            const frame = ctx.getImageData(0, 0, w, h);
            const data = frame.data;
            let sumX = 0, sumY = 0, count = 0;

            for (let y = 0; y < h; y += 8) {
                for (let x = 0; x < w; x += 8) {
                    const idx = (y * w + x) * 4;
                    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) * 0.3333;
                    if (brightness < 200) {
                        sumX += x;
                        sumY += y;
                        count++;
                    }
                }
            }

            if (count > 0) {
                this.processCoordinates((sumX / count) / w, (sumY / count) / h);
            }
        } catch (e) {}

        this.drawGuides();
    }

    processCoordinates(normX, normY) {
        this.currentX = normX;
        this.currentY = normY;

        if (this.isCalibrating) {
            this.calibrationSamples.push({ x: normX, y: normY });
            return;
        }

        if (!this.calibrated) {
            this.warmupSamples.push({ x: normX, y: normY });
            this.baselineX = normX;
            this.baselineY = normY;
            this.smoothX = normX;
            this.smoothY = normY;
            this.prevY = normY;
            if (this.warmupSamples.length >= 6) {
                let sx = 0, sy = 0;
                for (let i = 0; i < this.warmupSamples.length; i++) {
                    sx += this.warmupSamples[i].x;
                    sy += this.warmupSamples[i].y;
                }
                this.baselineX = sx / this.warmupSamples.length;
                this.baselineY = sy / this.warmupSamples.length;
                this.calibrated = true;
            }
            return;
        }

        // Ultra-fast low-latency filter (84% live sample, 16% history -> zero perceptible delay!)
        this.prevY = this.smoothY;
        this.smoothX = this.smoothX * 0.16 + normX * 0.84;
        this.smoothY = this.smoothY * 0.15 + normY * 0.85;

        const diffX = this.smoothX - this.baselineX;
        const diffY = this.smoothY - this.baselineY;
        const velY = this.smoothY - this.prevY; // negative = rapid upward jump liftoff!

        // Continuous 1:1 lateral & vertical body streaming
        if (this.onContinuousMotion) {
            this.onContinuousMotion({
                diffX: diffX,
                diffY: diffY,
                velY: velY,
                normX: this.smoothX,
                normY: this.smoothY
            });
        }

        const now = performance.now();

        // 1. INSTANT JUMP & DUCK DETECTION (velocity-assisted liftoff + post-jump landing guard)
        const jumpTriggered = (diffY < -this.jumpThreshold) || (diffY < -0.018 && velY < -0.017);

        if (jumpTriggered) {
            if (this.currentState !== 'JUMPING' && (now - this.lastJumpTime > this.cooldownMs)) {
                this.currentState = 'JUMPING';
                this.lastJumpTime = now;
                this.workoutStats.jumpCount++;
                if (this.onAction) this.onAction('JUMP');
            }
        } else if (diffY > this.duckThreshold && (now - this.lastJumpTime > 520)) {
            if (this.currentState !== 'DUCKING' && (now - this.lastDuckTime > this.cooldownMs)) {
                this.currentState = 'DUCKING';
                this.lastDuckTime = now;
                this.workoutStats.squatCount++;
                if (this.onAction) this.onAction('DUCK');
            }
        } else if (diffY > -this.jumpThreshold * 0.65 && diffY < this.duckThreshold * 0.75) {
            if (this.currentState !== 'STANDING') {
                this.currentState = 'STANDING';
                if (this.onAction) this.onAction('STAND');
            }
        }

        // 2. INSTANT HORIZONTAL LANE DODGING
        let newLane = 0;
        if (diffX < -this.dodgeThreshold) newLane = -1;
        else if (diffX > this.dodgeThreshold) newLane = 1;

        if (newLane !== this.currentLane) {
            this.currentLane = newLane;
            this.workoutStats.dodgeCount++;
            if (newLane === -1 && this.onAction) this.onAction('LEFT');
            else if (newLane === 1 && this.onAction) this.onAction('RIGHT');
            else if (newLane === 0 && this.onAction) this.onAction('CENTER');
        }
    }

    // --- ZERO-BLUR BATCHED PIP RENDERER (FAST 2D CANVAS) ---
    renderPIP(image, landmarks) {
        const ctx = this.pipCtx;
        const w = this.pipCanvas.width;
        const h = this.pipCanvas.height;

        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(image, 0, 0, w, h);
        ctx.restore();

        if (landmarks) {
            this.drawSkeleton(landmarks, w, h);
        }
        this.drawGuides();
    }

    drawSkeleton(lm, w, h) {
        const ctx = this.pipCtx;
        const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
        ];

        // Single batched path (zero shadowBlur passes!)
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#00FFCC';
        ctx.beginPath();
        for (let c = 0; c < connections.length; c++) {
            const p1 = lm[connections[c][0]];
            const p2 = lm[connections[c][1]];
            if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
                ctx.moveTo((1.0 - p1.x) * w, p1.y * h);
                ctx.lineTo((1.0 - p2.x) * w, p2.y * h);
            }
        }
        ctx.stroke();

        ctx.fillStyle = '#00FFFF';
        ctx.beginPath();
        const keyPoints = [11, 12, 13, 14, 15, 16, 23, 24];
        for (let k = 0; k < keyPoints.length; k++) {
            const p = lm[keyPoints[k]];
            if (p && p.visibility > 0.5) {
                const x = (1.0 - p.x) * w;
                const y = p.y * h;
                ctx.moveTo(x + 3.5, y);
                ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            }
        }
        ctx.fill();

        const nose = lm[0];
        if (nose && nose.visibility > 0.5) {
            ctx.fillStyle = '#FFE600';
            ctx.beginPath();
            ctx.arc((1.0 - nose.x) * w, nose.y * h, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawGuides() {
        const ctx = this.pipCtx;
        const w = this.pipCanvas.width;
        const h = this.pipCanvas.height;
        const centerX = w * 0.5;
        const centerY = h * 0.5;

        ctx.save();
        ctx.setLineDash([]);

        // Center crosshair dark outline + bright green line (batched, no shadowBlur!)
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.moveTo(centerX, 0); ctx.lineTo(centerX, h);
        ctx.moveTo(0, centerY); ctx.lineTo(w, centerY);
        ctx.stroke();

        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#00FF44';
        ctx.beginPath();
        ctx.moveTo(centerX, 0); ctx.lineTo(centerX, h);
        ctx.moveTo(0, centerY); ctx.lineTo(w, centerY);
        ctx.moveTo(centerX + 7, centerY);
        ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
        ctx.stroke();

        // Threshold lines
        const baseY = this.baselineY * h;
        const jumpY = (this.baselineY - this.jumpThreshold) * h;
        const duckY = (this.baselineY + this.duckThreshold) * h;

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.75)';
        ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 140, 0, 0.85)';
        ctx.beginPath(); ctx.moveTo(0, jumpY); ctx.lineTo(w, jumpY); ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 230, 0, 0.85)';
        ctx.beginPath(); ctx.moveTo(0, duckY); ctx.lineTo(w, duckY); ctx.stroke();

        // Current body marker
        ctx.setLineDash([]);
        ctx.fillStyle = this.currentState === 'JUMPING' ? '#FF4500' :
                        this.currentState === 'DUCKING' ? '#00E5FF' : '#00FF66';
        ctx.beginPath();
        ctx.arc(this.smoothX * w, this.smoothY * h, 5.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    startCalibration(countdownCallback, completeCallback) {
        this.isCalibrating = true;
        this.calibrationSamples = [];

        let secondsLeft = 3;
        countdownCallback(secondsLeft);

        const timer = setInterval(() => {
            secondsLeft--;
            if (secondsLeft > 0) {
                countdownCallback(secondsLeft);
            } else {
                clearInterval(timer);
                this.finishCalibration();
                completeCallback();
            }
        }, 1000);
    }

    finishCalibration() {
        this.isCalibrating = false;
        if (this.calibrationSamples.length > 3) {
            let sumX = 0, sumY = 0;
            this.calibrationSamples.forEach(s => {
                sumX += s.x;
                sumY += s.y;
            });
            this.baselineX = sumX / this.calibrationSamples.length;
            this.baselineY = sumY / this.calibrationSamples.length;
        } else {
            this.baselineX = this.currentX || 0.5;
            this.baselineY = this.currentY || 0.45;
        }
        this.smoothX = this.baselineX;
        this.smoothY = this.baselineY;
        this.prevY = this.baselineY;
        this.calibrated = true;
    }

    setJumpSensitivity(val) {
        this.jumpThreshold = 0.14 - (val * 0.009);
    }

    setDuckSensitivity(val) {
        this.duckThreshold = 0.16 - (val * 0.009);
    }

    setDodgeSensitivity(val) {
        this.dodgeThreshold = 0.15 - (val * 0.009);
    }
}

window.motionTracker = new MotionTracker();
