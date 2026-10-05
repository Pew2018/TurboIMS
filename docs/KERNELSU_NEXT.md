# TurboIMS Next — 独立 KernelSU Next 模块

## 当前状态

版本：0.3.5。**构建测试不等于手机上的 CarrierConfig 写入或 IMS 通话已经验证。**
初始验证设备是 Pixel 8 Pro / husky / Android 16 / SDK 36 / SELinux Enforcing。
SDK 36 构建产物供 Android 13–16 / arm64 使用；SDK 37 构建产物同时包含 Android 17 构建验证，兼容性仍需设备实测。

只安装一个模块 ZIP：无需 TurboIMS App、辅助 App、Shizuku、Sui、Zygisk、LSPosed 或挂载扩展。
内置的 runner.apk 只是 DEX 容器，由系统 app_process64 以 KernelSU uid 0 加载，**不会安装到包管理器**。

原 app 和 stub 代码未修改。新 runner 使用独立 Gradle 工程，构建只在 GitHub Actions 进行。

## 安装与首次验证

1. 下载成功 Actions 中的 **FLASHABLE-TurboIMS-Next-0.3.5-sdk36** 产物（Android 16）。
   在 KernelSU Next 直接选择此下载文件安装，**无需解压，不存在内层模块 ZIP**。
   必须等待 Verify actual downloadable ZIP and installer 检查通过。
   旧 0.1.0 的外层 artifact 和 test-reports ZIP 不是模块，不可直接安装。
2. 重启，打开模块 WebUI，点击“检测设备”。首次安装“开机自动应用”和“定时检查与修复”均关闭，不会主动覆盖 IMS 配置。
3. 确认返回 uid=0、系统 Binder 可读取、活跃 SIM 和 carrier_config_applied_bool=true。
   只读检测不会测试 MODIFY_PHONE_STATE 写入权限，成功不等于可以写入。
4. 选择 SIM 范围，设置功能，点击“应用配置”。即使未开启开机自动应用，也会立即尝试一次非持久 CarrierConfig 写入，
   程序会轮询读回结果；确认 verified，而不是仅看到退出码 0。
5. 不依赖性验证：在你同意后停用 Sui 并重启，不需要卸载，也不要同时改变其他模块。
   确认本模块仍在工作。原 TurboIMS/NRFR 不应同时手动覆盖同一组 CarrierConfig。
6. 在系统设置中按需要启用 Wi-Fi 通话等开关，分别验证 IMS 注册、实际通话、Wi-Fi 通话。
   本模块不强制用户 telephony 开关，不修改运营商 provisioning，不保证运营商一定支持。
7. 如需开机自动应用，开启该开关并保存，重启验证一次应用后任务退出。切换活跃 SIM 后可手动应用；如需定期检查与修复，另行开启独立开关。

日常使用：完成第 4 步后，配置存储于 /data/adb/turboims-next/config.json，
以后开机无需进入 App 或 WebUI。没有活跃 SIM 时等待，不把历史 eSIM 条目当作活跃订阅。

## 功能与设置语义

| 功能 | 开启覆盖 |
| --- | --- |
| VoLTE | LTE 语音可用、增强 LTE 可编辑及图标相关键 |
| VoWiFi | Wi-Fi 通话、Wi-Fi only、模式与漫游模式编辑、图标和 SPN 格式 |
| VT | IMS 视频通话可用 |
| VoNR | 5G 语音及设置入口 |
| Cross-SIM | 跨 SIM IMS 和机会性数据通话 |
| UT | 基于 IMS 的补充服务 |
| 5G NR | NSA / SA 可用，SSRSRP 阈值 [-128, -118, -108, -98] |

底层每项保留“开启覆盖 / 关闭覆盖 / 恢复原值”三种模式。IMS 页面用两态开关表示开启或关闭；单项恢复原值在“设置”中选择，并在返回 IMS 后应用。
“关闭覆盖”是显式关闭可用性；5G NR 关闭会设置空 availability 数组。
“恢复原值”恢复本模块第一次修改前记录的有效配置，可能包含其他工具此前的覆盖；
**它不是获得运营商真实默认配置的保证，也不是清除某个第三方工具的修改**。

