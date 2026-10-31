#!/usr/bin/env bash
# 下载手工构建 APK 所需的最小工具链（不用 Android Studio / Gradle）。
# 默认装到 <项目>/toolchain/，也可以传参指定目录。
#   bash tools/fetch-toolchain.sh              # -> ./toolchain
#   bash tools/fetch-toolchain.sh D:/sdk-tools # -> D:/sdk-tools
# 全部走国内可直连镜像，逐个 URL 回退；zip 校验失败自动换下一个。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HERE/../toolchain}"
mkdir -p "$DEST/dl"
cd "$DEST/dl"

fetch() { # $1=目标文件，其余=候选 URL
  local out="$1"; shift
  if [ -s "$out" ] && unzip -tq "$out" >/dev/null 2>&1; then
    echo "[skip] $out 已存在且完整"; return 0
  fi
  rm -f "$out"
  local u
  for u in "$@"; do
    echo "[get ] $out <- $u"
    if curl -L --retry 2 --retry-delay 2 -m 1800 -o "$out.part" "$u" 2>/dev/null && [ -s "$out.part" ]; then
      if unzip -tq "$out.part" >/dev/null 2>&1; then
        mv "$out.part" "$out"; echo "[ ok] $out $(stat -c%s "$out") bytes"; return 0
      fi
      echo "[bad] zip 校验失败：$u"
    else
      echo "[bad] 下载失败：$u"
    fi
    rm -f "$out.part"
  done
  echo "[FAIL] $out"; return 1
}

JDK_URLS=(
  "https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip"
  "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip"
  "https://mirrors.cloud.tencent.com/AdoptOpenJDK/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.9_9.zip"
  "https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip"
)
BT_URLS=(
  "https://dl.google.com/android/repository/build-tools_r34-windows.zip"
  "https://mirrors.cloud.tencent.com/AndroidSDK/build-tools_r34-windows.zip"
)
PF_URLS=(
  "https://dl.google.com/android/repository/platform-34_r03.zip"
  "https://dl.google.com/android/repository/platform-34-ext7_r02.zip"
  "https://mirrors.cloud.tencent.com/AndroidSDK/platform-34_r03.zip"
)

fetch jdk17.zip       "${JDK_URLS[@]}" || exit 2
fetch build-tools.zip "${BT_URLS[@]}"  || exit 3
fetch platform-34.zip "${PF_URLS[@]}"  || exit 4

echo "== unzip"
cd "$DEST"
rm -rf jdk build-tools platform
mkdir -p jdk build-tools platform
unzip -q dl/jdk17.zip       -d jdk         || exit 5
unzip -q dl/build-tools.zip -d build-tools || exit 6
unzip -q dl/platform-34.zip -d platform    || exit 7

echo "== layout"
ls jdk; ls build-tools; ls platform
echo "DONE -> $DEST"
