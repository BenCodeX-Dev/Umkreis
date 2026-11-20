// Renders the Umkreis app icon (1024 × 1024 PNG) with Core Graphics – no image assets needed.
// Usage: swift mac/make-icon.swift <out.png>
// The mark is the same as the favicon: an outer ring, a dashed inner circle (the search radius) and a dot.

import AppKit

let out = CommandLine.arguments.dropFirst().first ?? "icon.png"
let size = 1024
let rgb = CGColorSpace(name: CGColorSpace.sRGB)!
guard
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: rgb,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("no context") }

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(
    srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255,
    alpha: a)
}

// macOS icon grid: 824 pt body centred in 1024, corner radius ≈ 185, soft drop shadow.
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.28))
ctx.addPath(shape)
ctx.setFillColor(color(0x8a2f22))
ctx.fillPath()
ctx.restoreGState()

// Falu red body with a gentle top-lit gradient.
ctx.saveGState()
ctx.addPath(shape)
ctx.clip()
let body_gradient = CGGradient(
  colorsSpace: rgb, colors: [color(0xbd4a35), color(0xa1392a), color(0x7f2a1f)] as CFArray, locations: [0, 0.55, 1])!
ctx.drawLinearGradient(body_gradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

// Fine horizontal grain, like brushed paint on wood – barely visible.
for i in stride(from: 0, to: 824, by: 6) {
  let y = 100 + CGFloat(i)
  let wobble = sin(CGFloat(i) * 0.137) * 0.5 + 0.5
  ctx.setStrokeColor(color(0xffffff, 0.018 + 0.02 * wobble))
  ctx.setLineWidth(1.4)
  ctx.move(to: CGPoint(x: 100, y: y))
  ctx.addCurve(
    to: CGPoint(x: 924, y: y + 6 * wobble), control1: CGPoint(x: 380, y: y - 5 * wobble),
    control2: CGPoint(x: 640, y: y + 8 * wobble))
  ctx.strokePath()
}

// Soft highlight along the top edge.
let sheen = CGGradient(colorsSpace: rgb, colors: [color(0xffffff, 0.16), color(0xffffff, 0)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 700), options: [])
ctx.restoreGState()

// Inner hairline in wood tone, like an inlaid border.
ctx.addPath(CGPath(roundedRect: body.insetBy(dx: 26, dy: 26), cornerWidth: 162, cornerHeight: 162, transform: nil))
ctx.setStrokeColor(color(0xd4bb93, 0.35))
ctx.setLineWidth(4)
ctx.strokePath()

// The mark, scaled from the 32-unit favicon grid: 1 unit = 16 px.
let c = CGPoint(x: 512, y: 512)
let u: CGFloat = 16
ctx.setLineCap(.round)

ctx.addEllipse(in: CGRect(x: c.x - 13 * u, y: c.y - 13 * u, width: 26 * u, height: 26 * u))
ctx.setStrokeColor(color(0xf7f3ec))
ctx.setLineWidth(2.6 * u)
ctx.strokePath()

ctx.saveGState()
ctx.setLineDash(phase: 0, lengths: [2.2 * u, 2.0 * u])
ctx.setLineCap(.butt)
ctx.addEllipse(in: CGRect(x: c.x - 6.5 * u, y: c.y - 6.5 * u, width: 13 * u, height: 13 * u))
ctx.setStrokeColor(color(0xd4bb93))
ctx.setLineWidth(1.9 * u)
ctx.strokePath()
ctx.restoreGState()

ctx.addEllipse(in: CGRect(x: c.x - 2.6 * u, y: c.y - 2.6 * u, width: 5.2 * u, height: 5.2 * u))
ctx.setFillColor(color(0xe0a52b))
ctx.fillPath()

guard let image = ctx.makeImage(),
  let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
else { fatalError("could not encode PNG") }
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
