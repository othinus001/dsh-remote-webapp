#!/usr/bin/env bash
# 手工构建 DSH 安卓外壳 APK（不用 Gradle、不引第三方库）。
#
# 依赖（三选一）：
#   1. bash tools/fetch-toolchain.sh          # 自动下载到 ./toolchain
#   2. ANDROID_TOOLCHAIN=/path/to/toolchain   # 用已有的
#   3. 默认会先看 ./toolchain，再看 ../tools/android
#
# 用法：
#   cp local.properties.example local.properties   # 填你的域名和登录令牌
#   bash build.sh                                  # -> out/dsh-shell.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ---- 工具链 ----
TOOLCHAIN="${ANDROID_TOOLCHAIN:-}"
if [ -z "$TOOLCHAIN" ]; then
  if [ -d "$ROOT/toolchain" ]; then
    TOOLCHAIN="$ROOT/toolchain"
  else
    TOOLCHAIN="$ROOT/../tools/android"
  fi
fi
JDK_HOME="$(ls -d "$TOOLCHAIN"/jdk/jdk-* 2>/dev/null | head -1)"
JDK_HOME="${JDK_HOME%/}"
BUILD_TOOLS="$(ls -d "$TOOLCHAIN"/build-tools/*/ 2>/dev/null | head -1)"
BUILD_TOOLS="${BUILD_TOOLS%/}"
PLATFORM_DIR="$(ls -d "$TOOLCHAIN"/platform/*/ 2>/dev/null | head -1)"
PLATFORM_DIR="${PLATFORM_DIR%/}"
ANDROID_JAR="$PLATFORM_DIR/android.jar"

missing=0
for f in "$JDK_HOME/bin/javac.exe" "$BUILD_TOOLS/aapt2.exe" "$ANDROID_JAR"; do
  [ -e "$f" ] || { echo "缺少构建组件: ${f:-<空>}" >&2; missing=1; }
done
if [ "$missing" = 1 ]; then
  cat >&2 <<'EOF'

工具链没找到。任选一种：
  bash tools/fetch-toolchain.sh                 # 下载到 ./toolchain（约 300 MB，国内镜像）
  export ANDROID_TOOLCHAIN=/path/to/toolchain   # 指向已有的 {jdk,build-tools,platform}
EOF
  exit 1
fi

# ---- Python（只用来把 classes.dex 塞进 apk） ----
if [ -z "${PYTHON:-}" ]; then
  for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then PYTHON="$(command -v "$cand")"; break; fi
  done
fi
if [ -z "${PYTHON:-}" ]; then
  echo "找不到 python（第 5 步要把 classes.dex 追加进 apk）。用 PYTHON=/path/to/python 指定。" >&2
  exit 1
fi

export JAVA_HOME="$JDK_HOME"
export PATH="$JDK_HOME/bin:$BUILD_TOOLS:$PATH"

MIN_SDK=24
TARGET_SDK=34

cd "$ROOT"

# 版本号以 AndroidManifest.xml 为准（aapt2 的 --version-* 会被 manifest 覆盖，这里只是保持一致）
VC="$(grep -o 'android:versionCode="[0-9]*"' AndroidManifest.xml | head -1 | grep -o '[0-9]*' || true)"
VN="$(grep -o 'android:versionName="[^"]*"' AndroidManifest.xml | head -1 | sed 's/.*="//; s/"$//' || true)"
VC="${VC:-1}"; VN="${VN:-1.0}"

BUILD="build"
OUT="out"
KEYSTORE_DIR="keystore"
KEYSTORE="$KEYSTORE_DIR/dsh.keystore"
KS_PASS="${KS_PASS:-dshshell}"
KS_ALIAS="${KS_ALIAS:-dsh}"

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$OUT" "$KEYSTORE_DIR"

echo "== 工具链 =="
echo "   JDK         $JDK_HOME"
echo "   build-tools $BUILD_TOOLS"
echo "   platform    $PLATFORM_DIR"
echo "   版本        versionCode $VC / versionName $VN"


echo "== 1/7 编译资源 =="
"$BUILD_TOOLS/aapt2.exe" compile --dir res -o "$BUILD/res.zip"

echo "== 2/7 链接资源与清单 =="
"$BUILD_TOOLS/aapt2.exe" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  "$BUILD/res.zip" \
  --java "$BUILD/gen" \
  -A assets \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VC" \
  --version-name "$VN" \
  --no-version-vectors

echo "== 3/7 编译 Java =="
find src -name '*.java' > "$BUILD/sources.txt"
"$JDK_HOME/bin/javac.exe" -encoding UTF-8 --release 8 -nowarn \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

echo "== 4/7 dex =="
"$BUILD_TOOLS/d8.bat" --release --min-api "$MIN_SDK" \
  --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" \
  $(find "$BUILD/classes" -name '*.class')

echo "== 5/7 打包 dex 进 APK =="
"$PYTHON" - \
  "$BUILD/base.apk" "$BUILD/dex/classes.dex" "$BUILD/unsigned.apk" <<'PY'
import sys, zipfile, shutil
src, dex, dst = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.copyfile(src, dst)
with zipfile.ZipFile(dst, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
print("packed", dst)
PY

echo "== 6/7 对齐 =="
"$BUILD_TOOLS/zipalign.exe" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "== 7/7 签名 =="
if [ ! -f "$KEYSTORE" ]; then
  echo "生成签名证书（自签，口令 $KS_PASS）"
  "$JDK_HOME/bin/keytool.exe" -genkeypair \
    -keystore "$KEYSTORE" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=DSH Shell, O=DSH, C=CN" >/dev/null 2>&1
fi
APK="$OUT/dsh-shell.apk"
"$BUILD_TOOLS/apksigner.bat" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version "$MIN_SDK" \
  --out "$APK" "$BUILD/aligned.apk"
"$BUILD_TOOLS/apksigner.bat" verify --print-certs "$APK" | head -5

ls -l "$APK"
echo "完成: $APK"
