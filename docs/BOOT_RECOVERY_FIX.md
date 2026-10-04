# Boot recovery hotfix / 开机恢复紧急修复

## Cause / 原因

The runner previously treated any native value equal to a saved owned value as evidence that a nonpersistent override survived. After reboot, native VoLTE/Wi-Fi calling flags and NR arrays can match by coincidence while the country code and carrier name revert. This produced `ownership_lost` and a blocking status instead of applying the saved request.

旧逻辑把“原生配置中任意一项等于上次写入值”当成覆盖仍然存在的证据。重启后 VoLTE、VoWiFi 布尔值和 NR 数组可能碰巧相同，但国家码、运营商名称已经恢复，导致误报 `ownership_lost` 并停止自动任务。

## Behavior / 行为

- Boot and explicit Apply can reacquire the loaded baseline when the marker is absent and the old transaction was verified. Restore, periodic reconciliation, foreign markers and interrupted writes retain conservative ownership checks.
- Carrier test identity runs after a read-only preflight and before the final CarrierConfig write. Identity notifications get a bounded settling interval.
- Fresh read-back after IMS reset checks the requested IMS and SIM keys. A markerless reload or known unavailable framework service is retried within the existing 12-attempt bound; a mismatch with a marker is an error.
- Settings, baseline recovery files and user profiles are retained. No persistent override, null whole-bundle clear or system partition write is introduced.

- 开机与手动应用在覆盖标记消失且上次写入已验证时，可重新读取已就绪的配置作为基线；恢复操作、周期检查、其他所有权标记和未完成写入仍保留保守检查。
- 先进行只读检查，再处理运营商测试身份，最后写入 CarrierConfig；身份通知有有限的等待时间。
- IMS 重置后重新读取并核对 IMS 与 SIM 目标字段。无标记的重载或明确的框架服务未就绪会进入原有最多 12 次重试；仍有标记的值不一致按错误处理。
- 保留设置、恢复快照和 SIM 配置，不使用持久覆盖、不清空整张覆盖配置、不修改系统分区。

## Device validation / 真机验证

1. Install the branch's 0.3.1 ZIP over the existing module; keep the saved configuration.
2. Keep boot automation enabled and periodic checks disabled. Reboot without tapping Apply.
3. Allow the bounded task to finish. Export diagnostics: expect `status.ok=true`, `phase=active`, verified read-back, no current blocked status, country `TW`, and carrier `Chunghwa Telecom` for the saved slot-0 profile.
4. Reboot again and repeat. Confirm IMS registration and an actual voice call separately.
5. If recovery stops, export the current snapshot/status/log before clearing anything. Foreign-marker or pending-write conflicts deliberately need inspection.

1. 直接覆盖安装该分支的 0.3.1 模块 ZIP，保留现有设置。
2. 开启开机自动应用、关闭周期检查，重启后不要点击应用。
3. 等待有限任务结束，导出诊断：预期 `status.ok=true`、`phase=active`、回读验证成功、没有当前 blocked 状态；SIM 0 的国家为 `TW`、名称为 `Chunghwa Telecom`。
4. 再重启一次重复验证；另外确认 IMS 注册和实际通话。
5. 如果仍停止，先导出当前 snapshot、status 与日志再处理。其他标记和未完成写入冲突仍需检查。

CI proves compilation, host regression tests, archive layout and installer smoke checks. Boot timing, modem registration and visible SIM properties still require testing on the target Pixel.

CI 验证编译、离线回归测试、ZIP 结构和安装流程；开机时序、基带注册、可见 SIM 信息仍需在目标 Pixel 上验证。
