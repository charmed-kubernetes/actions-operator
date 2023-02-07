#!/usr/bin/env bash
X="$RANDOM"
echo Command will fail if $X \% 10 == 0
if [[ "$((X % 10))" -eq 0 ]]; then
	echo snap command failed randomly
else
	snap_real "$@"
fi
