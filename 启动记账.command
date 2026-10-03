#!/bin/zsh
# 记账 · 本地 Web 版（备用启动方式，等价于桌面的「记账.app」）
# 双击本文件：起本地服务 → 开浏览器；关闭此终端窗口即停止服务。
#
# 注：日常用桌面上的「记账.app」更省事（无终端窗口、Dock 可退出）。

cd "$(dirname "$0")/web" || exit 1

echo "──────────────────────────────────────────"
echo "  记账 · 本地 Web 版"
echo "  工作目录：$(pwd)"
echo "──────────────────────────────────────────"

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ 未找到 python3（macOS 自带，若缺失请先安装）。"
  read -r "?按回车退出…"; exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "→ 未找到构建产物，尝试构建…"
  if command -v npm >/dev/null 2>&1; then
    [ -d node_modules ] || npm install --no-audit --no-fund
    npm run build || { echo "✗ 构建失败"; read -r "?按回车退出…"; exit 1; }
  else
    echo "✗ 缺少 dist 且无 npm 可用，无法构建。"
    read -r "?按回车退出…"; exit 1
  fi
fi

# 选空闲端口
PORT=""
for p in $(seq 8787 8810); do
  if ! nc -z 127.0.0.1 "$p" >/dev/null 2>&1; then PORT="$p"; break; fi
done
[ -z "$PORT" ] && PORT=8787

echo "→ 服务地址：http://127.0.0.1:$PORT"
echo "  （本窗口保持打开；关闭窗口 = 停止服务）"
echo "──────────────────────────────────────────"

python3 serve.py "$PORT" &
SERVER_PID=$!
sleep 1.2
open "http://127.0.0.1:$PORT"

trap 'kill ${SERVER_PID} 2>/dev/null; exit 0' INT TERM
wait ${SERVER_PID}
