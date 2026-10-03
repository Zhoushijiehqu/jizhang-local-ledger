#!/bin/zsh
# 记账 · 构建与验收脚本
# 用法：
#   ./scripts/build.sh          构建内核
#   ./scripts/build.sh verify   构建并跑验收（69 项断言）
set -e
cd "$(dirname "$0")/../JiZhang"
echo "── 工作目录：$(pwd)"

# 本机沙箱策略限制 SwiftPM 的 sandbox-exec，故统一加 --disable-sandbox
swift build --disable-sandbox

case "${1:-}" in
  verify)
    swift run --disable-sandbox jizhang-verify
    ;;
  run)
    swift run --disable-sandbox jizhang-verify
    ;;
  *)
    echo "── 构建完成。可用参数：verify"
    ;;
esac
