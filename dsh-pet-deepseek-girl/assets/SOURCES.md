# 素材来源与许可说明（SOURCES）

本插件 v0.3 的形象与状态机架构全盘采用/改编自 dsh-dafeiyu（大肥鱼桌宠），
按用户指示打包。文件除重命名与清单适配外未做修改。

## 形象素材（assets/pet/ 帧动画）

- **来源**：[QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)
  （npm `dsh-dafeiyu@0.1.0-alpha.15`）的 `assets/pet/` 运行时帧，共 50 张
  238px PNG，覆盖 19 组动画：待机/眨眼/环视/思考/工作/搜索/执行/等待/
  成功/出错/头晕/拖拽/摸头/戳戳/摇尾/行走等。
- **上游说明**（其 `ASSET_LICENSE.md` 原文要点）：这些帧来自
  `QCYTSN/ds-local-pet` v0.2.0 运行时输出，由粉丝向 DeepSeek 相关角色视图
  与 AI 辅助动画帧混合衍生；**视觉文件不随 MIT 代码许可**，未授予额外许可。
- **部署注意**：公开发布/分发本插件前请自行确认上游授权，或替换为已获授权
  素材（替换方法见根目录 README「形象与自定义」）。
- 早期版本的 GIF 素材（codex-pet-DeepSeek-girl，蓝发鲸尾女仆）仍保留在
  `assets/` 顶层，可通过 `images` 配置按姿态覆盖使用。

## 代码借鉴

- `lib/reducer.js` 状态机与 `lib/copy.js` 文案轮换结构改编自
  [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（其源代码 MIT
  许可）的 `CompanionReducer` / `status-copy.js`；输出形态（JSON 快照 +
  瞬态脉冲）、气泡文案（DeepSeek 娘 persona）为本插件原创。
- 设置卡（GET/PATCH 配置端点、滑块防抖、顺序保护、静默降级）模式同样参考
  dsh-dafeiyu 的 `lib/client.js` 与 `src/index.js`。
