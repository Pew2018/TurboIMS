# TurboIMS Next — 独立 KernelSU Next 模块

## 当前状态

版本：0.1.0-experimental。**构建测试不等于手机上的 CarrierConfig 写入或 IMS 通话已经验证。**
初始验证设备是 Pixel 8 Pro / husky / Android 16 / SDK 36 / SELinux Enforcing。
安装器接受 arm64、SDK 33–36；其他组合的兼容性尚未实测，SDK 37+ 明确拒绝，避免静默误用。

只安装一个模块 ZIP：无需 TurboIMS App、辅助 App、Shizuku、Sui、Zygisk、LSPosed 或挂载扩展。
内置的 runner.apk 只是 DEX 容器，由系统 app_process64 以 KernelSU uid 0 加载，**不会安装到包管理器**。

原 app 和 stub 代码未修改。新 runner 使用独立 Gradle 工程，构建只在 GitHub Actions 进行。

## 安装与首次验证

1. 下载 Actions 的 TurboIMS-Next-0.1.0-experimental artifact。解压下载的 artifact ZIP，
   在 KernelSU Next 中安装其中的 **TurboIMS-Next-0.1.0-experimental.zip**，不要安装外层 artifact ZIP。
2. 重启，打开模块 WebUI，点击“只读检测”。首次安装 enabled=false，不会主动覆盖 IMS 配置。
3. 确认返回 uid=0、系统 Binder 可读取、活跃 SIM 和 carrier_config_applied_bool=true。
   只读检测不会测试 MODIFY_PHONE_STATE 写入权限，成功不等于可以写入。
4. 选择 SIM 范围，启用“自动适配”，设置功能，点击“保存并应用”。允许进行非持久 CarrierConfig 写入，
   程序会轮询读回结果；确认 verified，而不是仅看到退出码 0。
5. 不依赖性验证：在你同意后停用 Sui 并重启，不需要卸载，也不要同时改变其他模块。
   确认本模块仍在工作。原 TurboIMS/NRFR 不应同时手动覆盖同一组 CarrierConfig。
6. 在系统设置中按需要启用 Wi-Fi 通话等开关，分别验证 IMS 注册、实际通话、Wi-Fi 通话。
   本模块不强制用户 telephony 开关，不修改运营商 provisioning，不保证运营商一定支持。
7. 再重启验证自动应用；如果使用双卡/eSIM，切换活跃 SIM 后在一个检查间隔内观察新 subId。

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

每项有“开启覆盖 / 关闭覆盖 / 恢复原值”三种模式。
“关闭覆盖”是显式关闭可用性；5G NR 关闭会设置空 availability 数组。
“恢复原值”恢复本模块第一次修改前记录的有效配置，可能包含其他工具此前的覆盖；
**它不是获得运营商真实默认配置的保证，也不是清除某个第三方工具的修改**。

开启模式保持原项目的 CarrierConfig 映射。不支持/缺少默认值的 OEM 私有键将跳过并报告，
以避免无法单独恢复一个原本不存在的键。开启配置不会凭空创造运营商 IMS 支持。
返回 unsupported 时，模块仅应用已支持的键，不能宣称所有相关功能都已实现。

## 执行与可靠性

- service.sh 仅在 late service 等待 boot_completed，最长 6 分钟，不占用 post-fs-data。
- 一个 Java watcher 默认每 30 秒检查活跃 SIM 与相关有效 CarrierConfig，无变化不调用 overrideConfig。
- 配置未准备好时约每 5 秒再检查；不是固定写死 subId=1/2。
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

## 恢复与冲突边界

系统 overrideConfig 合并 bundle；传 null 会清空同一 SIM 的非持久覆盖，包括其他工具的配置。
因此本模块永远不传 null，也不操作电话服务数据目录。

snapshot 按本次启动和 subId 记录基线及本模块最近写入值。切回“恢复原值”、暂停或取消某个卡槽时，
只恢复本模块拥有且仍匹配最近写入值的键；第三方后来改变的键报告 conflict，不覆盖。
CarrierConfig 重载清除 session 标记后，重新读取新基线；换启动后的旧 snapshot 不使用。

这个 API 没有独立的“每个模块的覆盖层”，因此无法完全避免并发第三方写入或追踪相同值的来源。
如果其他工具写入了相同的值，本模块无法识别来源。可靠使用应避免多个工具管理相同键。

本模块恢复的是有效值，而不是删除单个覆盖层里的键（系统 API 不支持逐键删除）。
暂停并恢复后，这些基线值的非持久覆盖可能仍留至重启；重启会清除本模块的非持久覆盖。
停用模块后若 watcher 仍在运行，会尽力恢复后退出；如果管理器强制杀进程，
停用并重启同样可以清除本模块覆盖。卸载保留 /data/adb/turboims-next 的配置和诊断，便于恢复排查。

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
probe 为只读，restore 会暂停自动适配并尽力恢复自己的修改。
save 接收严格校验的 base64 JSON，不接受任意 Shell 内容。

## WebUI

无 CDN、无 npm 运行时依赖。使用 KernelSU Next 的 ksu.exec(cmd, options, callbackName) 异步接口；
回调、退出码、JSON 错误和超时均检查。根权限操作来自白名单，配置是 base64 单独参数，
不把自由文本拼接成 Shell 命令。页面采用深灰顶栏、灰色背景与蓝色操作元素，无模糊或噪点。
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
