# 记账

一款面向 macOS 的本地记账应用，提供 Electron 桌面版和浏览器版。账本保存在本机；应用没有账号或云端同步功能。

## 功能

- 记录收支、账户、分类、预算和资产
- 按日期、分类、账户和金额查看与筛选账单
- 查看收支汇总、趋势和分类统计
- 导出和恢复本地账本备份
- 桌面版支持快捷键、菜单栏入口和快速记账
- 网页端可独立在本地浏览器运行

## 运行网页版本

需要 Node.js 18 或更高版本。

```sh
npm --prefix web ci
npm --prefix web run dev
```

按终端提示打开本地地址。静态生产构建可运行 `npm --prefix web run build`。

## 运行 macOS 桌面版

需要 macOS 和 Node.js。桌面打包目标目前为 Apple Silicon（arm64）。

```sh
npm --prefix web ci
npm --prefix desktop ci
npm --prefix desktop run package
```

打包结果写入 `desktop/release/`，该目录属于构建产物，不纳入版本控制。

## Swift 核心验收工具

需要 Swift 5.9 或更高版本。

```sh
./scripts/build.sh verify
```

## 数据与隐私

账本只保存在本机。请勿将个人账本、导入文件或备份提交到此仓库。`.gitignore` 已排除项目中的数据目录、数据库、文档和截图；应用源代码不包含用户账本。

## 许可证

本项目采用 MIT License，详见 [LICENSE](LICENSE)。
