#!/bin/sh
# Fake `hear` binary for STT supervisor tests. POSIX-sh portable.
#
# Behavior is driven entirely by environment variables so a single fixture can
# stand in for every test scenario the SttSupervisor must handle. Real `hear`
# ignores SIGINT and exits cleanly on SIGTERM (Task 9 spike); this fixture does
# the same by simply not trapping SIGTERM (default disposition = terminate).
#
#   FAKE_COUNT_FILE     : append one line per process start (spawn count = wc -l)
#   FAKE_PID_FILE       : write this process's PID (for shutdown/group tests)
#   FAKE_CHILD_PID_FILE : fork a background `sleep` grandchild, write its PID
#                         (proves shutdown kills the whole process GROUP, not
#                         just the direct child)
#   FAKE_MODE           : emit-stay (default) | emit-exit | config-error
#                           emit-stay    -> emit lines, then block until killed
#                           emit-exit    -> emit lines, then exit 0 (-> respawn)
#                           config-error -> print a Code=201 error to stderr and
#                                           exit 1 instantly (dictation disabled)
#   FAKE_LINES          : lines to emit on stdout, separated by '|'
#                           (default "hello world|testing one two")
#   FAKE_LINE_DELAY     : seconds to sleep between lines (default 0.05)
#   FAKE_EMIT_FILE      : append each line here just before printing it to stdout
#                         (proves the fixture actually emitted, so a gate-closed
#                          test can't pass vacuously by never emitting anything)

if [ -n "$FAKE_COUNT_FILE" ]; then
  printf 'start\n' >> "$FAKE_COUNT_FILE"
fi
if [ -n "$FAKE_PID_FILE" ]; then
  printf '%s\n' "$$" > "$FAKE_PID_FILE"
fi
if [ -n "$FAKE_CHILD_PID_FILE" ]; then
  sleep 300 &
  printf '%s\n' "$!" > "$FAKE_CHILD_PID_FILE"
fi

MODE="${FAKE_MODE:-emit-stay}"

if [ "$MODE" = "config-error" ]; then
  # Mirror the real hear failure when Dictation is disabled (Task 9 spike).
  printf 'Error Domain=kLSRErrorDomain Code=201 "Siri and Dictation are disabled"\n' >&2
  exit 1
fi

LINES="${FAKE_LINES:-hello world|testing one two}"
DELAY="${FAKE_LINE_DELAY:-0.05}"

OLDIFS=$IFS
IFS='|'
for line in $LINES; do
  IFS=$OLDIFS
  if [ -n "$FAKE_EMIT_FILE" ]; then
    printf '%s\n' "$line" >> "$FAKE_EMIT_FILE"
  fi
  printf '%s\n' "$line"
  sleep "$DELAY"
  IFS='|'
done
IFS=$OLDIFS

if [ "$MODE" = "emit-exit" ]; then
  exit 0
fi

# emit-stay: block until the supervisor terminates us (SIGTERM).
while true; do
  sleep 1
done
