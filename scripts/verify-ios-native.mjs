import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [builder, scheme, api, webView, simulatorWorkflow, ipaWorkflow] = await Promise.all([
  read('scripts/build-ios-web.mjs'),
  read('ios/CardMaker/CardMakerSchemeHandler.swift'),
  read('ios/CardMaker/CardMakerLocalAPI.swift'),
  read('ios/CardMaker/CardMakerWebView.swift'),
  read('.github/workflows/ios-simulator-build.yml'),
  read('.github/workflows/ios-appstore-ipa.yml')
]);

const requires = (source, pattern, label) => assert.ok(pattern.test(source), label);

requires(builder, /output: 'export'/, 'The native bundle must be a static export.');
requires(builder, /source !== apiSource/, 'Server API routes must be excluded from the bundled UI.');
requires(builder, /Analytics/, 'The exporter must strip website analytics.');
requires(builder, /SpeedInsights/, 'The exporter must strip website performance telemetry.');
requires(builder, /vercel\\\.app/, 'The exporter must reject Vercel runtime references.');
requires(builder, /model_quantized\.onnx/, 'The exporter must require bundled model weights.');
requires(builder, /LICENSE\.txt/, 'The exporter must require the model license.');
requires(builder, /window\.location\.protocol !== 'cardmaker:'/ , 'The native build must skip the website service worker.');
requires(builder, /window\.location\.protocol === 'cardmaker:'/ , 'The native build must detect its local scheme.');
requires(builder, /env\.allowRemoteModels = false/, 'The packaged cutout model must never download at runtime.');
requires(builder, /env\.localModelPath = '\/models\//, 'The cutout pipeline must read model files from the app bundle.');
requires(builder, /force-static/, 'App metadata routes must be exported into the local app bundle.');
requires(scheme, /WKURLSchemeHandler/, 'The iOS host must serve the local app scheme.');
requires(scheme, /CardMakerLocalAPI\.shared\.handle/, 'The local URL scheme must intercept its API routes.');
requires(webView, /WKScriptMessageHandler/, 'The iOS host must expose a native script bridge.');
requires(webView, /UIActivityViewController/, 'PNG exports must use the native iOS share sheet.');

for (const route of ['/api/cucu', '/api/animedeskmat', '/api/image']) {
  assert.ok(api.includes(`case "${route}"`), `Native URL scheme must handle ${route}`);
}
requires(api, /RedirectAllowlist\.isAllowed/, 'All native network requests must stay inside HTTPS host allowlists.');
requires(api, /"offline": true/, 'Uncached catalog requests must fail into an offline-safe response.');
requires(api, /store\(response\.data, kind: "catalog"/, 'Successful catalogs must persist on-device.');
requires(api, /store\(data, kind: "images"/, 'Downloaded artwork must persist on-device.');
requires(simulatorWorkflow, /macos-26/, 'The simulator build must run on an Apple build runner.');
requires(ipaWorkflow, /app-store-connect/, 'The signed archive workflow must export an App Store IPA.');
requires(ipaWorkflow, /APPSTORE_CERTIFICATE_P12_BASE64/, 'The signed IPA must use a supplied Apple Distribution certificate.');

process.stdout.write('Native iOS contract verified: local app shell, on-device cutout, direct networking, and persistent offline caches.\n');
