# src-tauri · Tauri 2 桌面/移动打包工程

把 Omnigent 这套 web UI 用 Tauri 2 打包成可安装的桌面/移动应用。只是壳 + 本地前端加载,后端、模型、Cloudflare 一律不动。

## 形态约定
- 窗口加载本地打包的前端 frontend/（见 tauri.conf.json → build.frontendDist）。首次启动在启动页填入你自部署的 *.workers.dev 地址即可使用。
- build.frontendDist 指向本地前端目录 frontend/。
- 桌面端语音(TTS)走原生命令直连本机 GPT-SoVITS,其余按普通网页运行,前端零侵入。

## 两种出包方式

### A. 云构建（推荐，零本地配置）
仓库已带 .github/workflows/tauri-build.yml：去 GitHub → Actions → "Build Tauri App" → Run workflow，跑完在 Artifacts 下载 windows-installer（.msi/.exe）。无需本地装 Rust。

### B. 本地构建
1. 安装 Rust：https://rustup.rs
2. 安装 Tauri CLI（cargo 版，无需 node）：cargo install tauri-cli --version "^2.0"
3. 生成图标（只需一次）：cargo tauri icon ../public/assets/icon-512.png
4. 出包：cargo tauri build
   - Windows → target/release/bundle/ 下 .msi / .exe(NSIS)
   - macOS → .dmg / .app；Linux → .AppImage / .deb
   - 移动：cargo tauri android build / cargo tauri ios build

## 红线
- 不碰后端：PROMPT_1/2/3 不改、锁态 nsfwLevel=0 不破、主站不引入紫色。
- 只做壳 + 安装包，不做本地模型/后端/文件系统。
- Notion 是权威源：改这里任何文件，先改 Notion 镜像页，再同步仓库。
