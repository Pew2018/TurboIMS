#!/system/bin/sh
MODDIR=${0%/*}
STATE=/data/adb/turboims-next
LOG=$STATE/launcher.log
RECOVERY=$STATE/uninstall-restore.json
umask 077
mkdir -p "$STATE"
chmod 0700 "$STATE"
# Preserve config/diagnostics for recovery. Never clear global CarrierConfig overrides.
if [ -r "$MODDIR/runner.apk" ]; then
  if /system/bin/sh "$MODDIR/control.sh" restore >> "$LOG" 2>&1; then
    rm -f "$RECOVERY"
  else
    code=$?
    printf '{"phase":"uninstall_restore_failed","ok":false,"exit_code":%s,"requires_reboot":true}\n' "$code" > "$RECOVERY"
    chmod 0600 "$RECOVERY"
    printf '%s uninstall restore failed (exit %s); reboot clears nonpersistent overrides\n' "$(date +%s)" "$code" >> "$LOG"
  fi
else
  printf '{"phase":"uninstall_restore_unavailable","ok":false,"requires_reboot":true}\n' > "$RECOVERY"
  chmod 0600 "$RECOVERY"
fi
# A reboot also clears this module's nonpersistent overrides.
