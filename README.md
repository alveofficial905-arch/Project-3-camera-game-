# 🏃‍♂️ Temple Run IRL - Motion Camera Workout Game

> Inspired by the viral **"Temple Run IRL"** fitness reflex challenge by [@muras_fit on TikTok](https://vt.tiktok.com/ZSgcWdSVu/) and YouTube *Reflex Run*.

Turn your living room or workout space into an adrenaline-pumping 3D endless runner where your **real-world body movements control the game**! Stand in front of your webcam or hook your laptop up to a TV/projector, jump over fiery pits, squat under low stone lintels, and lean laterally to dodge crumbling temple ruins.

---

## 🎮 How to Play

| Obstacle | Required Real-Life Action | Keyboard Fallback |
| :--- | :--- | :--- |
| **🔥 Fire Traps / Fiery Trenches** | **JUMP!** (Feet off floor / body leap) | `W` / `Up Arrow` / `Space` |
| **🪵 Low Stone Lintels & Spiked Logs** | **DUCK / DEEP SQUAT!** (Squat down low) | `S` / `Down Arrow` |
| **🪨 Crumbling Boulders / Pillars (Right)** | **LEAN / STEP LEFT!** (Shift body left) | `A` / `Left Arrow` |
| **🪨 Crumbling Boulders / Pillars (Left)** | **LEAN / STEP RIGHT!** (Shift body right) | `D` / `Right Arrow` |
| **🪙 Golden Temple Idols & Coins** | **RUN & ALIGN** with coin trails | Automatic on collision |

---

## ✨ Features

- **Real-Time AI Body Tracking**: Powered by MediaPipe Pose (33 skeletal landmarks) with an automatic lightweight optical difference fallback. Tracks your head, shoulders, hips, and knees in real time at 60 FPS.
- **Picture-in-Picture (PIP) Skeleton View**: View your live webcam feed with neon skeletal joints, standing baseline guides, and posture state indicator (`STANDING`, `JUMPING`, `SQUATTING`, `LEAN LEFT`, `LEAN RIGHT`).
- **Interactive Reflex Cues**: Giant glowing on-screen prompts (`JUMP!`, `DUCK / SQUAT!`, `LEAN LEFT!`, `LEAN RIGHT!`) exactly like the TikTok video, accompanied by voice callouts and rhythmic timing cues.
- **Dual Camera Perspectives**:
  - **1st-Person Immersive View**: Puts you directly in the runner's shoes with dynamic step bobbing, head sway, and turn banking (perfect for big screens and projectors!).
  - **3rd-Person Explorer View**: Full 3D athletic runner avatar navigating the ancient temple.
- **Full-Body Workout Tracker**: Counts real squats, jumps, lateral dodges, active workout duration, and calculates estimated calories burned.
- **Procedural Tribal Sound Engine**: High-energy conga drums, tribal percussion, whooshes, chimes, and adaptive tempos synthesized entirely through the Web Audio API (no external MP3/WAV downloads required).
- **Zero Install Friction**: Pure HTML5, WebGL (Three.js), and vanilla JavaScript. Runs locally on any modern browser.

---

## 🚀 Quick Start

### 1-Click Launch (Windows)
Double-click `start_game.bat` in this folder:
1. It starts the local HTTP server (`server.ps1`).
2. Automatically launches Google Chrome (or your default browser) to `http://localhost:8080/`.

### Manual Launch
If you prefer starting via PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```
Then open your browser to `http://localhost:8080/`.

---

## 🎯 Tips for the Best Experience

1. **Camera Position**: Place your laptop or webcam at waist-to-chest height, roughly 6 to 9 feet (2 to 3 meters) away so your upper body and hips are in full view.
2. **Calibration**: Click the **🎯 Calibrate** button in the webcam PIP window, stand straight facing the camera during the 3-second countdown.
3. **Big Screen / Projector**: Hit the **⛶ Projector / Fullscreen** button in the top-right corner to cast or display on your TV/wall, replicating the viral workout setup!
