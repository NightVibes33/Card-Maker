# Card Maker for iOS

The iOS target ships the app's exported Next.js interface and its cutout model inside the app bundle. The editor, imported files, saved projects, exports, and AI cutout run on the phone. Retailer catalogs and product images are requested directly by the phone and cached on-device; previously visited catalog pages and artwork remain available offline. A fresh install does not include thousands of retailer images.

## Build locally on a Mac

Use Xcode 26 or newer, XcodeGen, Node 22, and Python 3.12.

```sh
npm ci
python -m pip install huggingface_hub
python scripts/download-ios-model.py
npm run verify:ios-native
npm run build:ios-web
xcodegen generate --spec ios/project.yml --project ios
xcodebuild -project ios/CardMaker.xcodeproj -scheme CardMaker -configuration Release -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The model downloader pins and verifies the quantized ORMBG ONNX weights, and copies its model card, notice, and Apache 2.0 license into the app bundle. `build:ios-web` fails if the model, license, or notice is missing or if Vercel Analytics code remains in the exported app.

## Create an App Store IPA in GitHub Actions

Run **Package App Store IPA** from the Actions tab on the `codex/app-store-ipa` branch. Add these repository Actions secrets first:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID |
| `APPSTORE_CERTIFICATE_P12_BASE64` | Base64-encoded Apple Distribution `.p12` certificate |
| `APPSTORE_CERTIFICATE_PASSWORD` | Password used when exporting that `.p12` |
| `APPSTORE_PROFILE_BASE64` | Base64-encoded App Store provisioning profile for `com.bobbytatum.cardmaker` |

The workflow builds and signs the IPA, then makes it available as a GitHub Actions artifact. It does not submit the build to App Store Connect. Upload the artifact using Transporter or App Store Connect after creating the matching app record. The current bundle identifier is `com.bobbytatum.cardmaker`; it must match the identifier registered to your Apple Developer account.

The **iOS Simulator and Unsigned IPA Build** workflow also produces a device-architecture `.ipa` without signing credentials. It contains the same bundled offline app and model, but must be re-signed with a valid provisioning profile before iOS can install it.

The simulator build workflow runs on pushes to this branch and pull requests targeting `main`. It checks that the app uses the local shell, local cutout model, direct device networking, and on-device offline caches.
