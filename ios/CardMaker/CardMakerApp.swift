import SwiftUI

@main
struct CardMakerApp: App {
    var body: some Scene {
        WindowGroup {
            CardMakerWebView()
                .ignoresSafeArea()
        }
    }
}
