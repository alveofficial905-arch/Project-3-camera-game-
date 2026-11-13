// ============================================================
// TEMPLE RUN IRL - ZERO-LAG PROCEDURAL WEB AUDIO SYNTHESIZER
// Pre-allocated shared noise buffer & non-blocking voice cues
// ============================================================

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.noiseBuffer = null;
        this.isMuted = false;
        this.voiceEnabled = true;
        this.tempo = 125; // BPM
        this.isPlayingBGM = false;
        this.bgmTimer = null;
        this.beatCount = 0;
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext({ latencyHint: 'interactive' });
            this.createSharedNoiseBuffer();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // Pre-allocate ONE reusable 1.0s noise buffer once at startup (zero allocations on jump/dodge!)
    createSharedNoiseBuffer() {
        if (!this.ctx || this.noiseBuffer) return;
        const length = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }

    setMuted(muted) {
        this.isMuted = muted;
        if (muted && this.isPlayingBGM) {
            this.stopBGM();
        }
    }

    setVoiceEnabled(enabled) {
        this.voiceEnabled = enabled;
    }

    // --- ZERO-LATENCY PROCEDURAL SOUND EFFECTS ---

    playJump() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(540, now + 0.24);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(420, now);
        filter.frequency.exponentialRampToValueAtTime(1250, now + 0.24);

        gain.gain.setValueAtTime(0.36, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.26);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.27);

        this.playNoiseWhoosh(0.22, 0.24, 800, 2400);
    }

    playDuck() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.26);

        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.29);

        this.playNoiseWhoosh(0.24, 0.28, 1200, 400);
    }

    playDodge(direction) {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        const startFreq = direction < 0 ? 300 : 250;
        const endFreq = direction < 0 ? 430 : 370;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.14);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.17);
    }

    playCoin() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        [987.77, 1318.51].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.065);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.setValueAtTime(0.22, now + idx * 0.065);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.22);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.065);
            osc.stop(now + idx * 0.065 + 0.24);
        });
    }

    playHit() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.38);

        gain.gain.setValueAtTime(0.55, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.42);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.44);

        this.playNoiseWhoosh(0.32, 0.4, 1600, 200);
    }

    playSuccessRating(rating) {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const notes = rating === 'PERFECT'
            ? [523.25, 659.25, 783.99, 1046.50]
            : [523.25, 659.25, 783.99];

        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.055);

            gain.gain.setValueAtTime(0.16, now + idx * 0.055);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.18);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.055);
            osc.stop(now + idx * 0.055 + 0.2);
        });
    }

    playCountdownBeep(isFinal = false) {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(isFinal ? 880 : 440, now);

        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + (isFinal ? 0.38 : 0.16));

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + (isFinal ? 0.4 : 0.18));
    }

    playFireRumble() {
        if (this.isMuted) return;
        this.init();
        this.playNoiseWhoosh(0.32, 0.45, 300, 700);
    }

    playBoulderRumble() {
        if (this.isMuted) return;
        this.init();
        this.playNoiseWhoosh(0.4, 0.6, 120, 280);
    }

    playChasmWind() {
        if (this.isMuted) return;
        this.init();
        this.playNoiseWhoosh(0.28, 0.5, 600, 200);
    }

    playLogClash() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        // Deep hollow hardwood trunk impact thud + sharp timber knock
        [[148, 46, 0.42, 0.28, 'triangle'], [310, 92, 0.26, 0.14, 'sine']].forEach(([f0, f1, vol, dur, type]) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f0, now);
            osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.005, now + dur);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + dur + 0.02);
        });

        this.playNoiseWhoosh(0.28, 0.18, 950, 180);
    }

    playMinecartRumble() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        // Metallic rail-wheel clack + eerie phantom horn undertone
        [0, 0.11, 0.24].forEach((delay) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(520, now + delay);
            osc.frequency.exponentialRampToValueAtTime(140, now + delay + 0.06);
            gain.gain.setValueAtTime(0.18, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.004, now + delay + 0.065);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + delay);
            osc.stop(now + delay + 0.075);
        });

        this.playNoiseWhoosh(0.34, 0.55, 220, 540);
    }

    playSawWhir() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.36);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.005, now + 0.38);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);

        this.playNoiseWhoosh(0.24, 0.4, 900, 1600);
    }

    // AUTHENTIC SUBWAY TRAIN HORN & MODERN TRAM BELL (Matches Subway Surfers train lines!)
    playTrainHorn() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;
        // Powerful two-tone brassy subway locomotive horn chord (D#4 + F#4 + A#4 / 311Hz, 370Hz, 466Hz)
        [311, 370, 466].forEach((freq) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1450, now);
            filter.frequency.exponentialRampToValueAtTime(750, now + 0.62);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
            gain.gain.setValueAtTime(0.18, now + 0.42);
            gain.gain.exponentialRampToValueAtTime(0.005, now + 0.68);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.70);
        });
        this.playNoiseWhoosh(0.30, 0.65, 260, 680);
    }

    playTramBell() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;
        // Classic electric tram double-ding bell ("ding-ding!" 1860Hz & 2180Hz)
        [0, 0.12].forEach((delay, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            const f = i === 0 ? 1860 : 2180;
            osc.frequency.setValueAtTime(f, now + delay);
            gain.gain.setValueAtTime(0.24, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.005, now + delay + 0.22);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + delay);
            osc.stop(now + delay + 0.24);
        });
    }

    // Authentic Inspector police/security trill whistle
    playPoliceWhistle() {
        if (this.isMuted) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2950, now);
        lfo.frequency.setValueAtTime(26, now);
        lfoGain.gain.setValueAtTime(180, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
        gain.gain.setValueAtTime(0.22, now + 0.26);
        gain.gain.exponentialRampToValueAtTime(0.005, now + 0.44);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        lfo.start(now);
        osc.start(now);
        lfo.stop(now + 0.45);
        osc.stop(now + 0.45);
    }

    // Zero-allocation shared noise buffer playback
    playNoiseWhoosh(vol, duration, startFilterFreq, endFilterFreq) {
        try {
            if (!this.noiseBuffer) this.createSharedNoiseBuffer();
            if (!this.noiseBuffer) return;

            const dur = Math.min(0.95, duration);
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            const now = this.ctx.currentTime;
            filter.frequency.setValueAtTime(startFilterFreq, now);
            filter.frequency.exponentialRampToValueAtTime(Math.max(50, endFilterFreq), now + dur);
            filter.Q.value = 2.8;

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);

            noise.start(now, 0, dur);
        } catch (e) {
            // Audio context safely ignored if busy
        }
    }

    // Non-blocking voice announcement (deferred off render frame so Windows SAPI never stalls WebGL)
    speakCue(text) {
        if (!this.voiceEnabled || !('speechSynthesis' in window)) return;
        setTimeout(() => {
            try {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                }
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 1.4;
                utterance.pitch = 1.1;
                utterance.volume = 0.85;
                window.speechSynthesis.speak(utterance);
            } catch (e) {}
        }, 0);
    }

    // --- PROCEDURAL TRIBAL BGM ---
    startBGM(initialTempo = 125) {
        if (this.isPlayingBGM || this.isMuted) return;
        this.init();
        this.isPlayingBGM = true;
        this.tempo = initialTempo;
        this.beatCount = 0;

        const scheduleBeat = () => {
            if (!this.isPlayingBGM) return;
            this.playTribalBeat(this.beatCount);
            this.beatCount = (this.beatCount + 1) % 16;
            const intervalMs = (60 / this.tempo / 4) * 1000;
            this.bgmTimer = setTimeout(scheduleBeat, intervalMs);
        };

        scheduleBeat();
    }

    setBGMTempo(bpm) {
        this.tempo = Math.min(165, Math.max(110, bpm));
    }

    stopBGM() {
        this.isPlayingBGM = false;
        if (this.bgmTimer) {
            clearTimeout(this.bgmTimer);
            this.bgmTimer = null;
        }
    }

    playTribalBeat(step) {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;

        if (step % 4 === 0) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(110, now);
            osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);
            gain.gain.setValueAtTime(0.42, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        }

        if (step === 2 || step === 7 || step === 10 || step === 14) {
            const tom = this.ctx.createOscillator();
            const tomGain = this.ctx.createGain();
            const freq = step === 2 ? 180 : step === 7 ? 220 : step === 10 ? 160 : 240;
            tom.frequency.setValueAtTime(freq, now);
            tom.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.1);
            tomGain.gain.setValueAtTime(0.22, now);
            tomGain.gain.exponentialRampToValueAtTime(0.01, now + 0.11);
            tom.connect(tomGain);
            tomGain.connect(this.ctx.destination);
            tom.start(now);
            tom.stop(now + 0.12);
        }

        if (step % 2 === 1) {
            this.playNoiseWhoosh(0.06, 0.035, 3500, 7000);
        }

        if (step === 0) {
            const drone = this.ctx.createOscillator();
            const droneGain = this.ctx.createGain();
            drone.type = 'sawtooth';
            drone.frequency.setValueAtTime(55, now);
            droneGain.gain.setValueAtTime(0.1, now);
            droneGain.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(240, now);
            drone.connect(filter);
            filter.connect(droneGain);
            droneGain.connect(this.ctx.destination);
            drone.start(now);
            drone.stop(now + 0.78);
        }
    }
}

window.soundEngine = new SoundEngine();
