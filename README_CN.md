# TurboIMS Next

[English](README.md)

TurboIMS Next 是面向受支持 arm64 Google Pixel 设备的独立 **KernelSU Next 模块**。它通过本地 WebUI 与 root runner 应用选定的 IMS 相关 CarrierConfig 配置；不安装伴随 Android 应用，也不依赖 Shizuku、Sui、Zygisk、LSPosed 或外部服务。

> **兼容性说明：** 当前 `master` 的安装脚本仅接受 Android 13–16（API 33–36）的 arm64 设备。CI 虽然也编译 SDK 37 runner，但当前安装脚本会拒绝 Android 17。请勿将 SDK 37 构建产物视为可安装的 Android 17 支持。实际语音通话仍取决于设备、运营商、SIM 卡和网络。

## 功能

- 保留 **TurboIMS** 作为默认实现模式。
- 提供可选的 **Carrier IMS** 模式，供需要 Carrier IMS 兼容路径的设备和系统版本使用。
- 应用受支持的 IMS 功能开关：VoLTE、VoWiFi、视频通话、VoNR、跨 SIM IMS、UT 与 5G NR 可用性。
- 支持全部活跃订阅或单张 SIM 卡；执行前会映射 subscription ID 与 slot。
- 以非持久化 CarrierConfig 覆盖方式应用配置，并在平台 API 支持时读回目标值。
- Carrier IMS 模式可按 SIM 设置 carrier test MCC/MNC；留空时使用实际 SIM 身份。
- 可读取 IMS 注册状态、请求 IMS reset，并报告有上限的轮询结果。
- 记录本模块拥有的状态，使模式切换和恢复只针对 TurboIMS Next 自己记录的覆盖。
- 提供开机应用、可选定时检查、状态导出、日志、诊断及单项 IMS 恢复。

## 不会执行的操作

- 不会自动修改 APN。
- 不会修改 system 分区、SELinux 策略、root 隐藏设置或系统属性。
- 不会向网络服务发送数据。
- 不保证运营商注册、紧急呼叫、拨出电话、接听来电或双向音频。CarrierConfig 读回成功或 IMS 显示已注册，都不能单独证明通话可用。

## 要求

| 要求 | 当前状态 |
| --- | --- |
| KernelSU Next | 必需 |
| 设备 ABI | arm64 |
| Android | 当前安装脚本接受 Android 13–16（API 33–36） |
| 设备 | 目标为 Google Pixel；仍需按设备和运营商实测 |
| Root 伴随应用 | 不使用 |
| Shizuku / Sui / Zygisk / LSPosed | 不使用 |

运营商、SIM 预配置、区域、基带状态和 Android 版本仍会决定 IMS 通话是否可用。

## 安装

1. 在本仓库的 **Actions** 中下载成功的 `FLASHABLE-TurboIMS-Next-...` 构建产物。
2. 在 KernelSU Next 中直接安装下载的 ZIP。
3. 重启设备。
4. 打开模块 WebUI，查看已识别的 SIM 和状态，然后启用并应用所需配置。

首次安装时配置处于暂停状态。请先确认目标 SIM 和配置，再执行应用。

## 使用

### IMS 模式

- **TurboIMS**：默认模式，沿用已建立的 KernelSU 配置路径。
- **Carrier IMS**：可选兼容路径，可设置 carrier test MCC/MNC、请求 IMS reset，并检查 IMS 注册状态。

同一个订阅在同一时间只能由一种模式拥有。模块会先尝试清理自己记录的旧覆盖，再应用新模式。清理、应用或读回任一步失败时，界面会报告失败阶段，不会将其显示为成功。

### SIM 配置

可为每个 slot 选填：

- 国家或地区代码
- 运营商显示名称
- Carrier test MCC/MNC

Carrier test MCC/MNC 留空时使用实际 SIM 身份。仅在确认该值适用于选定运营商并能自行验证结果时填写。Binder 调用被接受，不代表平台可以可靠读回实际生效的运营商身份。

### 恢复与诊断

请使用状态和诊断区分：

- 配置写入与读回验证
- Carrier test override 请求结果
- IMS 注册结果
- 实际通话结果

恢复操作仅针对本模块已记录的状态。无法确认归属的运营商或系统覆盖不会被清除。

## 安全与 root 边界

KernelSU Next 为模块提供 root 权限，因此模块将作用范围限制在必要操作内：

- root runner 仅接受固定动作集合，并验证配置载荷。
- 模块配置、状态和日志保存在 `/data/adb/turboims-next`，并使用仅 root 可读写的权限。
- CarrierConfig 使用非持久化覆盖，不请求仅系统应用可用的持久化覆盖。
- runner 是 `app_process` 容器，不是已安装应用，也没有导出的 Android 组件。
- WebUI 使用本地资源，不发起网络请求。

这不会让已 root 的设备变得不可检测。TurboIMS Next 不管理 root 隐藏，并保留 KernelSU 模块在 `/data/adb` 下的正常痕迹。已经具备 root 权限的应用或进程仍可检查该目录。

## 已知限制

- 当前 `master` 的安装脚本会阻止 Android 17 安装，因此 Android 17 尚不是可用发布路径。
- 并非每个 Android 版本都提供可靠的 carrier test override 读回接口。
- IMS reset 或网络切换后，运营商注册可能继续变化；有上限的轮询可能早于运营商完成注册。
- 卸载时的恢复为尽力而为；重启会清除模块的非持久化 CarrierConfig 覆盖，但若恢复失败，请检查诊断信息。
- 必须在实际 Pixel、Android 版本、SIM、运营商和网络上验证通话表现。

## 开发与构建

仓库通过 GitHub Actions 打包模块。构建会生成可刷入 KernelSU Next 的产物、校验 runner 哈希并执行打包检查。构建成功不代表实际设备已通过语音通话验证。

## 相关项目

- [TurboIMS 上游](https://github.com/Turbo1123/TurboIMS)
- [Carrier IMS for Pixel 参考实现](https://github.com/Pew2018/carrier-ims-for-pixel)

## 问题反馈

反馈问题时请提供 Android 版本、设备代号、所选模式、目标 SIM/slot、是否设置过 SIM 配置或 carrier test MCC/MNC，以及导出的诊断信息。请不要公开电话号码、IMSI、ICCID 或其他用户标识。
