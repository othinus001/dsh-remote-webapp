#!/usr/bin/env bash
# 在 JVM 上冒烟测试（不需要模拟器/手机）：
#  - 离线用例：皮肤注入、同源/缓存判定、资源解析、缓存读写（总是跑）
#  - 联网用例：token → 303 → cookie → 首屏 HTML → 取资源 → 落盘 → 断网回放
#    需要自备地址：DSH_TEST_URL="https://你的域名/?token=xxxx" bash tools/jvm-check/run.sh
#
# 用和 build.sh 同一套工具链（解析顺序也一致：ANDROID_TOOLCHAIN → ./toolchain → ../tools/android）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TOOLCHAIN="${ANDROID_TOOLCHAIN:-}"
if [ -z "$TOOLCHAIN" ]; then
  if [ -d "$ROOT/toolchain" ]; then TOOLCHAIN="$ROOT/toolchain"; else TOOLCHAIN="$ROOT/../tools/android"; fi
fi
JDK_HOME="$(ls -d "$TOOLCHAIN"/jdk/jdk-* 2>/dev/null | head -1)"
JDK_HOME="${JDK_HOME%/}"
if [ ! -e "$JDK_HOME/bin/javac.exe" ]; then
  echo "找不到 JDK：$JDK_HOME" >&2
  echo "先 bash tools/fetch-toolchain.sh，或 export ANDROID_TOOLCHAIN=/path/to/toolchain" >&2
  exit 1
fi

OUT="$ROOT/build/jvm-check"
rm -rf "$OUT"
mkdir -p "$OUT"


"$JDK_HOME/bin/javac.exe" -encoding UTF-8 -nowarn -d "$OUT" \
  $(find tools/jvm-check/stubs -name '*.java') \
  tools/jvm-check/Check.java \
  src/com/dsh/shell/Fetch.java \
  src/com/dsh/shell/AssetCache.java \
  src/com/dsh/shell/Preloader.java \
  src/com/dsh/shell/Web.java \
  src/com/dsh/shell/Policy.java \

"$JDK_HOME/bin/java.exe" -cp "$OUT" com.dsh.shell.Check
