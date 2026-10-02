#!/system/bin/sh
# Public CLI: sh /data/adb/modules/turboims_next/control.sh probe|status|apply|restore|export
MODDIR=${0%/*}
umask 077
case "$1" in
  probe|status|get-config|get-ui|apply|restore|export|watch)
    [ "$#" -eq 1 ] || exit 64 ;;
  save|save-ui)
    [ "$#" -eq 2 ] || exit 64
    case "$2" in *[!A-Za-z0-9+/=]*) exit 64 ;; esac ;;
  *) echo '{"ok":false,"error":"Unknown action"}'; exit 64 ;;
esac
[ -r "$MODDIR/runner.apk" ] || {
  echo '{"ok":false,"error":"Bundled runner is missing"}'
  exit 66
}
export CLASSPATH="$MODDIR/runner.apk"
if [ "$1" = "watch" ]; then
  exec /system/bin/app_process64 /system/bin io.github.turboims.ksu.ModuleMain "$MODDIR" "$@"
fi
exec /system/bin/timeout 45 /system/bin/app_process64 /system/bin \
  io.github.turboims.ksu.ModuleMain "$MODDIR" "$@"
