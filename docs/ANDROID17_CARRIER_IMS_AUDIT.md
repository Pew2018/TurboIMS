# Android 17 Carrier IMS 移植审计

审计日期：2026-10-03

## 版本基线

- TurboIMS：`Pew2018/TurboIMS` 的 `master` HEAD `fefb82fdd5fc1705e7446103a5296a7b9fc3d3d9`（2026-10-03）；由此创建功能分支 `feature/carrier-ims-android17`。
- Carrier IMS 参考：`Pew2018/carrier-ims-for-pixel` 的 `master` HEAD `e9035ac9fca56b7f34155e0318b7e4dc8f77f1d3`（2026-07-04）。
- TurboIMS 上游：`Turbo1123/TurboIMS` 的默认分支为 `master`。本次比较的直接参考实现为上面的 Carrier IMS fork。

## 现有 TurboIMS KSU 路径

模块通过 `control.sh` 以 uid 0 启动独立 `app_process64` runner；没有 Shizuku/Sui/Zygisk 依赖。配置在 `/data/adb/turboims-next/config.json`，状态在同目录下。当前 `Engine` 已按 subId/slot 枚举 SIM，保存 baseline、owned 与 pending 值；CarrierConfig 写入前先保存恢复记录，使用非持久化 `overrideConfig(..., false)`，随后读回验证。检测到用户/系统改动冲突时保留冲突项，不主动覆盖。

Android 版本门禁目前为 SDK 33..36，GitHub Actions 安装 Android 36 SDK。因而 Android 17（SDK 37）当前会在启动时明确退出；不能把现有构建结果称为 Android 17 支持。

## Carrier IMS 参考调用链

- `BrokerInstrumentation` 通过 Shizuku 包装 ActivityManager Binder，调用 `startDelegateShellPermissionIdentity(uid, null)`，再调用 `CarrierConfigManager.overrideConfig`。默认走非持久化；用户请求持久化时先尝试 persistent，失败才回落到 non-persistent。参考端没有逐 key CarrierConfig 读回作为写入成功的必要条件，因此 TurboIMS 的读回校验应继续保留。
- `ImsModifier` 可设置 CarrierConfig、SIM ISO、MCC override 和 MNC hint，并调用 `ITelephony.setCarrierTestOverride(subId, mccmnc, ...)`；reset 路径调用 `clearCarrierTestOverride(subId)`，旧接口缺失时尝试用 SIM 当前 MCC/MNC 回填。该 fallback 不能照搬为无条件清理：必须先确认状态归属于本模块，且当前真实 MCC/MNC 可读。
- `ImsResetter` 把 subscription 映射到 slot 后调用 `ITelephony.resetIms(slot)`。此处 API 参数是 slot，而 IMS 状态读取 `isImsRegistered(subId)` 使用 subId；不得混用。
- `ImsStatusReader` 用 `isImsRegistered(subId)` 查询注册状态。
- `ApnModifier` 会通过 Telephony Provider 插入/更新 APN 并设置 preferred APN；这会改写用户数据，不适合作为自动迁移步骤。当前应保持只读诊断。

以上 Binder 调用都发生在委托 shell 权限身份期间。KSU runner 的 uid 0 和 SELinux 域 `u:r:ksu:s0` 不等同于 shell identity；root 进程可读取/调用某些 Binder 接口，并不能证明每项权限检查均与 shell 相同。必须在目标 Android 17 Pixel 上分别探测权限、写入、读回与清理，否则功能应报告明确失败。


## 当前设备只读诊断（用户提供，2026-10-03）

- Pixel 8 Pro（husky），Android 16 / SDK 36，build `CP1A.260505.005.A1`，SELinux enforcing，Termux root 与 runner 均处于 `u:r:ksu:s0`。
- runner 成功枚举 `subId=1 → slot=0`；`ICarrierConfigLoader.overrideConfig(..., persistent=false)` 可写入并读回验证，配置无 unsupported/conflicts。
- 本次实际配置启用了 VoLTE、VoWiFi、VT、VoNR、cross-SIM、UT、5G NR；SIM profile 为 slot 0 / ISO `tw` / 名称 `Chunghwa Telecom`。现有 module runner 仍为 0.2.0。
- SIM property 的 `gsm.sim.operator.numeric` 为 `46009,`，当前网络 `gsm.operator.numeric` 为 `46001`；网络服务状态显示 LTE voice 注册可用。IMS APN 显示 CONNECTED。
- 这些信息确认 TurboIMS 已成功应用 CarrierConfig，且网络/IMS APN 通路有活动状态；它们本身不等同于 `ITelephony.isImsRegistered(1)` 的直接返回，也不证明拨出、接听或双向音频成功。
- `content://telephony/siminfo` 查询返回无结果，表明本次命令未取得该 Provider 的 SIM 映射；runner 的 Binder 枚举给出的 subId/slot 映射仍可用。
- 用户明确将 Android 16 设备作为当前移植目标；Android 17 可留作后续 SDK/API 验证，不应阻挡先在 SDK 36 上适配参考实现。

