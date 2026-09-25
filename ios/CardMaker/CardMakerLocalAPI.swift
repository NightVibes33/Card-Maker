import CryptoKit
import Foundation
import ImageIO
import UIKit

struct LocalAppResponse {
    let data: Data
    let status: Int
    let mimeType: String
    let cacheControl: String

    init(
        data: Data,
        status: Int = 200,
        mimeType: String = "application/octet-stream",
        cacheControl: String = "no-store"
    ) {
        self.data = data
        self.status = status
        self.mimeType = mimeType
        self.cacheControl = cacheControl
    }

    static func json(_ value: Any, status: Int = 200, cacheControl: String = "no-store") -> LocalAppResponse {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])) ?? Data("{}".utf8)
        return LocalAppResponse(data: data, status: status, mimeType: "application/json; charset=utf-8", cacheControl: cacheControl)
    }

    static func text(_ value: String, status: Int = 200, mimeType: String = "text/plain; charset=utf-8") -> LocalAppResponse {
        LocalAppResponse(data: Data(value.utf8), status: status, mimeType: mimeType)
    }
}

private final class RedirectAllowlist: NSObject, URLSessionTaskDelegate {
    private let allowedHosts: Set<String>

    init(allowedHosts: Set<String>) {
        self.allowedHosts = allowedHosts
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url, Self.isAllowed(url, hosts: allowedHosts) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    static func isAllowed(_ url: URL, hosts: Set<String>) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https",
              let host = url.host?.lowercased(), hosts.contains(host),
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 443 else { return false }
        return true
    }
}

final class CardMakerLocalAPI {
    static let shared = CardMakerLocalAPI()

    private let shopifyHosts: Set<String> = ["cucucovers.com", "www.cucucovers.com", "www.animedeskmat.com"]
    private let imageHosts: Set<String> = [
        "cdn.shopify.com", "cucucovers.com", "www.cucucovers.com",
        "animedeskmat.com", "www.animedeskmat.com",
        "animetowncreations.com", "www.animetowncreations.com",
        "stickyinkdesigns.com", "www.stickyinkdesigns.com",
        "styledcards.com", "www.styledcards.com"
    ]
    private let cacheQueue = DispatchQueue(label: "com.cardmaker.native-cache")
    private let fileManager = FileManager.default
    private let cacheRoot: URL

    private struct CatalogCollection {
        let label: String
        let handle: String
        let total: Int?
    }

    private let collections: [String: Collection] = [
        "all": CatalogCollection(label: "All Card Skins", handle: "all-card-covers", total: 2225),
        "best": CatalogCollection(label: "Best Sellers", handle: "best-sellers", total: nil),
        "new": CatalogCollection(label: "New Arrivals", handle: "latest-1", total: nil),
        "anime": CatalogCollection(label: "Anime", handle: "anime", total: nil),
        "cars": CatalogCollection(label: "Cars", handle: "cars", total: nil),
        "sports": CatalogCollection(label: "Sports", handle: "nba-card-skins", total: nil),
        "artistic": CatalogCollection(label: "Artistic", handle: "artistic", total: nil),
        "cute": CatalogCollection(label: "Cute & Kawaii", handle: "cute", total: nil),
        "pets": CatalogCollection(label: "Pets", handle: "pets", total: nil),
        "classic": CatalogCollection(label: "Classic Art", handle: "classic-art", total: nil),
        "funny": CatalogCollection(label: "Funny", handle: "funny", total: nil),
        "memes": CatalogCollection(label: "Memes", handle: "memes", total: nil),
        "retro": CatalogCollection(label: "Retro & Nostalgic", handle: "retro", total: nil),
        "animals": CatalogCollection(label: "Animals", handle: "animals", total: nil),
        "crypto": CatalogCollection(label: "Crypto", handle: "crypto-currency", total: nil)
    ]

    private let categoryTerms: [String: [String]] = [
        "best": ["best seller", "best sellers", "trending"],
        "new": ["new", "latest"],
        "anime": ["anime"],
        "cars": ["cars", "jdm", "racing", "motorsports"],
        "sports": ["sports", "basketball", "football", "baseball", "soccer", "hockey", "nba", "ufc", "mma"],
        "artistic": ["artistic", "art", "abstract", "paintings"],
        "cute": ["cute", "kawaii"],
        "pets": ["pets", "pet"],
        "classic": ["classic art", "paintings", "van gogh", "monet", "klimt", "vermeer", "renoir"],
        "funny": ["funny", "funnyy"],
        "memes": ["meme", "memes", "brainrot"],
        "retro": ["retro", "nostalgic", "nostalgia"],
        "animals": ["animals", "animal"],
        "crypto": ["crypto", "bitcoin", "ethereum", "dogecoin"]
    ]

