// 记账 · 桌面启动器（原生 Mach-O + 内建静态服务器）
//
// 设计要点（都是踩坑换来的）：
//  1) 必须编译成 Mach-O：脚本型 .app 在现代 macOS 上双击无反应（实测对照验证）
//  2) 必须实现 applicationShouldHandleReopen：否则应用已在运行时再次双击毫无反应
//  3) 自带 HTTP 服务：早期版本拉起 python3 起服务，但应用被 LaunchServices 启动后
//     读取 ~/Desktop 下的项目目录受权限限制，服务起不来；改成把网页产物打进
//     App 内部（Contents/Resources/web）、由 Swift 自己提供 HTTP，彻底免依赖：
//     · 不需要 python / node
//     · 不需要外部路径（文件夹随便移动）
//     · 不联网（只监听 127.0.0.1）
//
// 数据仍存在浏览器本地（IndexedDB），本程序只负责把静态页面送出去。

import AppKit
import Foundation
import Network

// ── 配置
let launcherLog = "/tmp/jizhang_launcher.log"
let urlFile = "/tmp/jizhang_url.txt"
let freshFlag = "/tmp/jizhang_fresh.flag"
/// 开发用：可通过 JIZHANG_WEB_DIST 指定网页构建目录，默认使用当前目录下的 web/dist
let devDistPath = ProcessInfo.processInfo.environment["JIZHANG_WEB_DIST"] ?? "web/dist"

func trace(_ message: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    let line = "[\(stamp)] \(message)\n"
    if let handle = FileHandle(forWritingAtPath: launcherLog) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? line.write(toFile: launcherLog, atomically: true, encoding: .utf8)
    }
}

// ══════════════════════════════════════════════════════════════
// MARK: - 极简静态 HTTP 服务器（仅 GET，够用且无依赖）
// ══════════════════════════════════════════════════════════════

final class StaticServer {
    private let root: URL
    private let queue = DispatchQueue(label: "jizhang.server", attributes: .concurrent)
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "wasm": "application/wasm",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "map": "application/json",
        "txt": "text/plain; charset=utf-8"
    ]

    init(root: URL) {
        self.root = root
    }

    /// 从 startPort 起找一个能绑定的端口
    func start(startPort: UInt16 = 8787, attempts: Int = 24) throws {
        var lastError: Error?
        for offset in 0..<attempts {
            let candidate = startPort + UInt16(offset)
            do {
                try bind(candidate)
                port = candidate
                trace("静态服务已启动：http://127.0.0.1:\(candidate) 根目录=\(root.path)")
                return
            } catch {
                lastError = error
            }
        }
        throw lastError ?? NSError(domain: "jizhang", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "没有可用端口"])
    }

    private func bind(_ candidate: UInt16) throws {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        guard let nwPort = NWEndpoint.Port(rawValue: candidate) else {
            throw NSError(domain: "jizhang", code: 2, userInfo: [NSLocalizedDescriptionKey: "端口非法"])
        }
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
        l.stateUpdateHandler = { state in
            if case .failed(let e) = state { trace("监听失败：\(e)") }
        }
        l.start(queue: queue)
        // NWListener 是异步就绪的，这里同步等一小会儿
        var waited = 0
        while l.state != .ready && waited < 40 {
            usleep(50_000)
            waited += 1
            if case .failed = l.state { break }
        }
        if l.state != .ready {
            l.cancel()
            throw NSError(domain: "jizhang", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "端口 \(candidate) 未就绪"])
        }
        listener = l
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: 请求处理

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let d = data { buf.append(d) }
            let marker = Data("\r\n\r\n".utf8)
            if let r = buf.range(of: marker) {
                let head = String(decoding: buf[..<r.lowerBound], as: UTF8.self)
                self.respond(conn, head: head)
            } else if isComplete || error != nil || buf.count > 64 * 1024 {
                conn.cancel()
            } else {
                self.receive(conn, buffer: buf)
            }
        }
    }

    private func respond(_ conn: NWConnection, head: String) {
        guard let requestLine = head.split(separator: "\r\n").first else { conn.cancel(); return }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { conn.cancel(); return }
        let method = String(parts[0])
        guard method == "GET" || method == "HEAD" else {
            send(conn, status: 405, mime: "text/plain; charset=utf-8",
                 body: Data("Method Not Allowed".utf8), headOnly: false)
            return
        }

        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path.isEmpty || path == "/" { path = "/index.html" }

        // 防目录穿越：标准化后必须仍在 root 之下
        let cleaned = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let candidate = root.appendingPathComponent(cleaned).standardizedFileURL
        guard candidate.path.hasPrefix(root.standardizedFileURL.path) else {
            send(conn, status: 403, mime: "text/plain; charset=utf-8",
                 body: Data("Forbidden".utf8), headOnly: false)
            return
        }

        var isDir: ObjCBool = false
        var fileURL = candidate
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
            fileURL = candidate.appendingPathComponent("index.html")
        }

        guard let body = try? Data(contentsOf: fileURL) else {
            send(conn, status: 404, mime: "text/plain; charset=utf-8",
                 body: Data("Not Found: \(cleaned)".utf8), headOnly: method == "HEAD")
            return
        }
        let ext = fileURL.pathExtension.lowercased()
        let type = StaticServer.mime[ext] ?? "application/octet-stream"
        send(conn, status: 200, mime: type, body: body, headOnly: method == "HEAD")
    }

    private func send(_ conn: NWConnection, status: Int, mime: String, body: Data, headOnly: Bool) {
        let reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 403 ? "Forbidden" : "Error"
        var header = "HTTP/1.1 \(status) \(reason)\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Cache-Control: no-store\r\n"
        header += "Connection: close\r\n\r\n"
        var out = Data(header.utf8)
        if !headOnly { out.append(body) }
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }
}

