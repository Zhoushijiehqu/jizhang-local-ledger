#!/bin/zsh
# 构建「记账.app」桌面启动器（原生 Mach-O）
# 用法：./launcher/build.sh
#
# 说明：macOS 对"可执行文件是脚本"的 app bundle 支持不稳定（实测双击无反应），
# 因此启动器编译为真正的 Mach-O 可执行文件，形态为菜单栏小工具。

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HOME/Desktop/记账.app}"
SRC="$ROOT/launcher/main.swift"
BIN="$APP/Contents/MacOS/launcher"
if [ -f "$APP/Contents/Resources/app.asar" ]; then
  echo "此入口已升级为 Electron 桌面版。请使用 npm --prefix desktop run package 构建。"
  exit 1
fi

echo "项目根目录：$ROOT"
echo "目标 app：$APP"

# 1) 目录骨架
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 2) 图标（若资源里已有 AppIcon.icns 则跳过）
if [ ! -f "$APP/Contents/Resources/AppIcon.icns" ]; then
  echo "→ 生成图标…"
  TMP="$(mktemp -d)"
  PY="${PYTHON:-python3}"
  "$PY" - "$TMP" << 'PYEOF'
import sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.224), fill=(47, 124, 246, 255))
d.rounded_rectangle([0, int(S * 0.72), S - 1, S - 1], radius=int(S * 0.224), fill=(38, 105, 214, 255))
d.rectangle([0, int(S * 0.72), S - 1, int(S * 0.80)], fill=(38, 105, 214, 255))
font = None
for p in ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
    try:
        font = ImageFont.truetype(p, int(S * 0.56)); break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()
bbox = d.textbbox((0, 0), "¥", font=font)
d.text(((S - (bbox[2] - bbox[0])) / 2 - bbox[0], (S - (bbox[3] - bbox[1])) / 2 - bbox[1] - S * 0.03),
       "¥", font=font, fill=(255, 255, 255, 255))
import os
iconset = os.path.join(out, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
for name, s in {"icon_16x16.png": 16, "icon_16x16@2x.png": 32, "icon_32x32.png": 32,
                "icon_32x32@2x.png": 64, "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
                "icon_256x256.png": 256, "icon_256x256@2x.png": 512, "icon_512x512.png": 512,
                "icon_512x512@2x.png": 1024}.items():
    img.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, name))
print(iconset)
PYEOF
  ICONSET="$(ls -d "$TMP"/icon.iconset)"
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$TMP"
fi

# 3) Info.plist
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>记账</string>
	<key>CFBundleDisplayName</key><string>记账</string>
	<key>CFBundleIdentifier</key><string>app.jizhang.local.launcher</string>
	<key>CFBundleExecutable</key><string>launcher</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>LSMinimumSystemVersion</key><string>12.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHighResolutionCapable</key><true/>
	<key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
</dict>
</plist>
PLIST

# 3.5) 先构建最新网页，再打进 App 内部（应用启动后读取 ~/Desktop 会受权限限制，
#      打进 bundle 后既免权限问题，也让 App 可以随意移动）
echo "→ 构建最新网页…"
npm --prefix "$ROOT/web" run build
DIST="$ROOT/web/dist"
if [ ! -f "$DIST/index.html" ]; then
  echo "✗ 找不到 $DIST/index.html，请先在 web 目录执行 npm run build"
  exit 1
fi
echo "→ 打包网页产物到 App 内（Contents/Resources/web）…"
WEB="$APP/Contents/Resources/web"
mkdir -p "$WEB/assets"
# 先放新资源，最后替换入口；旧资源留给已打开的浏览器标签页使用。
cp -R "$DIST/assets/." "$WEB/assets/"
cp "$DIST/index.html" "$WEB/index.html.next"
mv -f "$WEB/index.html.next" "$WEB/index.html"
echo "  最新网页与资源已放入 App"

# 4) 编译原生可执行文件
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
  echo "→ 编译 launcher（Mach-O）…"
  swiftc -O -sdk "$(xcrun --show-sdk-path)" \
    -target "$(uname -m)-apple-macosx12.0" \
    -framework AppKit \
    "$SRC" -o "$BIN"
else
  echo "→ 原生启动器无需重编译"
fi

chmod +x "$BIN"
xattr -cr "$APP" 2>/dev/null || true

# 5) 让 LaunchServices 立即认识它
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREG" ] && "$LSREG" -f "$APP" 2>/dev/null || true

echo "→ 完成：$APP"
file "$BIN" | sed 's/^/  /'
