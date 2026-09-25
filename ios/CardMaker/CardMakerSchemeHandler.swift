import Foundation
import UniformTypeIdentifiers
import WebKit

final class CardMakerSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cardmaker"

    private let lock = NSLock()
    private var cancelledTasks = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard let url = urlSchemeTask.request.url, url.host == "localhost" else {
            deliver(
                LocalAppResponse.json(["error": "Invalid local app URL"], status: 400),
                for: urlSchemeTask,
                id: taskID
            )
            return
        }

        if url.path.hasPrefix("/api/") {
            CardMakerLocalAPI.shared.handle(url) { [weak self] response in
                self?.deliver(response, for: urlSchemeTask, id: taskID)
            }
            return
        }

        deliver(staticFileResponse(for: url), for: urlSchemeTask, id: taskID)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        lock.lock()
        cancelledTasks.insert(taskID)
        lock.unlock()
    }

    private func deliver(_ response: LocalAppResponse, for task: WKURLSchemeTask, id: ObjectIdentifier) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let wasCancelled = self.cancelledTasks.remove(id) != nil
            self.lock.unlock()
            guard !wasCancelled else { return }

            let headers = [
                "Content-Type": response.mimeType,
                "Cache-Control": response.cacheControl,
                "Access-Control-Allow-Origin": "*",
                "X-Content-Type-Options": "nosniff"
            ]
            guard let requestURL = task.request.url,
                  let httpResponse = HTTPURLResponse(
                    url: requestURL,
                    statusCode: response.status,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers
                  ) else {
                task.didFailWithError(URLError(.badServerResponse))
                return
            }

            task.didReceive(httpResponse)
            task.didReceive(response.data)
            task.didFinish()
        }
    }

    private func staticFileResponse(for url: URL) -> LocalAppResponse {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true) else {
            return LocalAppResponse.text("Local app bundle is missing.", status: 500)
        }

        let decodedPath = (url.path.removingPercentEncoding ?? url.path)
        let parts = decodedPath.split(separator: "/").map(String.init)
        guard !parts.contains(".."), !decodedPath.contains("\\") else {
            return LocalAppResponse.text("Invalid app asset path.", status: 400)
        }

        let relativePath = parts.isEmpty ? "index.html" : parts.joined(separator: "/")
        let assetURL = root.appendingPathComponent(relativePath, isDirectory: false)
        guard assetURL.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") || relativePath == "index.html" else {
            return LocalAppResponse.text("Invalid app asset path.", status: 400)
        }

        do {
            let data = try Data(contentsOf: assetURL, options: [.mappedIfSafe])
            return LocalAppResponse(data: data, status: 200, mimeType: mimeType(for: assetURL))
        } catch {
            return LocalAppResponse.text("App asset not found.", status: 404)
        }
    }

    private func mimeType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        if ext == "wasm" { return "application/wasm" }
        if ext == "js" || ext == "mjs" { return "text/javascript; charset=utf-8" }
        if ext == "css" { return "text/css; charset=utf-8" }
        if ext == "json" || ext == "webmanifest" { return "application/json; charset=utf-8" }
        if ext == "html" { return "text/html; charset=utf-8" }
        if ext == "txt" { return "text/plain; charset=utf-8" }
        if ext == "svg" { return "image/svg+xml" }
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}
