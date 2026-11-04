#if DEBUG
import CommonCrypto
import Foundation
import zlib

enum DebugSignature {
    enum SignatureError: Error {
        case invalidParameters
        case compressionFailed(Int32)
    }

    static func generate(
        sdkAppID: Int32,
        userID: String,
        secretKey: String,
        expireSeconds: Int64 = 86_400,
        issuedAt: Int64 = Int64(Date().timeIntervalSince1970)
    ) throws -> String {
        guard sdkAppID > 0, !userID.isEmpty, !secretKey.isEmpty,
              !userID.contains("\n"), !userID.contains("\r"),
              expireSeconds > 0, issuedAt > 0,
              issuedAt <= Int64.max - expireSeconds else {
            throw SignatureError.invalidParameters
        }
        let content = "TLS.identifier:\(userID)\n"
            + "TLS.sdkappid:\(sdkAppID)\n"
            + "TLS.time:\(issuedAt)\n"
            + "TLS.expire:\(expireSeconds)\n"
        let key = Data(secretKey.utf8)
        let data = Data(content.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        key.withUnsafeBytes { keyBytes in
            data.withUnsafeBytes { dataBytes in
                digest.withUnsafeMutableBytes { digestBytes in
                    CCHmac(
                        CCHmacAlgorithm(kCCHmacAlgSHA256),
                        keyBytes.baseAddress, keyBytes.count,
                        dataBytes.baseAddress, dataBytes.count,
                        digestBytes.baseAddress
                    )
                }
            }
        }
        let fields: [String: Any] = [
            "TLS.ver": "2.0",
            "TLS.identifier": userID,
            "TLS.sdkappid": sdkAppID,
            "TLS.time": issuedAt,
            "TLS.expire": expireSeconds,
            "TLS.sig": Data(digest).base64EncodedString()
        ]
        let json = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
        let compressed = try compressJSON(json)
        return compressed.base64EncodedString()
            .replacingOccurrences(of: "+", with: "*")
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "=", with: "_")
    }

    private static func compressJSON(_ input: Data) throws -> Data {
        var outputLength = compressBound(uLong(input.count))
        var output = [UInt8](repeating: 0, count: Int(outputLength))
        let status = input.withUnsafeBytes { source in
            output.withUnsafeMutableBytes { destination in
                compress2(
                    destination.bindMemory(to: Bytef.self).baseAddress,
                    &outputLength,
                    source.bindMemory(to: Bytef.self).baseAddress,
                    uLong(input.count),
                    Z_DEFAULT_COMPRESSION
                )
            }
        }
        guard status == Z_OK else {
            throw SignatureError.compressionFailed(status)
        }
        return Data(output.prefix(Int(outputLength)))
    }
}
#endif
