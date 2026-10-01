#!/system/bin/sh
[ "$KSU" = "true" ] || abort "Install with KernelSU Next."
[ "$ARCH" = "arm64" ] || abort "Initial validation target is arm64."
[ "$API" -ge 33 ] && [ "$API" -le 36 ] || abort "Android 13..16 required."
[ -f "$MODPATH/runner.apk" ] || abort "Missing bundled runner."
(cd "$MODPATH" && sha256sum -c runner.sha256) || abort "Runner checksum mismatch."
ui_print "TurboIMS Next: standalone root executor"
ui_print "No Shizuku, Sui, Zygisk or installed app required."
ui_print "First installation starts in read-only/paused mode."
ui_print "Open WebUI, run probe, then enable and apply."
set_perm "$MODPATH/runner.apk" 0 0 0444
for script in customize.sh service.sh action.sh uninstall.sh control.sh; do
  set_perm "$MODPATH/$script" 0 0 0755
done
# Do NOT alter webroot permissions/context: the KernelSU installer owns them.
mkdir -p /data/adb/turboims-next
chmod 0700 /data/adb/turboims-next
if [ ! -f /data/adb/turboims-next/config.json ]; then
  cp "$MODPATH/default-config.json" /data/adb/turboims-next/config.json
  chmod 0600 /data/adb/turboims-next/config.json
fi
