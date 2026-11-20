#!/usr/bin/env bash
# Build the signed release APK, install it on the emulator, and prove the
# export path by driving the real UI: launch the app, tap the page's export
# button through its exact CSS color, screenshot, and require the JSON backup
# in Download/tagih. The production app carries no test hooks or automation
# extras. Invoked as one line from the emulator CI step:
# android-emulator-runner runs each script line in its own shell, so all state
# must live inside this file.
set -euo pipefail
cd "$GITHUB_WORKSPACE"
echo "$SIGNING_KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/keystore.jks"
export SIGNING_KEYSTORE_PATH="$RUNNER_TEMP/keystore.jks"
gradle -p android :app:assembleRelease
unset SIGNING_KEYSTORE_PATH
APK=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
echo "release APK: $APK"
adb install -r "$APK"
adb shell am start -n com.vanipy.tagih/.MainActivity
sleep 6  # let the bundled page finish loading
# WebView DOM is not exposed to uiautomator's accessibility dump on the CI
# emulator, so find the page's export button by its exact CSS color: #0f5257,
# the only solid element of that color on the page (#btn-export in
# web/index.html).
pip install pillow==12.3.0 --quiet
adb exec-out screencap -p > "$RUNNER_TEMP/tagih-pre-tap.png"
TAP=$(python3 - "$RUNNER_TEMP/tagih-pre-tap.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
px = im.load()
xs, ys = [], []
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if abs(r - 15) <= 2 and abs(g - 82) <= 2 and abs(b - 87) <= 2:
            xs.append(x); ys.append(y)
if xs:
    print((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2)
PY
)
if [ -z "$TAP" ]; then
  echo "ERROR: export button (#0f5257) not found on screen; see tagih-pre-tap.png in diagnostics"
  exit 1
fi
echo "tapping export button at $TAP"
adb shell input tap $TAP
sleep 3
adb exec-out screencap -p > "$RUNNER_TEMP/tagih-runtime-1.png"
sleep 2
adb exec-out screencap -p > "$RUNNER_TEMP/tagih-runtime-2.png"
adb shell ls -l /storage/emulated/0/Download/tagih/ || true
if ! adb shell ls /storage/emulated/0/Download/tagih/ | tr -d '\r' | grep -qx 'tagih-backup-....-..-..\.json'; then
  echo "ERROR: no tagih-backup-*.json in Download/tagih after UI-driven export"
  exit 1
fi
adb uninstall com.vanipy.tagih