开启模式保持原项目的 CarrierConfig 映射。不支持/缺少默认值的 OEM 私有键将跳过并报告，
以避免无法单独恢复一个原本不存在的键。开启配置不会凭空创造运营商 IMS 支持。
返回 unsupported 时，模块仅应用已支持的键，不能宣称所有相关功能都已实现。

## 执行与可靠性

- service.sh 仅在 late service 等待 boot_completed，最长 6 分钟，不占用 post-fs-data。
- “开机自动应用”只执行一次：等待目标 SIM 与 CarrierConfig 就绪、逐卡应用和读回验证，正常完成后退出。未就绪最多尝试 12 次、间隔约 5 秒；每次 IMS 注册检查最多约 20 秒，因此注册未就绪时可持续约 5 分钟。已匹配的配置不重复写入；Carrier IMS 每个任务、配置版本、订阅仅接受一次 reset。最终仍未注册时报告 retry_timeout / ims_not_registered，而不是配置成功后立即结束。
- “定时检查与修复”独立且默认关闭；可选择 10/30/60/120 分钟，默认 30 分钟。等待使用配置文件事件通知和长时间定时等待，不做每秒文件轮询，不持有唤醒锁。配置符合设置时不重复写入。
- 修改定时开关或间隔会保存设置并启动、唤醒或结束定时任务；手动“应用配置”立即执行一次。
- 按卡槽选择，每次解析当前活跃 subId；单卡、历史 eSIM 记录不混用。
- 采用平台 ICarrierConfigLoader / ISub 的 Stub.asInterface 和反射方法，
  不硬编码 Binder transaction number、不依赖 pm path。
- 所有覆盖使用 persistent=false；不写系统分区或永久 CarrierConfig 缓存。
- 权限、隐藏接口或读回验证失败会停止自动写入并写 blocked.json。
  明确的手动 apply 成功后可解除阻塞；不会偷偷改变 SELinux、权限或 UID 绕过错误。
- 核心操作文件锁串行化，独立 daemon 锁避免重复 watcher。
- 原子保存配置与 snapshot；写入前先保存恢复记录；写入后最多约 5 秒读回验证。
- 比较实际键值，不使用“版本号相同即跳过”的旧逻辑。
- 日志滚动限制；不收集电话号码、IMSI、ICCID 等订阅身份信息。

不能把 apply 的成功等同于 modem/IMS 已注册，更不能保证 VoNR/VoWiFi 可用；
read-back verification 只证明 CarrierConfig 有效值已匹配。

## SIM 显示与测试身份（0.3.5）

国家码和运营商名称通过 CarrierConfig 独立设置。选择台湾 / Chunghwa Telecom 不再推导 46692。
TurboIMS 使用原有配置写入路径并只读检查 IMS 注册；Carrier IMS 额外进行有次数限制的 IMS reset，默认同样保留真实 SIM 身份。
注册成功仍需实际拨出、接听和语音能力验收；配置写入成功不能代替通话测试。

旧 sim_profiles 升级后保留国家码、英文名称、测试值和开机自动应用偏好，但 carrier_test_enabled 默认 false。
只有显式开启“启用测试运营商身份”才会应用测试 PLMN（仅 Carrier IMS）。升级后应先重启再测试。
测试调用的 IMSI、ICCID、GID1/2、PNN/SPN、权限规则和 APN 参数都使用 null，保留真实值，不使用空字符串。
不读取或保存 IMSI、ICCID、电话号码。