// ══════════════════════════════════════════════════════════════
// MARK: - 应用
// ══════════════════════════════════════════════════════════════

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: StaticServer?
    private var statusItem: NSStatusItem?
    private var baseURL = ""
    private var statusLine = "未启动"

    func applicationDidFinishLaunching(_ notification: Notification) {
        trace("启动应用（首次）")
        setupStatusItem()
        startServer()
    }

    /// 应用已在运行时再次双击 → macOS 只发"重新打开"事件，必须实现，否则双击毫无反应
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        trace("重新打开（应用已在运行）")
        if baseURL.isEmpty {
            startServer()
        } else {
            openBrowser()
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        trace("退出应用")
        server?.stop()
        try? FileManager.default.removeItem(atPath: urlFile)
    }

    // MARK: 菜单栏

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "¥"
        item.button?.toolTip = "记账 · 本地 Web 版"
        let menu = NSMenu()

        func add(_ title: String, _ sel: Selector, _ key: String = "") {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            i.target = self
            menu.addItem(i)
        }
        add("打开记账", #selector(menuOpen), "o")
        add("重启网页服务", #selector(menuRestart), "r")
        menu.addItem(.separator())
        add("打开网页文件目录", #selector(menuOpenFolder))
        add("查看启动日志", #selector(menuOpenLog))
        menu.addItem(.separator())
        let info = NSMenuItem(title: "数据存在浏览器本地，不联网", action: nil, keyEquivalent: "")
        info.isEnabled = false
        menu.addItem(info)
        add("退出记账", #selector(menuQuit), "q")

        item.menu = menu
        statusItem = item
        updateTooltip()
    }

    private func updateTooltip() {
        statusItem?.button?.toolTip = "记账 · \(statusLine)"
    }

    @objc private func menuOpen() { openBrowser() }
    @objc private func menuRestart() { server?.stop(); server = nil; startServer() }
    @objc private func menuOpenFolder() { NSWorkspace.shared.open(webRoot) }
    @objc private func menuOpenLog() { NSWorkspace.shared.open(URL(fileURLWithPath: launcherLog)) }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    // MARK: 服务

    /// 网页产物目录：优先 App 内自带（Contents/Resources/web），否则回退开发目录
    private var webRoot: URL {
        if let res = Bundle.main.resourceURL {
            let bundled = res.appendingPathComponent("web")
            if FileManager.default.fileExists(atPath: bundled.appendingPathComponent("index.html").path) {
                return bundled
            }
        }
        return URL(fileURLWithPath: devDistPath)
    }

    private func startServer() {
        let root = webRoot
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            alert("找不到网页产物。\n\nApp 内应包含 Contents/Resources/web/index.html\n请重新运行 launcher/build.sh 打包。")
            statusLine = "缺少网页产物"
            updateTooltip()
            return
        }

        let s = StaticServer(root: root)
        do {
            try s.start()
        } catch {
            trace("启动静态服务失败：\(error.localizedDescription)")
            alert("启动本地服务失败：\n\(error.localizedDescription)")
            statusLine = "启动失败"
            updateTooltip()
            return
        }

        server = s
        baseURL = "http://127.0.0.1:\(s.port)"
        try? baseURL.write(toFile: urlFile, atomically: true, encoding: .utf8)
        statusLine = "运行中 :\(s.port)"
        updateTooltip()

        // 等就绪后再开浏览器（最多 4 秒）
        for _ in 0..<40 {
            if reachable(baseURL) { break }
            usleep(100_000)
        }
        trace("服务就绪：\(baseURL)（\(reachable(baseURL) ? "探测通过" : "探测未通过，仍尝试打开")）")
        openBrowser()
    }

    private func openBrowser() {
        guard !baseURL.isEmpty else { return }
        var target = baseURL
        if FileManager.default.fileExists(atPath: freshFlag) {
            target += "/?fresh=1"
            try? FileManager.default.removeItem(atPath: freshFlag)
            trace("带 fresh=1 打开（清空数据）")
        }
        guard let u = URL(string: target) else { return }
        NSWorkspace.shared.open(u)
    }

    private func reachable(_ target: String) -> Bool {
        guard let u = URL(string: target) else { return false }
        var request = URLRequest(url: u)
        request.timeoutInterval = 1.5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]   // 直连本机，绕开系统代理
        URLSession(configuration: cfg).dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, http.statusCode == 200 { ok = true }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 2.5)
        return ok
    }

    private func alert(_ message: String) {
        DispatchQueue.main.async {
            let a = NSAlert()
            a.messageText = "记账"
            a.informativeText = message
            a.alertStyle = .warning
            a.addButton(withTitle: "好")
            a.runModal()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
signal(SIGTERM) { _ in NSApp.terminate(nil) }
signal(SIGINT) { _ in NSApp.terminate(nil) }
app.run()
