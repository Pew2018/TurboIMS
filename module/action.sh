#!/system/bin/sh
MODDIR=${0%/*}
# Manager action is intentionally diagnostic, never silently enables mutation.
exec /system/bin/sh "$MODDIR/control.sh" probe
