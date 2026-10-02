#!/system/bin/sh
MODDIR=${0%/*}
umask 077
# Late service only. No post-fs-data, no blocking the boot chain.
attempt=0
while [ "$(/system/bin/getprop sys.boot_completed)" != "1" ]; do
  [ -f "$MODDIR/disable" ] || [ -f "$MODDIR/remove" ] && exit 0
  attempt=$((attempt + 1))
  [ "$attempt" -lt 180 ] || exit 0
  sleep 2
done
# A bounded boot pass applies and verifies once; optional scheduled checks use long waits.
exec /system/bin/sh "$MODDIR/control.sh" watch \
  >> /data/adb/turboims-next/launcher.log 2>&1