测试覆盖记录使用 identity_schema=2。旧记录不得跳过修正后的调用。
上次启动的测试覆盖记录过期后删除，不把旧 PLMN 写入新启动的 SIM。
如果同次启动的旧覆盖没有可信的原始 PLMN，且系统无 clearCarrierTestOverride API，
返回 carrier_test_cleanup_requires_reboot，保留诊断并要求重启；绝不从已污染的 SubscriptionInfo 猜原始运营商。
新覆盖只在首次写入前、公开 SIM 与订阅 PLMN 一致时记录原始 PLMN。
缺少清除 API 的恢复路径仅可使用这个基线，仍保留所有可选身份字段；此路径不承诺关闭 Android 内部 test-mode bit，重启会清除其内存状态。

完整修复范围和四组合验收参见 [IMS_IDENTITY_HOTFIX.md](IMS_IDENTITY_HOTFIX.md)。

## 恢复与冲突边界

系统 overrideConfig 合并 bundle；传 null 会清空同一 SIM 的非持久覆盖，包括其他工具的配置。
因此本模块永远不传 null，也不操作电话服务数据目录。

snapshot 按本次启动和 subId 记录基线及本模块最近写入值。明确选择单项“恢复原值”并应用，或点击“停止并恢复”时，
只恢复本模块拥有且仍匹配最近写入值的键；第三方后来改变的键报告 conflict，不覆盖。
CarrierConfig 重载清除 session 标记后，重新读取新基线；换启动后的旧 snapshot 不使用。

这个 API 没有独立的“每个模块的覆盖层”，因此无法完全避免并发第三方写入或追踪相同值的来源。
如果其他工具写入了相同的值，本模块无法识别来源。可靠使用应避免多个工具管理相同键。

本模块恢复的是有效值，而不是删除单个覆盖层里的键（系统 API 不支持逐键删除）。
暂停并恢复后，这些基线值的非持久覆盖可能仍留至重启；重启会清除本模块的非持久覆盖。
正常任务结束、关闭定时检查或切换运行模式不会触发恢复；停用并重启可以清除本模块的非持久覆盖。卸载保留 /data/adb/turboims-next 的配置和诊断，便于恢复排查。

## Termux 诊断（只需要一条）

```sh
su -c '/system/bin/sh /data/adb/modules/turboims_next/control.sh export > /sdcard/turboims-next-diagnostics.txt 2>&1'
```

如果 runner 无法启动，用以下命令收集 launcher.log（只读，不会写 CarrierConfig）：

```sh
su -c '{
  id
  getenforce
  ls -l /data/adb/modules/turboims_next/runner.apk
  ls -l /data/adb/turboims-next
  tail -100 /data/adb/turboims-next/launcher.log
  tail -100 /data/adb/turboims-next/runner.log
} > /sdcard/turboims-next-launcher.txt 2>&1'
```

CLI 操作：probe / status / get-config / apply / restore / export。
probe 为只读，restore 会关闭开机自动应用与定时检查，并尽力恢复自己的修改。
save 接收严格校验的 base64 JSON，不接受任意 Shell 内容。

## SIM 卡信息

“SIM 卡信息”页面复刻 Nrfr 的核心能力，并接入同一套 root runner：

- 按当前活跃卡槽分别保存 SIM 国家码和运营商名称覆盖；
- 提供国家/地区预设、自定义两位国家码、运营商名称预设和自定义名称；
- “保存并应用”只写入选中卡槽的 SIM 信息，并进行读回验证；
- “恢复原始信息”只恢复本模块记录的 SIM 信息，不传空配置，也不清除 IMS 覆盖；
- SIM 配置保存在 `config.json`，开机等待 SIM 与 CarrierConfig 就绪后有限重试一次；
- 国家码和运营商名称覆盖使用非持久 CarrierConfig，重启后由模块重新应用。

SIM 信息覆盖和 IMS 覆盖共享同一张卡的快照、冲突检测和恢复引擎。当前配置应用成功只代表 CarrierConfig 读回一致，不代表运营商一定允许 VoLTE、VoWiFi、VoNR 或漫游服务。

## WebUI