    private init() {
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        cacheRoot = support.appendingPathComponent("CardMakerOfflineCache", isDirectory: true)
        try? fileManager.createDirectory(at: cacheRoot, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var cacheURL = cacheRoot
        try? cacheURL.setResourceValues(values)
    }

    func handle(_ url: URL, completion: @escaping (LocalAppResponse) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let path = url.path
            switch path {
            case "/api/cucu":
                Task { completion(await self.cucuResponse(for: url)) }
            case "/api/animedeskmat":
                Task { completion(await self.animeDeskMatResponse(for: url)) }
            case "/api/image":
                Task { completion(await self.imageResponse(for: url)) }
            case "/api/cucu/inspect":
                completion(.json(["error": "Use local image inspection"], status: 501))
            case "/api/search":
                completion(.json(["results": [], "offline": true]))
            default:
                completion(.json(["error": "Unknown local API route"], status: 404))
            }
        }
    }

    private func cucuResponse(for requestURL: URL) async -> LocalAppResponse {
        let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []
        let categoryKey = (queryItems.first(where: { $0.name == "category" })?.value ?? "all").lowercased()
        let collection = collections[categoryKey] ?? collections["all"]!
        let query = cleanText(queryItems.first(where: { $0.name == "q" })?.value ?? "").lowercased()
        let page = max(1, Int(queryItems.first(where: { $0.name == "page" })?.value ?? "1") ?? 1)
        let limit = min(48, max(12, Int(queryItems.first(where: { $0.name == "limit" })?.value ?? "36") ?? 36))
        let key = requestURL.absoluteString

        do {
            let results: [[String: Any]]
            let total: Int?
            let hasMore: Bool
            let mode: String

            if !query.isEmpty {
                let products = try await searchShopify(query: query, origin: "https://cucucovers.com")
                let tokens = query.split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { $0.count > 1 }
                let matches = products.filter { product in
                    let evidence = productEvidence(product)
                    return tokens.allSatisfy { evidence.contains($0) }
                        && matchesCategory(product, key: categoryKey)
                }
                let start = (page - 1) * limit
                results = matches.dropFirst(start).prefix(limit).compactMap { flattenCucu($0, collection: collection.handle) }
                total = matches.count
                hasMore = start + limit < matches.count
                mode = "predictive-search"
            } else {
                let start = (page - 1) * limit
                let sourcePage = start / 100 + 1
                let localStart = start % 100
                var products = try await shopifyCollection(
                    origin: "https://cucucovers.com",
                    handle: collection.handle,
                    page: sourcePage
                )
                if localStart + limit + 1 > products.count && products.count == 100 {
                    products += try await shopifyCollection(
                        origin: "https://cucucovers.com",
                        handle: collection.handle,
                        page: sourcePage + 1
                    )
                }
                let slice = products.dropFirst(localStart).prefix(limit)
                results = slice.filter(isCardCover).compactMap { flattenCucu($0, collection: collection.handle) }
                let bufferedNext = products.count > localStart + limit
                let canContinue = products.count >= 100 && (bufferedNext || products.count > 100)
                total = collection.total
                hasMore = collection.total.map { start + limit < $0 } ?? (bufferedNext || canContinue)
                mode = "shopify-collection"
            }

            let body: [String: Any] = [
                "results": results,
                "page": page,
                "limit": limit,
                "total": total as Any? ?? NSNull(),
                "totalPages": total.map { max(1, Int(ceil(Double($0) / Double(limit)))) } as Any? ?? NSNull(),
                "hasMore": hasMore,
                "source": "CUCU Covers · \(collection.label)",
                "category": categoryKey,
                "categoryLabel": query.isEmpty ? collection.label : "Search",
                "collectionHandle": collection.handle,
                "query": query,
                "categories": collections.map { key, value in
                    ["key": key, "label": value.label, "handle": value.handle]
                }.sorted { ($0["key"] as? String ?? "") < ($1["key"] as? String ?? "") },
                "upstream": ["collection": collection.handle, "shopifyPageSize": 100, "mode": mode]
            ]
            let response = LocalAppResponse.json(body, cacheControl: "private, max-age=300")
            store(response.data, kind: "catalog", key: key)
            return response
        } catch {
            if let data = cached(kind: "catalog", key: key) {
                return LocalAppResponse(data: data, status: 200, mimeType: "application/json; charset=utf-8")
            }
            return .json([
                "results": [], "page": page, "limit": limit, "total": collection.total as Any? ?? NSNull(),
                "totalPages": NSNull(), "hasMore": false, "source": "CUCU Covers · \(collection.label)",
                "category": categoryKey, "categoryLabel": collection.label, "collectionHandle": collection.handle,
                "query": query, "offline": true
            ])
        }
    }

