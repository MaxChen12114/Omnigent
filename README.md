# Omnigent

无界 AI 多分支创作平台 —— 角色扮演 · 写作 · 编程 · 节点流 · 图像 · 语音

Omnigent（omni + agent）是一个面向多场景创作的 AI 平台：在同一套界面里完成角色扮演对话、长文写作、代码协作、可视化节点流程，以及图像与语音生成。

## 功能特性

- 多分支角色扮演与对话创作
- 长文写作与续写
- 代码协作与节点流程编排
- 图像生成 / 语音合成（接入中）
- 可切换多种模型
- 数据默认存在本地浏览器，留在你自己手里

## 桌面版（Windows）

桌面版基于 Tauri 2 打包为原生窗口（远程加载线上站点），支持系统托盘、关闭收进托盘、单实例，以及启动自动检查更新。

- 下载最新版：[Releases 最新版](https://github.com/MaxChen12114/Omnigent/releases/latest)
- 安装包格式：NSIS `.exe`，双击安装即可

## 部署 / 开发

### Web 端（Cloudflare Workers）

1. 安装并登录 Wrangler：

   ```bash
   npm i -g wrangler
   wrangler login
   ```

2. 配置运行所需的密钥（如模型 API Key 等）：

   ```bash
   wrangler secret put <SECRET_NAME>
   ```

3. 部署到 Cloudflare Workers：

   ```bash
   wrangler deploy
   ```

### 桌面端（Tauri 2）

打包工程位于 `src-tauri/`，通过 GitHub Actions 在云端 Windows 构建，本机无需安装环境。

1. 在仓库 Actions 页选择构建工作流并点击 Run workflow；或推送一个 `app-v*` 版本标签触发：

   ```bash
   git tag app-v1.0.0
   git push origin app-v1.0.0
   ```

2. 构建完成后自动发布到 Releases，产物为 Windows NSIS `.exe` 安装包。

如需本地构建：安装 Rust 与 Tauri CLI 后，在 `src-tauri/` 下运行 `cargo tauri build`。

## 技术栈

- 前端：原生 HTML / CSS / JavaScript
- 后端：Cloudflare Workers
- 桌面壳：Tauri 2（Rust）

## 致谢与原项目

本项目在 李中然 (MallocPointer) 的开源项目基础上二次开发与重构。原作者保留相应版权，使用与分发请遵循 [LICENSE](./LICENSE) 中的条款（禁止商业用途；非盈利公益使用需在明显位置标注原项目地址等）。

- 原项目地址：https://github.com/MallocPointer/unlimited-ai
- 原作者联系方式：lizhongran910@gmail.com

## 许可协议

本项目沿用原作者协议，详见 [LICENSE](./LICENSE)。禁止商业用途；非盈利公益使用需在显眼位置标注原项目地址（https://github.com/MallocPointer/unlimited-ai）；如需商用或再授权，请先邮件联系原作者获取授权。
