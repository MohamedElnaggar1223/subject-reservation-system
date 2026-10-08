#!/bin/zsh
# The conversion proof on all four databases (copies dropped and made again), then 09 over each.
set -u
: "${PGPASSWORD:?set PGPASSWORD: the local test container password}"; export PGPASSWORD
EV=/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/conversion
run_one() {
  local src=$1 copy=$2 short=$3
  psql -h 127.0.0.1 -p 5433 -U audit -d postgres -c "DROP DATABASE IF EXISTS $copy" > /dev/null
  echo "=== $src"
  /tmp/rwa/conv/run.sh $src $copy 2>&1 | grep -E "copied|migrations|lines |statuses|DIFFERENCES|^  "
  /tmp/rwa/conv/run09.sh $copy $short 2>&1 | grep -E "×|Tests"
}
run_one igcse_template_dev igcse_rwa_conv_tpl tpl
run_one igcse_foundation_dev igcse_rwa_conv_fnd fnd
run_one igcse_catalogue_synth igcse_rwa_conv_syn syn
run_one igcse_catalogue_synth_closed igcse_rwa_conv_sync sync