    private func animeDeskMatResponse(for requestURL: URL) async -> LocalAppResponse {
        let queryItems = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let query = cleanText(queryItems.first(where: { $0.name == "q" })?.value ?? "")
        let page = max(1, Int(queryItems.first(where: { $0.name == "page" })?.value ?? "1") ?? 1)
        let limit = min(48, max(8, Int(queryItems.first(where: { $0.name == "limit" })?.value ?? "36") ?? 36))
        let key = requestURL.absoluteString

        do {
            let products: [[String: Any]]
            let total: Int?
            let mode: String
            var hasMore = false
            if query.isEmpty {
                let start = (page - 1) * limit
                let sourcePage = start / 100 + 1
                let localStart = start % 100
                var batch = try await shopifyCollection(
                    origin: "https://www.animedeskmat.com",
                    handle: "anime-credit-card-skins",
                    page: sourcePage
                )
                if localStart + limit + 1 > batch.count && batch.count == 100 {
                    batch += try await shopifyCollection(
                        origin: "https://www.animedeskmat.com",
                        handle: "anime-credit-card-skins",
                        page: sourcePage + 1
                    )
                }
                let rawSlice = Array(batch.dropFirst(localStart).prefix(limit))
                products = rawSlice
                hasMore = start + limit < 907 && (batch.count > localStart + limit || batch.count >= 100)
                total = 907
                mode = "shopify-collection"
            } else {
                products = try await searchShopify(query: query + " credit card skins", origin: "https://www.animedeskmat.com")
                total = products.count
                hasMore = (page - 1) * limit + limit < products.count
                mode = "predictive-search"
            }

            let start = (page - 1) * limit
            let selectedProducts = query.isEmpty ? products : Array(products.dropFirst(start).prefix(limit))
            let results = selectedProducts.compactMap(flattenAnimeDeskMat)
            let body: [String: Any] = [
                "results": results,
                "page": page,
                "limit": limit,
                "total": total as Any? ?? NSNull(),
                "totalPages": total.map { max(1, Int(ceil(Double($0) / Double(limit)))) } as Any? ?? NSNull(),
                "hasMore": hasMore,
                "source": "AnimeDeskMat · Anime",
                "category": "anime",
                "categoryLabel": query.isEmpty ? "Anime" : "Search Results",
                "collectionHandle": "anime-credit-card-skins",
                "query": query,
                "upstream": ["collection": "anime-credit-card-skins", "shopifyPageSize": 100, "mode": mode, "assetPolicy": "plain-full-cover-only", "knownCollectionTotal": 907]
            ]
            let response = LocalAppResponse.json(body, cacheControl: "private, max-age=300")
            store(response.data, kind: "catalog", key: key)
            return response
        } catch {
            if let data = cached(kind: "catalog", key: key) {
                return LocalAppResponse(data: data, status: 200, mimeType: "application/json; charset=utf-8")
            }
            return .json([
                "results": [], "page": page, "limit": limit, "total": query.isEmpty ? 907 : NSNull() as Any,
                "totalPages": NSNull(), "hasMore": false, "source": "AnimeDeskMat · Anime", "category": "anime",
                "categoryLabel": query.isEmpty ? "Anime" : "Search Results", "collectionHandle": "anime-credit-card-skins",
                "query": query, "offline": true
            ])
        }
    }

