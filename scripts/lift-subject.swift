import Vision
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    print("usage: lift-subject <input.jpg> <output-mask.png>")
    exit(1)
}
let inputPath = args[1]
let outputPath = args[2]

guard let nsImage = NSImage(contentsOfFile: inputPath),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("could not load image")
    exit(1)
}

let semaphore = DispatchSemaphore(value: 0)
var resultMask: CGImage? = nil
var errorMessage: String? = nil

let request = VNGenerateForegroundInstanceMaskRequest { request, error in
    if let error = error {
        errorMessage = error.localizedDescription
        semaphore.signal()
        return
    }
    guard let result = request.results?.first as? VNInstanceMaskObservation else {
        errorMessage = "no instance mask observation"
        semaphore.signal()
        return
    }
    do {
        let allInstances = result.allInstances
        let pixelBuffer = try result.generateMaskedImage(ofInstances: allInstances, from: VNImageRequestHandler(cgImage: cgImage), croppedToInstancesExtent: false)
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        resultMask = context.createCGImage(ciImage, from: ciImage.extent)
    } catch {
        errorMessage = "mask generation failed: \(error.localizedDescription)"
    }
    semaphore.signal()
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
DispatchQueue.global().async {
    do {
        try handler.perform([request])
    } catch {
        errorMessage = "perform failed: \(error.localizedDescription)"
        semaphore.signal()
    }
}

semaphore.wait()

if let err = errorMessage {
    print("ERROR: \(err)")
    exit(1)
}

guard let mask = resultMask else {
    print("ERROR: no mask produced")
    exit(1)
}

let rep = NSBitmapImageRep(cgImage: mask)
guard let pngData = rep.representation(using: .png, properties: [:]) else {
    print("ERROR: could not encode png")
    exit(1)
}

try pngData.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath), size \(mask.width)x\(mask.height)")
