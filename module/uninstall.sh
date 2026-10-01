#!/system/bin/sh
MODDIR=${0%/*}
# Preserve config/diagnostics for recovery. Never clear global CarrierConfig overrides.
if [ -r "$MODDIR/runner.apk" ]; then
  /system/bin/sh "$MODDIR/control.sh" restore \
    >> /data/adb/turboims-next/launcher.log 2>&1
fi
# A reboot also clears this module's nonpersistent overrides.
