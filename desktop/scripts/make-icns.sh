#!/usr/bin/env bash
#
# 把 icon.png 转成 Mac 安装包需要的 icon.icns
#
# 为什么需要这一步：Mac 的应用图标不是 png，是一种叫 icns 的专用格式。
# 转换要用 macOS 自带的两个工具（sips 缩放、iconutil 打包），
# 所以这个脚本只能在 Mac 上跑——本地是 Windows 的话，交给自动构建去做。
#
# 用法：bash scripts/make-icns.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if [ ! -f "icon.png" ]; then
  echo "✗ 找不到 icon.png，先准备一张 1024x1024 的图标"
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "✗ 这台机器没有 iconutil（Mac 自带工具），生成不了 icns"
  echo "  在 Windows / Linux 上不用管，自动构建会在 Mac 服务器上做这件事"
  exit 0
fi

# 临时目录别叫 build/ —— 那是 electron-builder 默认放资源的地方，会撞
ICONSET=".iconset-tmp"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# iconutil 认的是这套固定尺寸，缺一个都不给打包
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o icon.icns
rm -rf "$ICONSET"

echo "✓ 已生成 icon.icns ($(wc -c < icon.icns | tr -d ' ') 字节)"
