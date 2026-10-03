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

## 当前实施决策与阻塞

本分支目前仅记录审计，没有声称 Carrier IMS 模式已实现。当前源码缺少以下实现前提：

1. 可验证的 Android 17 SDK 37 编译与设备/API 兼容基线。
2. KSU 域下对 `setCarrierTestOverride`、`clearCarrierTestOverride`、`isImsRegistered`、`resetIms` 的权限/签名确认，以及跨 Android 17 接口变化的兼容探测。
3. MCC/MNC override 的模块所有权账本（按 subId 与 boot/session 持久记录原状态、写入值、验证结果），以及与现有 CarrierConfig Engine 的事务化切换和回滚。
4. 状态 JSON/WebUI 对“模式已选择、配置已验证、IMS 已注册、通话可用”分别呈现；当前配置结构没有 execution mode 字段。
5. 无 Android 17 实机/SIM 的情况下无法验证真实拨出、接听和双向音频。

在上述验证完成前，不应把模式切换写成成功路径，也不应以 CarrierConfig 的存在推断 IMS 注册或电话可用。后续实现应先增加默认 `turboims_ksu` 的向后兼容模式字段与单元测试；再增加独立 Carrier IMS adapter，复用当前配置 UI与 Engine 的安全归属原则；最后增加按 SIM 串行切换事务、MCC/MNC 所有权账本、IMS 状态/reset bounded polling、只读 APN 诊断和 SDK 37 Actions 构建。若调用权限验证失败，UI 应显示失败阶段与系统错误，并保持/恢复旧模式。

## 验收状态

- 分支从当前稳定 HEAD 创建：完成。
- TurboIMS 默认稳定模式、现有执行路径、配置迁移：未修改；本分支暂未加入模式字段或后端代码。
- Carrier IMS 代码路径审计：完成（上述参考 HEAD）。
- Android 17 SDK 37 构建、CarrierConfig/覆盖状态事务、IMS 状态/reset、SIM 多卡、UI：未实现/未验证。
- 实机通话与双向音频：未测试。
- APN：本次只读源码审计，未执行修改。

Actions 记录：审计提交期间连续推送触发工作流并取消较早运行；最终提交应单独检查状态后报告，不以已排队运行视为通过。
