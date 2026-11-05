// Renders a page in WebKit in an off-screen window and saves a screenshot, without showing anything.
// usage: webkitshot URL WIDTH HEIGHT DELAY_SECONDS OUT.png [JS_BEFORE_SHOT]
import AppKit
import WebKit
let a = CommandLine.arguments
let url = URL(string: a[1])!, w = CGFloat(Double(a[2])!), h = CGFloat(Double(a[3])!), delay = Double(a[4])!, out = a[5]
let js = a.count > 6 ? a[6] : ""
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
let config = WKWebViewConfiguration()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)
web.perform(Selector(("_setWindowOcclusionDetectionEnabled:")), with: false)
web.setValue(false, forKey: "drawsBackground")
window.contentView = web
window.orderBack(nil)
web.load(URLRequest(url: url))
func shoot() {
  let c = WKSnapshotConfiguration(); c.afterScreenUpdates = true
  web.takeSnapshot(with: c) { image, error in
    if let image, let t = image.tiffRepresentation, let r = NSBitmapImageRep(data: t), let p = r.representation(using: .png, properties: [:]) {
      try? p.write(to: URL(fileURLWithPath: out)); print("saved", out, Int(image.size.width), Int(image.size.height))
    } else { print("failed", error ?? "unknown") }
    web.evaluateJavaScript("JSON.stringify({vis:document.visibilityState,w:innerWidth,h:innerHeight,errors:window.__errors||[]})") { v, _ in print(v ?? ""); exit(0) }
  }
}
DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
  if js.isEmpty { shoot() } else {
    web.evaluateJavaScript(js) { _, e in
      if let e { print("js error", e) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { shoot() }
    }
  }
}
app.run()
