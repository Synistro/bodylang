// Films a page in real WebKit, frame by frame on a virtual clock, so the footage is smooth however long each
// frame takes to draw. The page's requestAnimationFrame, performance.now, setTimeout and CSS animations all run
// on that clock, and each snapshot waits for its frame.
//
// usage: webkitclip URL WIDTH HEIGHT FPS LOAD_SECONDS OUTDIR SCENE.js
//
// The scene runs once the page has loaded. It sets window.__length to the film's seconds and window.__ready when it
// can start, window.__timeline(frame, seconds) runs before each frame, and whatever is in window.__film at the end
// is saved as OUTDIR/film.json. While window.__busy is set the frame waits, so a scene can rearrange the page.
import AppKit
import WebKit

let a = CommandLine.arguments
let url = URL(string: a[1])!
let w = CGFloat(Double(a[2])!), h = CGFloat(Double(a[3])!)
let fps = Double(a[4])!, load = Double(a[5])!
let out = a[6]
let scene = try! String(contentsOfFile: a[7], encoding: .utf8)
let frames = out + "/frames"
try? FileManager.default.createDirectory(atPath: frames, withIntermediateDirectories: true)

let clock = """
(() => {
  const realRAF = window.requestAnimationFrame.bind(window), realCAF = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance), realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  let manual = false, now = 0, next = 1e7;
  const queued = new Map(), timers = new Map();
  window.requestAnimationFrame = (cb) => { if (!manual) return realRAF(cb); const id = ++next; queued.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { queued.delete(id); realCAF(id); };
  performance.now = () => (manual ? now : realNow());
  window.setTimeout = (cb, ms = 0, ...args) => { if (!manual) return realST(cb, ms, ...args); const id = ++next; timers.set(id, { at: now + ms, cb, args }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); realCT(id); };
  window.__freeze = () => { now = realNow(); manual = true; };
  // Real time for the page to catch up between steps, because React commits outside the virtual clock.
  window.__settle = async (frames) => { for (let i = 0; i < frames; i++) { window.__step(1000 / 30); await new Promise((done) => realST(done, 4)); } };
  window.__step = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.cb(...timer.args); }
    const run = [...queued.values()]; queued.clear(); for (const cb of run) cb(now);
    for (const animation of document.getAnimations()) { try { animation.pause(); animation.currentTime = (animation.currentTime ?? 0) + ms; } catch {} }
  };
})();
"""

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
let config = WKWebViewConfiguration()
config.userContentController.addUserScript(WKUserScript(source: clock, injectionTime: .atDocumentStart, forMainFrameOnly: true))
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)
web.perform(Selector(("_setWindowOcclusionDetectionEnabled:")), with: false)
web.setValue(false, forKey: "drawsBackground")
window.contentView = web
window.orderBack(nil)
web.load(URLRequest(url: url))

var total = 0
let started = Date()

func fail(_ what: String, _ error: Any?) -> Never {
  print(what, error ?? "")
  exit(1)
}

func finish() {
  web.evaluateJavaScript("JSON.stringify(window.__film ?? null)") { film, error in
    if let error { fail("Could not read the film's data:", error) }
    try! (film as! String).write(toFile: out + "/film.json", atomically: true, encoding: .utf8)
    print("Filmed \(total) frames in \(Int(Date().timeIntervalSince(started))) s")
    exit(0)
  }
}

func frame(_ i: Int) {
  if i >= total { return finish() }
  let script = "window.__timeline(\(i), \(Double(i) / fps)); window.__step(\(1000.0 / fps)); 1"
  web.evaluateJavaScript(script) { _, error in
    if let error { fail("The scene failed at frame \(i):", error) }
    whenFree { snap(i) }
  }
}

// A scene sets window.__busy while it rearranges the page between frames.
func whenFree(_ then: @escaping () -> Void) {
  web.evaluateJavaScript("!!window.__busy") { busy, error in
    if let error { fail("The scene failed while busy:", error) }
    if busy as? Bool == true {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { whenFree(then) }
    } else {
      then()
    }
  }
}

func snap(_ i: Int) {
  let snapshot = WKSnapshotConfiguration()
  snapshot.afterScreenUpdates = true
  web.takeSnapshot(with: snapshot) { image, error in
    guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
      let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.97])
    else { fail("The snapshot failed at frame \(i):", error) }
    try! jpeg.write(to: URL(fileURLWithPath: String(format: "%@/f%05d.jpg", frames, i)))
    if i % 150 == 0 { print("frame", i, "of", total) }
    frame(i + 1)
  }
}

func waitForScene(_ tries: Int) {
  web.evaluateJavaScript("window.__ready ? window.__length : null") { length, _ in
    if let length = length as? Double {
      total = Int(length * fps)
      return frame(0)
    }
    if tries == 0 { fail("The scene never set window.__ready", nil) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { waitForScene(tries - 1) }
  }
}

DispatchQueue.main.asyncAfter(deadline: .now() + load) {
  web.evaluateJavaScript("window.__freeze(); \(scene); 1") { _, error in
    if let error { fail("The scene failed to start:", error) }
    waitForScene(100)
  }
}
app.run()
