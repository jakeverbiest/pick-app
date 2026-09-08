// pngs-to-mp4.swift — assemble a PNG sequence into an H.264 MP4.
//
// WHY SWIFT. This Mac has no ffmpeg and no ImageMagick, and adding either (or
// node-canvas / puppeteer) means a toolchain dependency for what is otherwise a
// self-contained content pipeline. AVFoundation ships with macOS and the Swift
// compiler is already here because the iOS app is built on this machine, so
// this costs nothing new.
//
// Build once:
//   swiftc -O tools/pngs-to-mp4.swift -o tools/pngs-to-mp4
// Use:
//   tools/pngs-to-mp4 <frameDir> <out.mp4> <fps>
//
// Frames are taken in sorted filename order, so zero-pad them (frame-00001.png).

import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 4,
      let fps = Int32(args[3]), fps > 0 else {
    FileHandle.standardError.write("usage: pngs-to-mp4 <frameDir> <out.mp4> <fps>\n".data(using: .utf8)!)
    exit(2)
}
let dir = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?
    .filter { $0.lowercased().hasSuffix(".png") }
    .sorted() ?? []
guard !files.isEmpty else {
    FileHandle.standardError.write("no PNG frames in \(dir.path)\n".data(using: .utf8)!)
    exit(1)
}

// Size comes from the first frame; every frame must match it.
guard let firstImg = NSImage(contentsOf: dir.appendingPathComponent(files[0])),
      let firstCG = firstImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("could not read \(files[0])\n".data(using: .utf8)!)
    exit(1)
}
// H.264 wants even dimensions.
let W = firstCG.width  - (firstCG.width  % 2)
let H = firstCG.height - (firstCG.height % 2)

try? FileManager.default.removeItem(at: outURL)

let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: W,
    AVVideoHeightKey: H,
    AVVideoCompressionPropertiesKey: [
        // High bitrate on purpose: this footage is thin vector line work on a
        // dark ground, which is exactly what block artifacts ruin, and it gets
        // re-encoded again by whatever platform it is posted to.
        AVVideoAverageBitRateKey: 14_000_000,
        AVVideoMaxKeyFrameIntervalKey: fps,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
    ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
        kCVPixelBufferWidthKey as String: W,
        kCVPixelBufferHeightKey as String: H
    ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func buffer(from cg: CGImage) -> CVPixelBuffer? {
    guard let pool = adaptor.pixelBufferPool else { return nil }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
    guard let px = pb else { return nil }
    CVPixelBufferLockBaseAddress(px, [])
    defer { CVPixelBufferUnlockBaseAddress(px, []) }
    guard let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(px), width: W, height: H,
        bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(px),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
    return px
}

let queue = DispatchQueue(label: "pick.encode")
let done = DispatchSemaphore(value: 0)
var index = 0
var written = 0

input.requestMediaDataWhenReady(on: queue) {
    while input.isReadyForMoreMediaData {
        if index >= files.count {
            input.markAsFinished()
            writer.finishWriting { done.signal() }
            return
        }
        let f = dir.appendingPathComponent(files[index])
        guard let img = NSImage(contentsOf: f),
              let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let px = buffer(from: cg) else {
            FileHandle.standardError.write("skipping unreadable frame \(files[index])\n".data(using: .utf8)!)
            index += 1
            continue
        }
        adaptor.append(px, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: fps))
        written += 1
        index += 1
    }
}
done.wait()

if writer.status == .completed {
    let bytes = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
    let mb = Double(bytes) / 1_048_576.0
    print(String(format: "wrote %@ — %d frames @ %dfps, %dx%d, %.1f MB",
                 outURL.lastPathComponent, written, Int(fps), W, H, mb))
} else {
    FileHandle.standardError.write("encode failed: \(writer.error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(1)
}
