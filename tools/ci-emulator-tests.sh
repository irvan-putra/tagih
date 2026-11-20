#!/usr/bin/env bash
# Stream logcat while running the instrumentation tests; kill logcat by PID.
# One committed file because the emulator CI step runs each script line in
# its own shell - variables do not survive across workflow script lines.
cd "$GITHUB_WORKSPACE" || exit 1
adb logcat -c
adb logcat -v threadtime > "$RUNNER_TEMP/tagih-logcat.txt" 2>&1 &
LOGCAT_PID=$!
set +e
gradle -p android connectedDebugAndroidTest
STATUS=$?
kill "$LOGCAT_PID" 2>/dev/null || true
exit $STATUS
