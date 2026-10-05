# 0.3.5 SIM 身份与开机 IMS 修复验收

## 已确认的触发条件

Pixel 8 Pro / husky、Android 16 SDK 36、KernelSU Next 3.3.0，中国联通实体 SIM。
旧版 Carrier IMS + 台湾 / Chunghwa Telecom 显示配置会推导测试 PLMN 46692，
setCarrierTestOverride 又把 IMSI、ICCID、GIDs、PNN/SPN 传成空字符串。
设备 TelephonyDebugService 输出 fake_imsi=EMPTY，与这条代码路径一致。
VoLTE 平台支持、provisioning、用户增强 LTE 开关均为 true，但 Voice capability=false、IMS 未注册，实际拨号不能使对方响铃。
这证明配置读回成功之外存在真实通话故障；空身份是已确认缺陷，其他网络/厂商原因仍可能存在。

AOSP 的可选 fake 身份只在非 null 时替代真实缓存值，空字符串会生效：
- [IccRecords](https://android.googlesource.com/platform/frameworks/opt/telephony/+/master/src/java/com/android/internal/telephony/uicc/IccRecords.java)
- [CarrierTestOverride](https://android.googlesource.com/platform/frameworks/opt/telephony/+/master/src/java/com/android/internal/telephony/uicc/CarrierTestOverride.java)

## 修复行为

- 普通 SIM 国家码/名称设置与测试 PLMN 分离，两种模式默认使用真实 SIM 身份。
- 旧配置保留国家码、名称、开机设置和测试值，但默认关闭测试身份。可选测试功能需要新的显式开关。
- 可选测试调用只覆盖指定 PLMN，其余八个参数为 null；记录策略升级，旧同次启动记录不能直接复用。
- 未提供真实清除 API 时，仅从新覆盖的首次写入前一致的公开 PLMN 记录恢复；不读取 IMSI/ICCID。
  旧覆盖没有基线时要求重启。上一启动的记录直接过期，不恢复旧 PLMN。
- 两种模式都观察 IMS 注册。TurboIMS 不 reset，保留 0.2.0 的七项 CarrierConfig 映射；
  Carrier IMS 验证后限次 reset。启动注册观察有上限，配置匹配时不重复写入或 reset。
- 配置保存锁与任务操作锁分离、配置版本变化取消旧任务、异步 KernelSU spawn WebUI 桥保留。
- configuration_applied、write_readback_verified、ims_registration_verified 分别表示配置/写入/注册证据。
  probe 的 configuration_applied=false 只表示它没有执行写入，不表示配置丢失。

## 手机上验收

首次升级安装后重启，保留已保存的 tw / Chunghwa Telecom 和 IMS 功能，确认测试身份开关关闭。
每个组合保持其他条件不变，开启“开机自动应用”，保存后重启，等待 SIM/IMS 就绪，先不要手动应用：

| 执行方式 | 国家码和名称覆盖 | 验收 |
| --- | --- | --- |
| TurboIMS | 关闭 | 无手动操作，能拨出/接听并双向通话 |
| TurboIMS | tw / Chunghwa Telecom | 自动显示正确，能拨出/接听，检查地图评论区 |
| Carrier IMS | 关闭 | 自动配置和 IMS 注册，能拨出/接听并双向通话 |
| Carrier IMS | tw / Chunghwa Telecom | 自动显示正确，IMS 注册，能拨出/接听，检查地图评论区 |

每个组合至少再重启一次。实际拨出必须使对方响铃、接通计时并双向通话；
接听由另一部手机呼入，不能只依靠 WebUI 成功、LTE 图标或 UT=true 判断。
Google 地图评论区是应用侧验收，国家码读回正确不保证其可用。
不在这些组合中启用测试 PLMN，以免把独立测试身份变量混入正常路径。

若失败，导出诊断并记录是开机还是手动、执行方式、显示覆盖开关、拨出/接听结果。
检查 status.session 与当前 boot_id 一致，configuration_applied / ims_registration_verified，
ims_results、carrier_test_override_results、runner.log；发生 retry_timeout 时查看 retry_reason。

以下只读命令流式过滤，不捕获整个 dump 到 shell 变量，不输出 IMSI/ICCID 内容：

```sh
su -c 'dumpsys -t 20 activity service TelephonyDebugService 2>&1' |
/system/bin/sed -n -E '
/No services match/ { s/.*/DEBUG_SERVICE_NOT_FOUND/; p; b; }
/Permission Denial/ { s/.*/DUMP_PERMISSION_DENIED/; p; b; }
/DUMP TIMEOUT/ { s/.*/DUMP_TIMEOUT/; p; b; }
s/^[[:space:]]*(mPhoneId)[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\1=\2/p
s/^[[:space:]]*(mConfigUpdated|isVolteEnabledByPlatform|isVolteProvisionedOnDevice|isEnhanced4gLteModeSettingEnabledByUser|isVoImsOptInEnabled)[[:space:]]*=[[:space:]]*(true|false)[[:space:]]*$/\1=\2/p
/^[[:space:]]*mMmTelCapabilities[[:space:]]*=/p
/mFakeImsi=/ {
  s/.*mFakeImsi=([^[:space:]]*).*/\1/
  /^$/ { s/.*/fake_imsi=EMPTY/; p; b; }
  /^null$/ { s/.*/fake_imsi=NULL/; p; b; }
  s/.*/fake_imsi=NONEMPTY_REDACTED/; p; b;
}
s/.*ImsReasonInfo[^{]*[{][[:space:]]*([0-9]+)[^,]*,[[:space:]]*(-?[0-9]+),.*/ims_reason_code=\1 extra_code=\2/p
'
```

修复后的普通路径在重新启动后不应再由本模块生成 fake_imsi=EMPTY。
这份过滤仅供状态排查，reason code 没有完整事件时间链，不能单独据此断定具体呼叫失败原因。
自动测试与构建通过也不能代替上表设备验收。
