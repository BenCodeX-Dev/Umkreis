// Umkreis for macOS – a small native window around the existing web app.
//
// The app starts the bundled Node server on 127.0.0.1 only, waits until it answers and shows it in a
// WKWebView. Links to other sites open in the default browser; calendar files open in Calendar
// (which asks before importing anything). Built by scripts/build-mac.sh – no Xcode project needed.

import AppKit
import CoreLocation
import WebKit

/// Fixed so that the web storage (saved events, settings) belongs to the same origin on every launch.
let port: UInt16 = 52715
let origin = URL(string: "http://127.0.0.1:\(port)/")!
let minimumNode = (major: 22, minor: 18)

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate,
  WKScriptMessageHandler, CLLocationManagerDelegate
{
  private var window: NSWindow!
  private var webView: WKWebView!
  private var server: Process?
  private var serverInput: Pipe?
  private var quitting = false
  private var failed = false
  private let files = FileManager.default
  private let location = CLLocationManager()
  private var pendingLocation: [Int] = []
  private var downloads: [ObjectIdentifier: URL] = [:]

  private var supportDir: URL {
    files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Umkreis", isDirectory: true)
  }
  private var logFile: URL {
    files.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Umkreis/server.log")
  }

  // MARK: Launch

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildWindow()
    showMessage(title: "Umkreis startet …", body: "Der lokale Server wird vorbereitet.")
    location.delegate = self
    location.desiredAccuracy = kCLLocationAccuracyKilometer
    do {
      try startServer()
      waitForServer(attempt: 0)
    } catch {
      fail(error.localizedDescription)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    quitting = true
    server?.terminate()
  }

  private func startServer() throws {
    guard let app = Bundle.main.resourceURL?.appendingPathComponent("app", isDirectory: true),
      files.fileExists(atPath: app.appendingPathComponent("server/index.ts").path)
    else { throw AppError("Die App ist unvollständig: der Server fehlt im Programmpaket.") }

    guard let node = findNode() else {
      throw AppError(
        "Umkreis braucht Node.js \(minimumNode.major).\(minimumNode.minor) oder neuer, das auf diesem Mac nicht gefunden wurde. "
          + "Installiere es zum Beispiel mit „brew install node“ oder von nodejs.org und starte Umkreis dann neu.")
    }
    guard portIsFree() else {
      throw AppError(
        "Port \(port) auf 127.0.0.1 ist schon belegt – vermutlich läuft Umkreis bereits in einem Terminal. "
          + "Beende das andere Programm und starte die App neu.")
    }

    try files.createDirectory(at: supportDir, withIntermediateDirectories: true)
    try files.createDirectory(at: logFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    seedSupportFiles(from: app)
    files.createFile(atPath: logFile.path, contents: nil)
    let log = try FileHandle(forWritingTo: logFile)

    var env = ProcessInfo.processInfo.environment
    env["NODE_ENV"] = "production"
    env["HOST"] = "127.0.0.1"
    env["PORT"] = String(port)
    env["ALLOWED_HOSTS"] = "127.0.0.1:\(port),localhost:\(port)"
    env["EXIT_ON_STDIN_CLOSE"] = "1"
    env["ICS_FEEDS_FILE"] = supportDir.appendingPathComponent("feeds.json").path

    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = ["--env-file-if-exists=\(supportDir.appendingPathComponent(".env").path)", "server/index.ts"]
    p.currentDirectoryURL = app
    p.environment = env
    let input = Pipe()  // the server exits when this pipe closes, i.e. when the app goes away
    p.standardInput = input
    p.standardOutput = log
    p.standardError = log
    p.terminationHandler = { proc in
      let code = proc.terminationStatus
      Task { @MainActor in self.serverEnded(code) }
    }
    try p.run()
    server = p
    serverInput = input
  }

  private func serverEnded(_ code: Int32) {
    guard !quitting else { return }
    fail("Der lokale Server wurde unerwartet beendet (Code \(code)).")
  }

  private func waitForServer(attempt: Int) {
    var request = URLRequest(url: origin.appendingPathComponent("api/status"))
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      Task { @MainActor in
        guard !self.failed else { return }
        if ok {
          self.webView.load(URLRequest(url: origin))
        } else if attempt < 80, self.server?.isRunning == true {
          try? await Task.sleep(nanoseconds: 250_000_000)
          self.waitForServer(attempt: attempt + 1)
        } else if self.server?.isRunning == true {
          self.fail("Der lokale Server antwortet nicht.")
        }
      }
    }.resume()
  }

  /// Copies the example feed list and a short note into the data folder – never overwrites anything.
  private func seedSupportFiles(from app: URL) {
    let example = supportDir.appendingPathComponent("feeds.example.json")
    if !files.fileExists(atPath: example.path) {
      try? files.copyItem(at: app.appendingPathComponent("config/feeds.example.json"), to: example)
    }
    let note = supportDir.appendingPathComponent("LIESMICH.txt")
    if !files.fileExists(atPath: note.path) {
      let text = """
        Umkreis – Einstellungen für echte Veranstaltungsdaten

        Ohne Datenquelle zeigt Umkreis nur deutlich markierte, erfundene Beispiele.

        Ticketmaster: Lege hier eine Datei „.env“ an mit der Zeile
          TICKETMASTER_API_KEY=dein-schlüssel
        (kostenloser Schlüssel: https://developer.ticketmaster.com)

        iCal-Feeds: Kopiere „feeds.example.json“ nach „feeds.json“ und trage die
        Kalender-Adressen deiner Stadt oder Vereine ein.

        Danach Umkreis beenden und neu starten.
        """
      try? text.write(to: note, atomically: true, encoding: .utf8)
    }
  }

  // MARK: Node lookup

  private func findNode() -> String? {
    var candidates: [String] = []
    if let custom = ProcessInfo.processInfo.environment["UMKREIS_NODE"] { candidates.append(custom) }
    candidates += ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
    if let found = candidates.first(where: nodeIsUsable) { return found }
    // Version managers (nvm, fnm, volta …) only show up in a login shell.
    if let path = run("/bin/zsh", ["-lc", "command -v node"]), nodeIsUsable(path) { return path }
    return nil
  }

  private func nodeIsUsable(_ path: String) -> Bool {
    guard files.isExecutableFile(atPath: path), let v = run(path, ["--version"]) else { return false }
    let parts = v.trimmingCharacters(in: .whitespacesAndNewlines).dropFirst().split(separator: ".").compactMap { Int($0) }
    guard parts.count >= 2 else { return false }
    return parts[0] > minimumNode.major || (parts[0] == minimumNode.major && parts[1] >= minimumNode.minor)
  }

  private func run(_ tool: String, _ args: [String]) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: tool)
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { return nil }
    let s = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }

  private func portIsFree() -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { Darwin.close(fd) }
    // Same option Node uses: connections from the last run that linger in TIME_WAIT must not count as "busy",
    // only a socket that is actually listening.
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let result = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    return result == 0
  }

  // MARK: Window and messages

  private func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.applicationNameForUserAgent = "Umkreis/0.2"
    let script = WKUserScript(source: geolocationShim, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    config.userContentController.addUserScript(script)
    config.userContentController.add(self, name: "umkreisLocation")

    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = true
    webView.underPageBackgroundColor = pageColor

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Umkreis"
    window.titlebarAppearsTransparent = true  // the title bar takes the page colour instead of grey
    window.minSize = NSSize(width: 380, height: 520)
    window.backgroundColor = pageColor
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("UmkreisHauptfenster")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private let pageColor = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      ? NSColor(srgbRed: 0x29 / 255, green: 0x24 / 255, blue: 0x1f / 255, alpha: 1)
      : NSColor(srgbRed: 0xf7 / 255, green: 0xf3 / 255, blue: 0xec / 255, alpha: 1)
  }

  private func fail(_ message: String) {
    guard !failed else { return }
    failed = true
    showMessage(
      title: "Umkreis konnte nicht starten",
      body: message + "\n\nProtokoll: " + logFile.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))
  }

  private func showMessage(title: String, body: String) {
    func esc(_ s: String) -> String {
      s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\n", with: "<br>")
    }
    let html = """
      <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
      <style>
      :root{color-scheme:light dark;--bg:#f7f3ec;--ink:#2a2521;--muted:#685d53;--ring:#a1392a;--dot:#e0a52b}
      @media (prefers-color-scheme:dark){:root{--bg:#29241f;--ink:#f1e8dc;--muted:#c4b6a4;--ring:#e9b44c;--dot:#e8826b}}
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
      font:16px/1.55 -apple-system,system-ui,sans-serif}
      main{max-width:34rem;padding:2rem;text-align:center}
      h1{font:600 1.6rem/1.25 "Iowan Old Style",Georgia,serif;margin:1rem 0 .5rem}
      p{color:var(--muted);margin:0;user-select:text}
      svg{width:56px;height:56px;fill:none;stroke:var(--ring);stroke-width:1.8}
      </style>
      <main><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13"/><circle cx="16" cy="16" r="6.5" stroke-dasharray="2.2 2.2" opacity=".6"/>
      <circle cx="16" cy="16" r="2.4" fill="var(--dot)" stroke="none"/></svg>
      <h1>\(esc(title))</h1><p>\(esc(body))</p></main>
      """
    webView.loadHTMLString(html, baseURL: nil)
  }

  // MARK: Navigation – the app only ever shows its own pages

  private func isOwn(_ url: URL?) -> Bool {
    guard let url else { return false }
    return url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(port)
  }

  private func openExternally(_ url: URL) {
    guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto"].contains(scheme) else { return }
    NSWorkspace.shared.open(url)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if isOwn(url) || ["about", "blob", "data"].contains(url.scheme ?? "") { return decisionHandler(.allow) }
    openExternally(url)
    decisionHandler(.cancel)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
  ) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  /// Links with target="_blank" (event listings, map apps) go to the default browser.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url, !isOwn(url) { openExternally(url) }
    return nil
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if !failed { webView.reload() }
  }

  // MARK: Downloads – calendar files open in Calendar, which shows its own import dialog

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping @MainActor (URL?) -> Void
  ) {
    let dir = files.temporaryDirectory.appendingPathComponent("Umkreis-Kalender", isDirectory: true)
    try? files.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = (suggestedFilename as NSString).lastPathComponent
    let dest = dir.appendingPathComponent(name.isEmpty ? "veranstaltung.ics" : name)
    try? files.removeItem(at: dest)
    downloads[ObjectIdentifier(download)] = dest
    completionHandler(dest)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    if file.pathExtension.lowercased() == "ics" {
      NSWorkspace.shared.open(file)
    } else {
      NSWorkspace.shared.activateFileViewerSelecting([file])
    }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(download))
  }

  // MARK: Location – answered by Core Location at ~1 km accuracy, only when the page asks

  private let geolocationShim = """
    (() => {
      const waiting = new Map(); let next = 0;
      window.__umkreisLocation = (id, ok, a, b) => {
        const w = waiting.get(id); if (!w) return; waiting.delete(id);
        if (ok) w.ok({ coords: { latitude: a, longitude: b, accuracy: 1000, altitude: null, altitudeAccuracy: null,
          heading: null, speed: null }, timestamp: Date.now() });
        else w.err({ code: a, message: b, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      };
      const geo = {
        getCurrentPosition(ok, err) {
          const id = ++next; waiting.set(id, { ok, err: err || (() => {}) });
          window.webkit.messageHandlers.umkreisLocation.postMessage(id);
        },
        watchPosition() { return 0; },
        clearWatch() {},
      };
      Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    })();
    """

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "umkreisLocation", isOwn(message.frameInfo.request.url), let id = message.body as? Int else { return }
    pendingLocation.append(id)
    guard CLLocationManager.locationServicesEnabled() else {
      return answerLocation(error: 2, "Ortungsdienste sind auf diesem Mac ausgeschaltet.")
    }
    switch location.authorizationStatus {
    case .notDetermined: location.requestWhenInUseAuthorization()
    case .denied, .restricted: answerLocation(error: 1, "Standortzugriff nicht erlaubt.")
    default: location.requestLocation()
    }
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    MainActor.assumeIsolated {
      guard !pendingLocation.isEmpty else { return }
      switch location.authorizationStatus {
      case .notDetermined: return
      case .denied, .restricted: answerLocation(error: 1, "Standortzugriff nicht erlaubt.")
      default: location.requestLocation()
      }
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let c = locations.last?.coordinate else { return }
    MainActor.assumeIsolated { answerLocation(lat: c.latitude, lon: c.longitude) }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let denied = (error as? CLError)?.code == .denied
    MainActor.assumeIsolated {
      answerLocation(error: denied ? 1 : 2, denied ? "Standortzugriff nicht erlaubt." : "Standort nicht verfügbar.")
    }
  }

  private func answerLocation(lat: Double? = nil, lon: Double? = nil, error: Int = 0, _ message: String = "") {
    let ids = pendingLocation
    pendingLocation.removeAll()
    for id in ids {
      let js =
        if let lat, let lon { "window.__umkreisLocation?.(\(id), true, \(lat), \(lon))" } else {
          "window.__umkreisLocation?.(\(id), false, \(error), \"\(message)\")"
        }
      webView.evaluateJavaScript(js)
    }
  }

  // MARK: Menu

  private func buildMenu() {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      item.submenu = menu
      main.addItem(item)
    }
    func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      return i
    }
    let appItems: [NSMenuItem] = [
      item("Über Umkreis", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Datenordner im Finder zeigen", #selector(showDataFolder)),
      item("Server-Protokoll zeigen", #selector(showLog)),
      .separator(),
      item("Umkreis ausblenden", #selector(NSApplication.hide(_:)), "h"),
      item("Andere ausblenden", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Alle einblenden", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Umkreis beenden", #selector(NSApplication.terminate(_:)), "q"),
    ]
    submenu("Umkreis", appItems)
    submenu(
      "Bearbeiten",
      [
        item("Widerrufen", Selector(("undo:")), "z"),
        item("Wiederholen", Selector(("redo:")), "z", [.command, .shift]),
        .separator(),
        item("Ausschneiden", #selector(NSText.cut(_:)), "x"),
        item("Kopieren", #selector(NSText.copy(_:)), "c"),
        item("Einsetzen", #selector(NSText.paste(_:)), "v"),
        item("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
      ])
    submenu(
      "Darstellung",
      [
        item("Neu laden", #selector(reloadPage), "r"),
        .separator(),
        item("Größer", #selector(zoomIn), "+"),
        item("Kleiner", #selector(zoomOut), "-"),
        item("Originalgröße", #selector(zoomReset), "0"),
        .separator(),
        item("Vollbild", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
      ])
    let windowItems: [NSMenuItem] = [
      item("Im Dock ablegen", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoomen", #selector(NSWindow.performZoom(_:))),
      item("Fenster schließen", #selector(NSWindow.performClose(_:)), "w"),
    ]
    submenu("Fenster", windowItems)
    NSApp.mainMenu = main
    NSApp.windowsMenu = main.items.last?.submenu
  }

  @objc private func reloadPage() {
    if failed { return }
    if isOwn(webView.url) { webView.reload() } else { webView.load(URLRequest(url: origin)) }
  }
  @objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2) }
  @objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
  @objc private func zoomReset() { webView.pageZoom = 1 }
  @objc private func showDataFolder() {
    try? files.createDirectory(at: supportDir, withIntermediateDirectories: true)
    NSWorkspace.shared.open(supportDir)
  }
  @objc private func showLog() {
    if files.fileExists(atPath: logFile.path) { NSWorkspace.shared.activateFileViewerSelecting([logFile]) }
  }
}

struct AppError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  let delegate = AppDelegate()
  app.delegate = delegate
  app.setActivationPolicy(.regular)
  app.run()
}