    private func imageResponse(for requestURL: URL) async -> LocalAppResponse {
        guard let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false),
              let raw = components.queryItems?.first(where: { $0.name == "url" })?.value,
              raw.utf8.count <= 2200,
              let source = URL(string: raw), RedirectAllowlist.isAllowed(source, hosts: imageHosts) else {
            return .text("Image host not allowed", status: 403)
        }

        let requestedWidth = Int(components.queryItems?.first(where: { $0.name == "w" })?.value ?? "0") ?? 0
        let width = min(3072, max(0, requestedWidth))
        let cacheKey = source.absoluteString + "|width=" + String(width)
        if let data = cached(kind: "images", key: cacheKey),
           let type = cachedMimeType(kind: "images", key: cacheKey) {
            return LocalAppResponse(data: data, mimeType: type, cacheControl: "public, max-age=31536000, immutable")
        }

        do {
            var upstreamURL = source
            if width >= 160, ["cdn.shopify.com", "cucucovers.com", "www.cucucovers.com"].contains(source.host?.lowercased() ?? "") {
                var upstreamComponents = URLComponents(url: source, resolvingAgainstBaseURL: false)
                var items = upstreamComponents?.queryItems ?? []
                items.removeAll { $0.name == "width" }
                items.append(URLQueryItem(name: "width", value: String(width)))
                upstreamComponents?.queryItems = items
                upstreamURL = upstreamComponents?.url ?? source
            }

            let (upstreamData, response) = try await fetch(upstreamURL, allowedHosts: imageHosts, accept: "image/avif,image/webp,image/jpeg,image/png,*/*")
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw LocalNetworkError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 502)
            }
            guard upstreamData.count <= 15 * 1024 * 1024 else { throw LocalNetworkError.imageTooLarge }
            let upstreamType = (http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream")
                .split(separator: ";", maxSplits: 1).first.map(String.init)?.lowercased() ?? "application/octet-stream"
            guard upstreamType.hasPrefix("image/") else { throw LocalNetworkError.unsupportedImage }

            let (data, mimeType) = width >= 160 ? resizeImage(upstreamData, maximumPixelSize: width) ?? (upstreamData, upstreamType) : (upstreamData, upstreamType)
            guard data.count <= 15 * 1024 * 1024 else { throw LocalNetworkError.imageTooLarge }
            store(data, kind: "images", key: cacheKey)
            store(Data(mimeType.utf8), kind: "image-types", key: cacheKey)
            return LocalAppResponse(data: data, mimeType: mimeType, cacheControl: "public, max-age=31536000, immutable")
        } catch {
            if let data = cached(kind: "images", key: cacheKey),
               let type = cachedMimeType(kind: "images", key: cacheKey) {
                return LocalAppResponse(data: data, mimeType: type, cacheControl: "public, max-age=31536000, immutable")
            }
            return .text("Image unavailable offline", status: 503)
        }
    }

    private func shopifyCollection(origin: String, handle: String, page: Int) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(origin)/collections/\(handle)/products.json")!
        components.queryItems = [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "page", value: String(page))]
        let json = try await getJSON(components.url!, allowedHosts: shopifyHosts, referer: "\(origin)/collections/\(handle)")
        return json["products"] as? [[String: Any]] ?? []
    }

    private func searchShopify(query: String, origin: String) async throws -> [[String: Any]] {
        var components = URLComponents(string: "\(origin)/search/suggest.json")!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "resources[type]", value: "product"),
            URLQueryItem(name: "resources[limit]", value: "20")
        ]
        let json = try await getJSON(components.url!, allowedHosts: shopifyHosts, referer: origin)
        let resources = json["resources"] as? [String: Any]
        let results = resources?["results"] as? [String: Any]
        return results?["products"] as? [[String: Any]] ?? []
    }

    private func getJSON(_ url: URL, allowedHosts: Set<String>, referer: String) async throws -> [String: Any] {
        var lastError: Error = LocalNetworkError.invalidResponse
        for attempt in 0..<2 {
            do {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
                request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
                request.setValue(referer, forHTTPHeaderField: "Referer")
                let (data, response) = try await fetch(request, allowedHosts: allowedHosts)
                guard let http = response as? HTTPURLResponse else { throw LocalNetworkError.invalidResponse }
                if (200..<300).contains(http.statusCode),
                   let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] { return json }
                lastError = LocalNetworkError.badStatus(http.statusCode)
                if http.statusCode < 500 && http.statusCode != 429 { break }
            } catch {
                lastError = error
                if let urlError = error as? URLError,
                   [.notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .timedOut].contains(urlError.code) {
                    throw error
                }
            }
            if attempt < 1 { try? await Task.sleep(nanoseconds: 500_000_000) }
        }
        throw lastError
    }

    private func fetch(_ url: URL, allowedHosts: Set<String>, accept: String? = nil) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        if let accept { request.setValue(accept, forHTTPHeaderField: "Accept") }
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
        return try await fetch(request, allowedHosts: allowedHosts)
    }

    private func fetch(_ request: URLRequest, allowedHosts: Set<String>) async throws -> (Data, URLResponse) {
        guard let url = request.url, RedirectAllowlist.isAllowed(url, hosts: allowedHosts) else {
            throw LocalNetworkError.hostNotAllowed
        }
        let delegate = RedirectAllowlist(allowedHosts: allowedHosts)
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let finalURL = response.url, RedirectAllowlist.isAllowed(finalURL, hosts: allowedHosts) else {
            throw LocalNetworkError.hostNotAllowed
        }
        return (data, response)
    }

    private func flattenCucu(_ product: [String: Any], collection: String) -> [String: Any]? {
        guard let handle = product["handle"] as? String, !handle.isEmpty else { return nil }
        let title = cleanText(product["title"] as? String ?? handle.replacingOccurrences(of: "-", with: " "))
        var candidates = productImages(product)
        candidates.sort { assetScore($0) > assetScore($1) }
        candidates = Array(candidates.prefix(8))
        guard let first = candidates.first, let source = first["src"] as? String else { return nil }
        let candidateURLs = candidates.compactMap { $0["src"] as? String }
        let alt = cleanText(first["alt"] as? String ?? title)
        return [
            "id": "cucu-\(handle)", "title": title, "subtitle": "CUCU Covers",
            "image": imageProxy(source), "thumbnail": imageProxy(source, width: 560),
            "inspectUrls": Array(candidateURLs.prefix(3)).map(inspectProxy),
            "candidateImages": candidateURLs.map { imageProxy($0) }, "directAssetUrls": candidateURLs,
            "source": "CUCU Covers", "sourceUrl": "https://cucucovers.com/products/\(handle)",
            "mediaType": "premade-card-skin", "cleanFilter": "direct-shopify-card-art", "assetMode": "direct-card-art",
            "mediaAlt": alt, "collection": collection,
            "upstreamProductType": cleanText(product["product_type"] as? String ?? ""),
            "tags": product["tags"] ?? []
        ]
    }

    private func flattenAnimeDeskMat(_ product: [String: Any]) -> [String: Any]? {
        guard let handle = product["handle"] as? String, !handle.isEmpty else { return nil }
        let title = cleanText(product["title"] as? String ?? handle.replacingOccurrences(of: "-", with: " "))
        var candidates: [[String: Any]] = []
        var seen = Set<String>()
        for image in productImages(product) {
            guard let src = image["src"] as? String else { continue }
            for candidate in [originalFullCoverAsset(src), plainFullCoverAsset(src)].compactMap({ $0 }) where seen.insert(candidate).inserted {
                candidates.append(["src": candidate, "alt": image["alt"] ?? "", "width": image["width"] ?? 0, "height": image["height"] ?? 0])
            }
        }
        if let featured = product["featured_image"] as? String,
           let source = plainFullCoverAsset(featured), seen.insert(source).inserted {
            candidates.append(["src": source, "alt": "", "width": 0, "height": 0])
        }
        candidates.sort {
            (number($0["width"]) * number($0["height"])) > (number($1["width"]) * number($1["height"]))
        }
        candidates = Array(candidates.prefix(8))
        guard let first = candidates.first, let source = first["src"] as? String else { return nil }
        let urls = candidates.compactMap { $0["src"] as? String }
        return [
            "id": "animedeskmat-\(handle)", "title": title, "subtitle": "AnimeDeskMat",
            "image": imageProxy(source), "thumbnail": imageProxy(source, width: 560),
            "inspectUrls": Array(urls.prefix(3)).map(inspectProxy),
            "candidateImages": urls.map { imageProxy($0) }, "directAssetUrls": urls,
            "source": "AnimeDeskMat", "sourceUrl": "https://www.animedeskmat.com/products/\(handle)",
            "mediaType": "premade-card-skin", "cleanFilter": "strict-full-cover-no-chip", "assetMode": "direct-card-art",
            "mediaAlt": cleanText(first["alt"] as? String ?? title), "collection": "anime-credit-card-skins",
            "tags": product["tags"] ?? []
        ]
    }

    private func productImages(_ product: [String: Any]) -> [[String: Any]] {
        var images = product["images"] as? [Any] ?? []
        if let featured = product["featured_image"] { images.append(featured) }
        if let image = product["image"] { images.append(image) }
        return images.compactMap { value in
            if let image = value as? [String: Any] {
                let raw = image["src"] as? String ?? image["url"] as? String ?? ""
                guard let source = normalizedHTTPS(raw) else { return nil }
                return ["src": source, "alt": image["alt"] ?? "", "width": image["width"] ?? 0, "height": image["height"] ?? 0]
            }
            if let raw = value as? String, let source = normalizedHTTPS(raw) {
                return ["src": source, "alt": "", "width": 0, "height": 0]
            }
            return nil
        }
    }

    private func isCardCover(_ product: [String: Any]) -> Bool {
        let productType = cleanText(product["product_type"] as? String ?? "").lowercased()
        if !productType.isEmpty { return productType.range(of: #"\bcard covers?\b"#, options: .regularExpression) != nil }
        let fallback = "\(cleanText(product["title"] as? String ?? "")) \(product["handle"] as? String ?? "")".lowercased()
        return fallback.range(of: #"\b(?:card|credit card|debit card)\s+(?:cover|covers|skin|skins)\b"#, options: .regularExpression) != nil
    }

    private func matchesCategory(_ product: [String: Any], key: String) -> Bool {
        guard let terms = categoryTerms[key], !terms.isEmpty else { return true }
        let evidence = productEvidence(product)
        return terms.contains { evidence.contains($0) }
    }

    private func productEvidence(_ product: [String: Any]) -> String {
        let tags = (product["tags"] as? [String])?.joined(separator: " ") ?? product["tags"] as? String ?? ""
        return [product["title"] as? String ?? "", product["handle"] as? String ?? "", product["product_type"] as? String ?? "", product["body_html"] as? String ?? "", tags]
            .map(cleanText).joined(separator: " ").lowercased()
    }

    private func assetScore(_ image: [String: Any]) -> Double {
        guard let raw = image["src"] as? String else { return -100 }
        let filename = URL(string: raw)?.lastPathComponent.lowercased() ?? ""
        let alt = cleanText(image["alt"] as? String ?? "").lowercased()
        var score = filename.hasSuffix(".png") ? 8.0 : ((filename.hasSuffix(".webp") || filename.hasSuffix(".jpg") || filename.hasSuffix(".jpeg")) ? 3 : 0)
        if raw.lowercased().contains("/cdn/shop/files/") || raw.lowercased().contains("/cdn/shop/products/") { score += 5 }
        if filename.range(of: #"^\d{5,}[a-z]?[-_]\d+\.(png|webp|jpe?g)$"#, options: .regularExpression) != nil { score += 30 }
        if filename.range(of: #"^\d{5,}[a-z]?\.(png|webp|jpe?g)$"#, options: .regularExpression) != nil { score += 22 }
        if (filename + " " + alt).range(of: #"mockup|lifestyle|customer|review|package|packaging|install|instruction|size[-_ ]?guide|material"#, options: .regularExpression) != nil { score -= 40 }
        let pixels = max(1, number(image["width"]) * number(image["height"]))
        if pixels > 0 { score += min(18, log2(pixels / 200_000) * 4) }
        return score
    }

    private func plainFullCoverAsset(_ raw: String) -> String? {
        guard let source = normalizedHTTPS(raw), let url = URL(string: source),
              let decoded = url.lastPathComponent.removingPercentEncoding?.lowercased() else { return nil }
        if decoded.range(of: #"with[-_](?:chip|window)|half[-_]cover|4[-_]sets?"#, options: .regularExpression) != nil { return nil }
        guard decoded.range(of: #"full-cover(?:_[a-z0-9-]+)?\.(?:png|webp|jpe?g)$"#, options: .regularExpression) != nil else { return nil }
        return source
    }

    private func originalFullCoverAsset(_ raw: String) -> String? {
        guard var components = URLComponents(string: raw) else { return nil }
        let path = components.path.replacingOccurrences(of: #"_\d+x\d*(?:@\d+x)?(?=\.(?:png|webp|jpe?g)$)"#, with: "", options: [.regularExpression, .caseInsensitive])
        guard path != components.path else { return nil }
        components.path = path
        guard let url = components.url?.absoluteString else { return nil }
        return plainFullCoverAsset(url)
    }

    private func imageProxy(_ raw: String, width: Int = 0) -> String {
        var components = URLComponents()
        components.path = "/api/image"
        var items = [URLQueryItem(name: "url", value: raw)]
        if width > 0 { items.append(URLQueryItem(name: "w", value: String(width))) }
        items.append(URLQueryItem(name: "v", value: "4"))
        components.queryItems = items
        return components.string ?? "/api/image"
    }

    private func inspectProxy(_ raw: String) -> String {
        var components = URLComponents()
        components.path = "/api/cucu/inspect"
        components.queryItems = [URLQueryItem(name: "url", value: raw)]
        return components.string ?? "/api/cucu/inspect"
    }

    private func normalizedHTTPS(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate = trimmed.hasPrefix("//") ? "https:\(trimmed)" : trimmed
        guard let url = URL(string: candidate), RedirectAllowlist.isAllowed(url, hosts: imageHosts) else { return nil }
        return url.absoluteString
    }

    private func resizeImage(_ data: Data, maximumPixelSize: Int) -> (Data, String)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let alpha = image.alphaInfo
        let hasAlpha = [CGImageAlphaInfo.first, .last, .premultipliedFirst, .premultipliedLast, .alphaOnly].contains(alpha)
        let uiImage = UIImage(cgImage: image)
        if hasAlpha, let png = uiImage.pngData() { return (png, "image/png") }
        if let jpg = uiImage.jpegData(compressionQuality: maximumPixelSize <= 800 ? 0.86 : 0.92) { return (jpg, "image/jpeg") }
        return nil
    }

    private func cleanText(_ value: String) -> String {
        value.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func number(_ value: Any?) -> Double {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) ?? 0 }
        return 0
    }

    private func cacheDirectory(_ kind: String) -> URL {
        let url = cacheRoot.appendingPathComponent(kind, isDirectory: true)
        try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func cacheURL(kind: String, key: String, suffix: String = "bin") -> URL {
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return cacheDirectory(kind).appendingPathComponent(digest + "." + suffix, isDirectory: false)
    }

    private func cached(kind: String, key: String) -> Data? {
        let url = cacheURL(kind: kind, key: key, suffix: kind == "catalog" ? "json" : "bin")
        return cacheQueue.sync {
            guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { return nil }
            if kind == "images" {
                try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            }
            return data
        }
    }

    private func cachedMimeType(kind: String, key: String) -> String? {
        guard let data = cached(kind: "image-types", key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func store(_ data: Data, kind: String, key: String) {
        let suffix = kind == "catalog" ? "json" : "bin"
        let destination = cacheURL(kind: kind, key: key, suffix: suffix)
        cacheQueue.sync {
            try? data.write(to: destination, options: .atomic)
            if kind == "images" { pruneImageCacheIfNeeded() }
        }
    }

    private func pruneImageCacheIfNeeded() {
        let directory = cacheDirectory("images")
        guard let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        let entries = files.compactMap { url -> (URL, Int, Date)? in
            guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) else { return nil }
            return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
        }
        var total = entries.reduce(0) { $0 + $1.1 }
        guard total > 350 * 1024 * 1024 else { return }
        for entry in entries.sorted(by: { $0.2 < $1.2 }) {
            try? fileManager.removeItem(at: entry.0)
            let typeURL = cacheDirectory("image-types").appendingPathComponent(entry.0.deletingPathExtension().lastPathComponent + ".bin")
            try? fileManager.removeItem(at: typeURL)
            total -= entry.1
            if total <= 300 * 1024 * 1024 { break }
        }
    }
}

private enum LocalNetworkError: Error {
    case hostNotAllowed
    case invalidResponse
    case badStatus(Int)
    case imageTooLarge
    case unsupportedImage
}
