# 0.3.3: WebUI execution fix and evidence-based boot investigation

## 中文

本版本继续使用 `fix/boot-ownership-recovery`，没有合并 master。它修复已确认的 WebUI 执行问题，并补充开机失败诊断；**尚未证实解决设备的 IMS 注册与配置变化问题**。

### 来自设备的证据

设备为 husky / Android 16 SDK 36，模块 0.3.2，KernelSU Next 管理器 3.3.0。

- 重启前：配置与 SIM 信息通过写入验证，IMS 注册返回 false。watcher 文件写着 running，但实时 status 确认 alive=false。
- 重启后、没有手动应用：开机任务先记录 verified，最终结果是 verification_failed，并生成 blocked.json。最终读回 hide_enhanced_4g_lte_bool=true（请求 false），carrier_nr_availabilities_int_array=[1]（请求 [1,2]）；本模块标记仍匹配本次开机。
- 这些证据证明任务执行过、且配置最终不符合请求，不能据此确定是 IMS reset、系统还是其他软件改变了配置。本次最终失败记录的 reset_accepted_this_attempt=false。
- 0.2.0 备份版本的 ModuleMain 不使用 carrier-test 身份覆盖、IMS reset 或注册轮询。用户实测该版本重启后可以打电话和使用 Google 地图评论区。地图功能本身不作为 IMS 注册检测。

### 已修改

- 根据 KernelSU Next v3.3.0 的 WebViewInterface.kt，exec 使用同步 Shell.Job.exec()，spawn 使用 enqueue()。WebUI 改用 spawn 的流式 stdout/stderr/exit/error 回调，避免长命令阻塞 JavaScript 调用；保留操作锁与防重复点击。
- 处理分段输出、非零退出的结构化结果、重复退出/错误事件、启动失败和超时。桥接等待期限覆盖 control.sh 的 180 秒期限。
- 按钮文字在等待期间保持原样；底部导航继续可用。
- 最终结果记录任务 action、耗时、IMS 检测前已验证配置、最终具体差异和前后标记；runner.log 记录开始、IMS 观察和结束。
- 输出 SIM 属性、网络属性与订阅信息中的公开运营商 MCC/MNC，不收集电话号码、IMSI 或 ICCID。订阅信息由系统报告，不视为独立验证的物理 SIM 身份。
- watcher 记录 running 但进程已退出时，status 输出 interrupted，并保留 recorded_mode。
- 失败的只读检测、状态查询或配置保存不会覆盖最近的开机/应用结果。

### 验证边界与复测

GitHub Actions 的 host tests、SDK 36/37 编译和安装包 smoke 验证只能验证代码与包结构，不能证明设备完成 IMS 注册或通话。

先保留现有 Carrier IMS 设置，安装 SDK 36 包后重启，等待至少 3 分钟，期间不要手动应用。收集 export 的完整结果。若失败，可先收集 carrier_config 中的 overrideConfig 调用记录，遮盖用户标识。

作为受控对照，用户可以选择 TurboIMS 实现方式，保留 IMS 功能、SIM 国家和名称，应用后重启并测试地图评论区、通话与导出诊断。两条路径的结果需分开记录。切换模式可能触发已记录 carrier-test 覆盖的清理；任何清理失败必须保留真实错误。

不要用循环强制重写掩盖相同标记下的值变化，不要把 Binder 接受或配置写入成功等同于注册/通话成功。

## English

0.3.3 stays on the hotfix branch and fixes the confirmed WebUI execution path. It does **not** claim device IMS registration or boot configuration recovery is complete.

The untouched post-reboot diagnostic shows a successful initial verification followed by a final mismatch: the LTE visibility flag changed to true and NR availability to [1], while the owner marker remained. The result was correctly blocked. The final attempt did not accept another IMS reset, so attributing that mismatch to reset alone would be unsupported.

The v3.3.0 manager implementation executes exec synchronously and queues spawn jobs. The bridge now uses streamed spawn events, preserves structured failures, handles late events and startup errors, and keeps its deadline beyond the foreground runner limit. Buttons retain their labels and navigation remains available.

Runner diagnostics now distinguish boot, periodic and manual actions, record timings and verified-before-observation values, and list final expected/actual differences. An exited worker with an unfinished marker is reported as interrupted. Failed read-only queries and rejected saves no longer replace the last apply result. Only public operator codes are added; no subscriber identifiers are collected.

The archived 0.2.0 implementation contains no carrier-test identity writes, IMS reset or registration polling. The user's successful calls make it a useful functional comparison, while Maps review access alone does not establish IMS registration.

CI validates host logic, compilation and archive installation, not real device registration. First reproduce with unchanged Carrier IMS settings and collect export before manual writes. A separate user-selected TurboIMS-mode reboot provides a controlled comparison. Preserve failures and conflicts; do not force overwrite an unexplained same-marker change or report an accepted Binder call as successful registration.

Sources:
- [KernelSU Next v3.3.0 bridge](https://github.com/KernelSU-Next/KernelSU-Next/blob/v3.3.0/manager/app/src/main/java/com/rifsxd/ksunext/ui/webui/WebViewInterface.kt)
- [Archived 0.2.0 runner](https://github.com/Pew2018/TurboIMS/blob/487b4129176597a84a675cd36b42b0839bf2d425/root-runner/src/main/java/io/github/turboims/ksu/ModuleMain.java)
