# TurboIMS Next 1.0.0

1.0.0 将用户实测“完全可用，包括功能和 WebUI”的 [Actions #249](https://github.com/Pew2018/TurboIMS/actions/runs/37331861530) 源码发布到 master。

## 源码与备份

- #249 源码提交：`299a7215726f6c3dc2b8523d2ca9dd77130c9b0e`。
- 原始代码树：`44a63ab7a288ebf0f0916079e71fb9b8ffe5ed83`。
- 已合并 PR：[#12](https://github.com/Pew2018/TurboIMS/pull/12)。
- 合并提交：`af8103edf39e53cc959deb69c4262f16fce8a160`，合并后的代码树与 #249 完全相同。
- 完全可用备份：[archive/release-0.3.6-fully-working](https://github.com/Pew2018/TurboIMS/tree/archive/release-0.3.6-fully-working)，仅增加用户验证及构建来源说明，保留原 0.3.6 编译代码。
- 原 0.3.5 备份保持不变。

## 1.0.0 与 #249 的差异

仅变更 `module/module.prop` 的 version（0.3.6 → 1.0.0）、versionCode（18 → 19）及发布说明文档。运行代码、WebUI、默认配置、脚本、构建流程、测试均不变。重新构建时 build-info.json 的版本和提交标识、ZIP 内 README 以及 ZIP 容器摘要会相应变化；这不是功能差异。

保留 0.3.6 的独立 IMS / SIM / NR 验证、真实 SIM 身份默认策略及有界开机配置逻辑。NR 请求与读回的真实差异仍按部分生效报告，不因升级版本而宣称完整 NR 请求已实现。

## 已有实测

用户确认 #249 的功能和 WebUI 完全可用。最近确认设备：Pixel 8 Pro（husky），Android 16 / SDK 36，KernelSU Next 3.3.0，中国联通；开机自动配置、拨出、接听和双方声音正常，修改后的国家码与运营商显示正常。

安装或升级 1.0.0 后重启即可沿用现有设置，不要求清除配置或重新配置测试身份。
