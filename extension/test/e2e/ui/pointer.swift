// Moves the system pointer for the screencast: avfoundation records it although ffmpeg is told not to.
//   pointer to <x> <y>    moves it to a global point (points, origin at the top left of the main display)
//   pointer away <x> <y>  moves it to the centre of a display that does not contain that point, or
//                         without one to the right edge of the display that does: the arrow hangs
//                         right of its tip, so only the tip's column stays on screen (no hot
//                         corner, Dock or menu bar there)
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let x = Double(args[2]), let y = Double(args[3]) else {
    FileHandle.standardError.write("usage: pointer to|away <x> <y>\n".data(using: .utf8)!)
    exit(2)
}
let point = CGPoint(x: x, y: y)

switch args[1] {
case "to":
    CGWarpMouseCursorPosition(point)
case "away":
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetActiveDisplayList(16, &ids, &count)
    let displays = ids.prefix(Int(count))
    if let other = displays.first(where: { !CGDisplayBounds($0).contains(point) }) {
        let bounds = CGDisplayBounds(other)
        CGWarpMouseCursorPosition(CGPoint(x: bounds.midX, y: bounds.midY))
    } else if let own = displays.first(where: { CGDisplayBounds($0).contains(point) }) {
        let bounds = CGDisplayBounds(own)
        CGWarpMouseCursorPosition(CGPoint(x: bounds.maxX - 1, y: bounds.midY))
    }
default:
    exit(2)
}