## 0.2.4 编译产物审计与本次修复

审计对象是分支 `feature/carrier-ims-android17-voice-fix` 上的 0.2.4，提交 `8767069ae4dbc1a2520669149f45da15c3a623b2`，GitHub Actions run `37118523819`。Actions 成功，构建产物的 `build-info.json` 标记 `shizuku=false`、`sui=false`、`device_validated=false`。这证明 ZIP/runner 构建成功，不证明 Android 17 设备兼容或电话可用。

### 发现并修复

0.2.4 的 Carrier IMS 执行路径在 CarrierConfig 写入前要求每张目标 SIM profile 明确提供 `carrier_test_mccmnc`。已有旧配置只有台湾 ISO 和中华电信名称，因而会在 CarrierConfig 写入之前失败。用户之前选择“中华电信”是通过 SIM 信息预设完成的，名称本身没有自动生成参考实现所需的 PLMN。

本分支在 `FeatureConfig.SimProfile` 中只对精确组合 `tw + Chunghwa Telecom` 推导 `46692`。显式输入值优先；其他国家/运营商仍要求用户填写，避免把错误 MCC/MNC 写进另一张 SIM。新增测试覆盖旧配置推导、显式值优先和不匹配时不猜测，设置页说明也同步更新。推导值进入已规范化的 SIM profile，因此 0.2.4 的 Carrier IMS runner 可直接使用，不需重写既有 SIM profile。

### 当前实现的已知限制

- CarrierConfig 仍通过现有 KSU runner 的 `ICarrierConfigLoader.overrideConfig(..., false)` 写入，并经现有 Engine 逐项读回验证；Carrier IMS 没有替换原 TurboIMS KSU Engine。
- Carrier test override 通过 `ITelephony.setCarrierTestOverride(subId, mccmnc, ...)` 设置，所有权记录按 subId 和 slot 保存；清理只调用 `clearCarrierTestOverride`，且仅清理带本模块所有权记录的值。Android 没有可靠读回接口，状态只能说明 Binder 调用被接受，不能声称测试运营商值已被系统读回验证。
- IMS 注册查询使用 subId；`resetIms` 使用映射出的 slot，最多轮询 20 次、每次间隔 1 秒。它能报告注册状态，不等同于拨出/接听或双向音频验证。
- 0.2.4 执行配置模式切换时，Carrier test override 与 CarrierConfig Engine 不是一个可原子提交的系统事务。若中途失败，状态会显示失败，但回滚旧模式和全部系统状态仍未做到严格原子化；不要将失败路径描述为已完成自动回滚。
- Actions 当前安装 Android SDK 36 来构建 runner；源码允许 SDK 33..37 运行并使用反射探测隐藏接口。这不是 SDK 37 编译或 Android 17 runtime 验证。Android 17 API/权限兼容性仍须在 Android 17 Pixel 上核验。
- APN 自动修改未移植；保持只读诊断。

## 验收状态

- 0.2.4 artifact 检查：ZIP 包含平铺可刷入模块文件、`runner.apk`、校验文件和 `build-info.json`；其源码提交 SHA 与 run 151 一致。
- 0.2.4 Actions 构建：通过。
- 本次中华电信旧 profile 自动推导：代码与单元测试已加入，等待修复分支 Actions。
- TurboIMS 默认模式与原有 Engine：沿用 0.2.4；本次只改 profile 规范化、测试、界面说明、模块版本号。
- Android 17 Pixel、单/多 SIM、IMS 注册、真实拨出/接听和双向音频：未验证；用户当前设备为 Android 16，不能据此宣称通话问题已修复。
- APN：未修改。

