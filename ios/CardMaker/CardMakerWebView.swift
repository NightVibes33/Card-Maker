import SwiftUI
import UIKit
import WebKit

struct CardMakerWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(
            context.coordinator.schemeHandler,
            forURLScheme: CardMakerSchemeHandler.scheme
        )
        configuration.userContentController.add(context.coordinator, name: "cardMakerShare")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.nativeShareScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 8 / 255, green: 9 / 255, blue: 12 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        if let url = URL(string: "cardmaker://localhost/") {
            webView.load(URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    private static let nativeShareScript = """
    (function () {
      if (window.location.protocol !== 'cardmaker:' || !window.webkit?.messageHandlers?.cardMakerShare) return;
      window.__cardMakerShareCallbacks = Object.create(null);
      window.__completeNativeCardMakerShare = function (identifier, errorName) {
        const callback = window.__cardMakerShareCallbacks[identifier];
        if (!callback) return;
        delete window.__cardMakerShareCallbacks[identifier];
        if (errorName) callback.reject(new DOMException('The share sheet did not complete.', errorName));
        else callback.resolve();
      };
      try {
        Object.defineProperty(navigator, 'canShare', {
          configurable: true,
          value: function (data) {
            return Boolean(data && Array.isArray(data.files) && data.files.length === 1 && data.files[0]?.type === 'image/png');
          }
        });
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async function (data) {
            if (!data || !Array.isArray(data.files) || data.files.length !== 1 || data.files[0]?.type !== 'image/png') {
              throw new DOMException('Card Maker shares PNG images.', 'NotSupportedError');
            }
            const file = data.files[0];
            const dataURL = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('Could not prepare the exported image for sharing.'));
              reader.readAsDataURL(file);
            });
            const identifier = 'share-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            return new Promise((resolve, reject) => {
              window.__cardMakerShareCallbacks[identifier] = { resolve, reject };
              window.webkit.messageHandlers.cardMakerShare.postMessage({
                identifier,
                name: file.name || 'Card-Maker.png',
                dataURL
              });
            });
          }
        });
      } catch (_) {}
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let schemeHandler = CardMakerSchemeHandler()

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "cardMakerShare",
                  message.frameInfo.isMainFrame,
                  let webView = message.webView,
                  let body = message.body as? [String: Any],
                  let identifier = body["identifier"] as? String,
                  identifier.range(of: #"^share-[a-zA-Z0-9-]{4,100}$"#, options: .regularExpression) != nil,
                  let dataURL = body["dataURL"] as? String,
                  let comma = dataURL.firstIndex(of: ","),
                  dataURL[..<comma].contains("image/png"),
                  let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]), options: .ignoreUnknownCharacters),
                  !data.isEmpty,
                  data.count <= 24 * 1024 * 1024 else {
                if let webView = message.webView, let body = message.body as? [String: Any], let identifier = body["identifier"] as? String {
                    completeNativeShare(in: webView, identifier: identifier, errorName: "DataError")
                }
                return
            }

            let name = safePNGName(body["name"] as? String ?? "Card-Maker.png")
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + name)
            do {
                try data.write(to: destination, options: .atomic)
                presentShareSheet(for: destination, in: webView, identifier: identifier)
            } catch {
                completeNativeShare(in: webView, identifier: identifier, errorName: "DataError")
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if url.scheme == CardMakerSchemeHandler.scheme && url.host == "localhost" {
                decisionHandler(.allow)
                return
            }

            if ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        private func presentShareSheet(for fileURL: URL, in webView: WKWebView, identifier: String) {
            let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            activity.completionWithItemsHandler = { [weak self, weak webView] _, completed, _, error in
                try? FileManager.default.removeItem(at: fileURL)
                guard let self, let webView else { return }
                let errorName = error == nil && completed ? nil : (error == nil ? "AbortError" : "UnknownError")
                self.completeNativeShare(in: webView, identifier: identifier, errorName: errorName)
            }

            if let popover = activity.popoverPresentationController {
                popover.sourceView = webView
                popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }

            guard let presenter = topPresenter(from: webView.window?.rootViewController) else {
                try? FileManager.default.removeItem(at: fileURL)
                completeNativeShare(in: webView, identifier: identifier, errorName: "UnknownError")
                return
            }
            presenter.present(activity, animated: true)
        }

        private func topPresenter(from controller: UIViewController?) -> UIViewController? {
            guard let controller else { return nil }
            if let presented = controller.presentedViewController { return topPresenter(from: presented) }
            if let navigation = controller as? UINavigationController { return topPresenter(from: navigation.visibleViewController) }
            if let tabs = controller as? UITabBarController { return topPresenter(from: tabs.selectedViewController) }
            return controller
        }

        private func completeNativeShare(in webView: WKWebView, identifier: String, errorName: String?) {
            let idJSON = (try? JSONSerialization.data(withJSONObject: identifier, options: [.fragmentsAllowed]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
            let errorJSON = (try? JSONSerialization.data(withJSONObject: errorName as Any? ?? NSNull(), options: [.fragmentsAllowed]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
            DispatchQueue.main.async {
                webView.evaluateJavaScript("window.__completeNativeCardMakerShare && window.__completeNativeCardMakerShare(\(idJSON), \(errorJSON));")
            }
        }

        private func safePNGName(_ raw: String) -> String {
            var allowed = CharacterSet.alphanumerics
            allowed.insert(charactersIn: "-_.@")
            let name = raw.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }.reduce(into: "") { $0.append($1) }
            let trimmed = String(name.prefix(96))
            return trimmed.lowercased().hasSuffix(".png") ? trimmed : trimmed + ".png"
        }
    }
}
