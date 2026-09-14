import AppKit

// Export the existing Praelude vector mark onto an opaque iOS icon canvas.
// iOS supplies the corner mask; the asset deliberately has no baked-in rounded corners.
let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                        bytesPerRow: size * 4, space: colorSpace,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.translateBy(x: 0, y: 1024)
context.scaleBy(x: 1, y: -1)
context.setFillColor(CGColor(red: 9/255, green: 10/255, blue: 12/255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.setLineCap(.round); context.setLineJoin(.round)
let outer = CGMutablePath()
outer.move(to: CGPoint(x: 334, y: 760)); outer.addLine(to: CGPoint(x: 334, y: 264))
outer.addLine(to: CGPoint(x: 518, y: 264))
outer.addCurve(to: CGPoint(x: 748, y: 474), control1: CGPoint(x: 656, y: 264), control2: CGPoint(x: 748, y: 346))
outer.addCurve(to: CGPoint(x: 518, y: 684), control1: CGPoint(x: 748, y: 602), control2: CGPoint(x: 656, y: 684))
outer.addLine(to: CGPoint(x: 334, y: 684))
context.setStrokeColor(CGColor(red: 245/255, green: 247/255, blue: 250/255, alpha: 1))
context.setLineWidth(58); context.addPath(outer); context.strokePath()
let inner = CGMutablePath()
inner.move(to: CGPoint(x: 448, y: 382)); inner.addLine(to: CGPoint(x: 512, y: 382))
inner.addCurve(to: CGPoint(x: 614, y: 474), control1: CGPoint(x: 574, y: 382), control2: CGPoint(x: 614, y: 416))
inner.addCurve(to: CGPoint(x: 512, y: 566), control1: CGPoint(x: 614, y: 532), control2: CGPoint(x: 574, y: 566))
inner.addLine(to: CGPoint(x: 448, y: 566))
context.setStrokeColor(CGColor(red: 169/255, green: 191/255, blue: 255/255, alpha: 1))
context.setLineWidth(38); context.addPath(inner); context.strokePath()
let representation = NSBitmapImageRep(cgImage: context.makeImage()!)
let output = URL(fileURLWithPath: CommandLine.arguments[1])
try representation.representation(using: .png, properties: [:])!.write(to: output, options: .atomic)
