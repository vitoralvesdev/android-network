#!/usr/bin/env bash
set -euo pipefail

SDK="${ANDROID_SDK_ROOT:-/c/Users/vitor/AppData/Local/Android/Sdk}"
BT="$SDK/build-tools/35.0.1"
PLATFORM="$SDK/platforms/android-35/android.jar"
JDK="/c/Program Files/Java/jdk-23/bin"
OUT="build"

cd "$(dirname "$0")"
rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/classes" "$OUT/dex" "$OUT/gen"

"$BT/aapt2.exe" compile --dir res -o "$OUT/res/compiled.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$PLATFORM" \
  --manifest AndroidManifest.xml --java "$OUT/gen" --auto-add-overlay \
  -R "$OUT/res/compiled.zip" --min-sdk-version 26 --target-sdk-version 29

SOURCES=$(find src "$OUT/gen" -name '*.java')
javac --release 11 -classpath "$PLATFORM" -d "$OUT/classes" $SOURCES

CLASSES=$(find "$OUT/classes" -name '*.class')
"$BT/d8.bat" --lib "$PLATFORM" --min-api 26 --output "$OUT/dex" $CLASSES

cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && "$JDK/jar.exe" uf ../unsigned.apk classes.dex)

"$BT/zipalign.exe" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

"$BT/apksigner.bat" sign --ks ../debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out hello.apk "$OUT/aligned.apk"

"$BT/apksigner.bat" verify --print-certs hello.apk | head -4
ls -l hello.apk
