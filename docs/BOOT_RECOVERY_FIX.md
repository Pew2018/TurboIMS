# Boot recovery audit / 开机恢复审计

## Compared revisions / 对比版本

| Branch | Commit | Boot ownership policy | Carrier IMS |
| --- | --- | --- | --- |
| archive/release-0.2.0 | 487b4129176597a84a675cd36b42b0839bf2d425 | Old snapshot conflicts checked only within the current boot | Absent |
| master | 85ea24697e04a575df1668e161588229436f3676 | Old snapshot conflicts also checked across boots; coincident native values prevent rebasing | Reset/test identity added |
| fix/boot-ownership-recovery, first patch | 4b0ec0f906a653323836d1bb68154bc9d3acc04a | Explicit boot/apply can rebase a fully verified markerless snapshot | Identity before final write; final config read-back |

The service.sh boot-completed wait, one-shot watcher lifecycle and default configuration are identical in all three versions. The regression is in runtime policy, not a changed KernelSU boot hook. The user's successful 0.2.0 device test corroborates the cross-boot ownership difference, but does not prove the later Carrier IMS path works on the device.

三个版本的 service.sh 开机完成等待、一次性任务结构和默认配置相同。回归差异在运行时策略，不是 KernelSU 开机脚本变更。用户实测 0.2.0 正常，支持跨开机所有权判断存在回归这一结论；这并不能证明后加入的 Carrier IMS 路径在真机上正常。

## Findings fixed in 0.3.2 / 本轮修复

1. **Cross-boot false ownership loss.** Keep the first patch's markerless reapplication for verified saved requests. A native boolean/array can coincide with an old written value; equality alone is not retained ownership.
2. **Repeated IMS resets.** The master/first-patch retry loop reset IMS on every attempt. A task now remembers accepted resets per subscription and subsequently waits for registration. Temporary service failures before an accepted reset do not consume that budget.
3. **Stale registration sample.** Allow the queued reset to start before polling; require two consecutive registered observations.
4. **Service readiness misclassified.** Retain the IMS constructor's actual exception. Known Binder/service-unavailable errors are retryable; security/signature/verification errors remain terminal.
5. **Unchanged CarrierConfig, stale public SIM fields.** After identity changes or a public-property mismatch, republish only the requested country/name fields through the existing nonpersistent CarrierConfig API, even if their config values already match. Ownership/conflict checks and read-back still apply.
6. **Stale test identity record.** Reuse a saved same-boot request only when the public operator numeric also matches. A record by itself is not proof that telephony still exposes that identity.
7. **Interrupted cross-boot mutation.** Pending snapshots retain both the verified owner token and the attempted token. Binder failures before and after mutation can recover without losing the original baseline. Legacy snapshots load without migration/deletion.
8. **Final ownership/read-back.** Detect lost/replaced owner markers even if requested values still coincide. Native-identity fallback is idempotent within a boot when both its record and observed numeric match.
9. **Multi-SIM failure precedence.** A retryable result cannot hide a terminal error from another SIM. Restore also checks CarrierConfig readiness/conflicts before changing identity or resetting IMS.

1. **重启后误判所有权丢失：** 保留首轮的无标记重应用；布尔值或数组碰巧相同不再阻止开机重建基线。
2. **反复重置 IMS：** 每个有限任务对每张卡只执行一次已被接受的重置；后续等待注册。重置被接受前的暂时服务故障不会消耗次数。
3. **旧注册状态误判成功：** 等待排队的重置开始，并要求连续两次注册状态为真。
4. **服务未就绪被判为终止错误：** 保留实际异常；明确的 Binder 服务暂未就绪可重试，权限、签名和验证错误仍停止。
5. **配置相同但可见 SIM 信息未刷新：** 测试身份变更或系统属性不一致时，即使配置字段相同，也通过原有非持久 CarrierConfig API 重新发布目标国家/名称字段，仍执行所有权保护和回读。
6. **仅依赖旧测试身份记录：** 同一次开机的记录还需匹配实际公开的运营商数字码，才能跳过应用。
7. **跨开机写入中断：** pending 快照保存已验证与尝试中的两个所有权标记；覆盖写入前后失败仍能恢复原始基线，兼容旧快照。
8. **最终所有权回读：** 目标值碰巧相同时也检查标记是否丢失/被替换。同次开机的原生身份兼容恢复记录与实际数字码匹配时，不反复重新设置。
9. **多 SIM 错误优先级：** 一张卡暂未就绪不能掩盖另一张卡的终止错误；恢复时也需先检查 CarrierConfig 状态和冲突。

Settings/UI, feature key definitions and saved profiles are retained. No persistent=true override, null whole-bundle clear, SELinux change or system-partition write is introduced. The 12-attempt bound and successful one-shot exit remain; no periodic mode is enabled automatically.

保留设置、UI、功能键定义和 SIM 配置。不使用 persistent=true、不清空整张覆盖配置、不改 SELinux、不写系统分区。保持最多 12 次尝试及成功后退出的行为，不自动开启周期检查。

## Validation / 验证

Host tests exercise engine ownership and pending-write recovery, IMS reset budgets/readiness/stable polling, SIM refresh/read-back and the actual Engine + BatchRunner + AutoApply + IMS Task flow over two simulated boots in both implementation modes. CI also builds SDK 36/37 artifacts and verifies the downloaded flashable archives and installation smoke.

离线测试覆盖所有权、pending 恢复、IMS 重置次数、服务就绪、稳定注册轮询、SIM 刷新与回读，并串联真实 Engine + BatchRunner + AutoApply + IMS Task，在两种实现模式下模拟连续开机。CI 另验证 SDK 36/37 编译、下载后的可刷入 ZIP 结构及安装流程。

These tests do not emulate the Android phone service, modem or carrier network. Device boot timing and actual calling remain unverified until tested on the target Pixel.

测试不模拟 Android phone 服务、基带和运营商网络。目标 Pixel 的开机时序及真实通话仍需真机验证。

## Device checks / 真机检查

1. Install the branch's 0.3.2 SDK 36 artifact over the existing module, preserving configuration.
2. Leave boot automation enabled and periodic checks disabled. Reboot without tapping Apply.
3. After the bounded task completes, export diagnostics. Expected: current `status.ok=true`, `phase=active`, verified CarrierConfig and `sim_profiles_verified=true`, no current blocked status, SIM country `TW`, carrier `Chunghwa Telecom`.
4. Reboot again. Test both TurboIMS and Carrier IMS modes separately; Carrier IMS additionally needs stable IMS registration. Confirm an actual voice call.
5. If stopped, retain/export status, snapshots and logs. A `retry_timeout` preserves its specific `retry_reason`; foreign markers and unresolved pending writes intentionally require inspection.

1. 覆盖安装该分支 0.3.2 的 SDK 36 产物，保留配置。
2. 开启开机自动应用、关闭周期检查，重启后不要点击应用。
3. 任务结束后导出诊断：预期当前 `status.ok=true`、`phase=active`、CarrierConfig 回读验证成功、`sim_profiles_verified=true`、无当前 blocked，国家 `TW`、名称 `Chunghwa Telecom`。
4. 再重启一次；分别验证 TurboIMS 与 Carrier IMS 模式，后者还需稳定注册。确认一次实际通话。
5. 失败时保留并导出状态、快照、日志。`retry_timeout` 会记录具体 `retry_reason`；其他标记和未解决 pending 写入仍需检查。