无 CDN、无 npm 运行时依赖。使用 KernelSU Next 的 ksu.exec(cmd, options, callbackName) 异步接口；
回调、退出码、JSON 错误和超时均检查。根权限操作来自白名单，配置是 base64 单独参数，
不把自由文本拼接成 Shell 命令。页面采用早期 OxygenOS 风格的浅色或深色 Preference 页面，强调色可选，无模糊或噪点。
webroot 的权限和 SELinux 标签由 KernelSU 安装器设置，不自行破坏。

## 构建与测试

GitHub Actions 执行：

```sh
./gradlew -p root-runner --no-daemon testReleaseUnitTest assembleRelease
node --test ci/test_webui.cjs
python3 ci/package_module.py
```

Java 单元测试覆盖七功能映射、显式关闭、默认恢复、异步读回、冲突保护、
重复应用、同版本设置变更和失败恢复记录。WebUI 测试覆盖白名单、注入防护、
原生异步回调、结构化错误、缺少 bridge 和离线资源。
打包检查 DEX main 入口存在，不包含 Shizuku/Sui 类引用，附 helper 与 ZIP SHA-256。
安装器校验 helper 摘要并设为 0444，满足 Android 新版本只读 DEX 容器要求。

CI 是离线与编译验证，不是设备 Binder/SELinux/IMS 测试。
功能开发留在 feature 分支，设备失败后的修复使用新 fix 分支，未验证不合并 master。

## 依据与依赖

- 原项目七组配置映射：app/src/main/java/io/github/vvb2060/ims/PrivilegedProcess.java
- AOSP ICarrierConfigLoader / ISub（Android 13–16）
- KernelSU / KernelSU Next 模块、late service 与 WebUI API
- org.lsposed.hiddenapibypass:hiddenapibypass:6.1（Apache-2.0）
  这是 Java 库，不要求安装 LSPosed 或 Zygisk。


## Recovery audit follow-up

- Recovery snapshots now keep the last verified ownership and a separate pending write.
  A Binder exception before mutation must not turn our previous value into a false
  third-party conflict. Interrupted writes and restores are reconciled from read-back.
  Legacy snapshots without pending writes remain readable.
- If the boot marker disappears while tracked values differ from their baseline, the
  controller preserves the snapshot and reports ownership_lost instead of rebasing on
  a possibly modified value. Export diagnostics; disabling the module and rebooting
  clears its nonpersistent overrides.
- Each active subscription is processed separately. An exception on one SIM does not
  erase another SIM's result. Failed writes are conservatively reported as unconfirmed;
  automatic retries stop until an explicit apply/restore succeeds.
- Unsupported requested keys produce partial status, never complete success.
- Status records are tagged with boot sessions. Previous-boot status is retained only
  as previous_status and is not presented as a current successful application.
- These checks do not prove IMS registration, carrier provisioning or call capability.
  Root Binder/SELinux behavior still requires device validation.


## 安装包格式与下载回归检查

KernelSU Next 在运行 customize.sh 前会读取 ZIP 根目录的 module.prop。
因此，含有另一个模块 ZIP 的 Actions 外层包会在安装脚本执行前失败。
0.1.1 改为将平铺的模块文件目录上传给 upload-artifact，让 GitHub 生成的下载 ZIP
本身就是模块。只保留一个 FLASHABLE 下载成果，测试报告改为写入工作流摘要。

打包检查同时覆盖根目录必需文件、元数据、LF 换行、路径安全、DEX 入口、runner
SHA-256，并拒绝嵌套 ZIP。独立 CI job 用 GitHub API 下载用户实际得到的归档，
再次验证结构并在 BusyBox 下模拟安装脚本的参数检查、摘要验证、文件权限及升级保留配置。
artifact 不保留 Unix 权限，安装脚本会重新设置 runner=0444 和脚本=0755；
不要求为此添加 META-INF 或 install.sh。

依据：
- https://github.com/KernelSU-Next/KernelSU-Next/blob/dev/userspace/ksud/src/module.rs
- https://github.com/KernelSU-Next/KernelSU-Next/blob/dev/userspace/ksud/src/installer.sh
- https://kernelsu.org/guide/module.html
- https://github.com/actions/upload-artifact/tree/v4
