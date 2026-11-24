#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="./node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
umask 077
mkdir -p -- "$PM2_HOME"
exec 9>"$PM2_HOME/zappy-boot.lock"
flock -n 9 || exit 0
echo "[zappy-boot] $(date -Is) starting precheck"
node scripts/check-infra.mjs --wait=300

# Only resurrect a saved deployment if the daemon has no running Zappy apps.
# If PM2 is already serving live traffic, keep its PIDs and environment intact.
if [[ -s "$PM2_HOME/dump.pm2" ]]; then
  pm2 ping 9>&- >/dev/null
  action=$(pm2 jlist 9>&- | node scripts/pm2-boot-state.mjs "$PM2_HOME/dump.pm2")
  case "$action" in
    restore)
      pm2 resurrect 9>&-
      restored=$(pm2 jlist 9>&- | node scripts/pm2-boot-state.mjs "$PM2_HOME/dump.pm2")
      [[ "$restored" == keep ]]
      ;;
    keep) echo "[zappy-boot] saved apps already online" ;;
    *) exit 1 ;;
  esac
else
  echo "[zappy-boot] missing PM2 dump; save the intended deployment first" >&2
  exit 1
fi

node scripts/pm2-resolvers.mjs 9>&-
echo "[zappy-boot] $(date -Is) complete"
