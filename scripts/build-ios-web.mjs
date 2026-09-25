import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'cardmaker-ios-web-'));
const appSource = path.join(root, 'app');
const appDestination = path.join(temp, 'app');
const apiSource = path.join(appSource, 'api');
const nextRoot = path.dirname(new URL(import.meta.resolve('next/package.json')).pathname);
const nextCli = path.join(nextRoot, 'dist/bin/next');

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Could not safely apply the native ${label} patch.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

try {
  await cp(appSource, appDestination, {
    recursive: true,
    filter: (source) => source !== apiSource && !source.startsWith(apiSource + path.sep)
  });

  const nativePagePath = path.join(appDestination, 'page.jsx');
  let nativePage = await readFile(nativePagePath, 'utf8');
  const serviceWorkerGate = "if ('serviceWorker' in navigator) {";
  if (nativePage.includes(serviceWorkerGate)) {
    nativePage = replaceExactlyOnce(
      nativePage,
      serviceWorkerGate,
      "if (window.location.protocol !== 'cardmaker:' && 'serviceWorker' in navigator) {",
      'service-worker exclusion'
    );
  } else if (!nativePage.includes('cardmaker:') || !nativePage.includes('serviceWorker')) {
    throw new Error('Could not safely disable website service workers in the native app.');
  }
  await writeFile(nativePagePath, nativePage);

  const nativeCutoutPath = path.join(appDestination, 'lib', 'aiCutout.mjs');
  let nativeCutout = await readFile(nativeCutoutPath, 'utf8');
  if (!nativeCutout.includes("env.localModelPath = '/models/';")) {
    nativeCutout = replaceExactlyOnce(
      nativeCutout,
      "    const { pipeline, env } = await import('@huggingface/transformers');\n",
      "    const { pipeline, env } = await import('@huggingface/transformers');\n" +
        "    if (typeof window !== 'undefined' && window.location.protocol === 'cardmaker:') {\n" +
        "      env.allowLocalModels = true;\n" +
        "      env.allowRemoteModels = false;\n" +
        "      env.localModelPath = '/models/';\n" +
        "    }\n",
      'local cutout model'
    );
  }
  await writeFile(nativeCutoutPath, nativeCutout);

  const staticRouteFiles = ['manifest.js', 'icon.js', 'apple-icon.js'];
  for (const route of staticRouteFiles) {
    const routePath = path.join(appDestination, route);
    const source = await readFile(routePath, 'utf8');
    const insertion = "export const dynamic = 'force-static';\n\n";
    await writeFile(routePath, source.includes(insertion.trim()) ? source : insertion + source);
  }

  // The phone bundle uses its own local Analytics-free runtime. Remove the
  // component import before compilation so Next cannot emit Vercel analytics
  // code into the IPA even though the component is not rendered.
  const nativeLayoutPath = path.join(appDestination, 'layout.js');
  let nativeLayout = await readFile(nativeLayoutPath, 'utf8');
  nativeLayout = nativeLayout
    .replace("import { Analytics } from '@vercel/analytics/next';\n", '')
    .replace("import { SpeedInsights } from '@vercel/speed-insights/next';\n", '')
    .replace("  const shouldTrackWebAnalytics = process.env.NEXT_PUBLIC_CARDMAKER_NATIVE !== '1';\n", '')
    .replace('        {shouldTrackWebAnalytics ? <Analytics /> : null}\n', '')
    .replace('        <Analytics />\n', '')
    .replace('        <SpeedInsights />\n', '');
  if (
    nativeLayout.includes('@vercel/') ||
    nativeLayout.includes('<Analytics') ||
    nativeLayout.includes('<SpeedInsights')
  ) {
    throw new Error('The native layout still references Vercel analytics or speed insights.');
  }
  await writeFile(nativeLayoutPath, nativeLayout);
  await cp(path.join(root, 'public'), path.join(temp, 'public'), { recursive: true });
  await rm(path.join(temp, 'public', 'sw.js'), { force: true });
  await cp(path.join(root, 'package.json'), path.join(temp, 'package.json'));
  await cp(path.join(root, 'package-lock.json'), path.join(temp, 'package-lock.json'));
  await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');

  await writeFile(
    path.join(temp, 'next.config.mjs'),
    `export default { output: 'export', images: { unoptimized: true } };\n`
  );

  await execFileAsync(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: temp,
    env: {
      ...process.env,
      NEXT_PUBLIC_CARDMAKER_NATIVE: '1',
      NODE_ENV: 'production'
    },
    maxBuffer: 32 * 1024 * 1024
  });

  const exportedIndex = path.join(temp, 'out', 'index.html');
  await readFile(exportedIndex);

  const bundleFiles = [];
  async function collectBundleFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await collectBundleFiles(absolutePath);
      else if (/\.(?:html|js|mjs|json)$/.test(entry.name)) bundleFiles.push(absolutePath);
    }
  }
  await collectBundleFiles(path.join(temp, 'out'));
  for (const file of bundleFiles) {
    const source = await readFile(file, 'utf8');
    if (/\bvercel\.app\b|\/_vercel\/|@vercel\//i.test(source)) {
      throw new Error(`The native web bundle contains a Vercel runtime reference: ${path.relative(temp, file)}`);
    }
  }

  const appWebRoot = path.join(root, 'ios', 'CardMaker', 'WebApp');
  await rm(appWebRoot, { recursive: true, force: true });
  await cp(path.join(temp, 'out'), appWebRoot, { recursive: true });

  const appIconDir = path.join(root, 'ios', 'CardMaker', 'Assets.xcassets', 'AppIcon.appiconset');
  await mkdir(appIconDir, { recursive: true });
  await sharp(path.join(appWebRoot, 'icon'))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(appIconDir, 'AppIcon.png'));
  await writeFile(
    path.join(appIconDir, 'Contents.json'),
    JSON.stringify({
      images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 }
    }, null, 2) + '\n'
  );

  const modelDirectory = path.join(appWebRoot, 'models', 'onnx-community', 'ormbg-ONNX');
  const modelPath = path.join(modelDirectory, 'onnx', 'model_quantized.onnx');
  try {
    const model = await readFile(modelPath);
    if (model.byteLength < 40_000_000) throw new Error('The offline cutout model is incomplete.');
    await readFile(path.join(modelDirectory, 'LICENSE.txt'));
    await readFile(path.join(modelDirectory, 'NOTICE.txt'));
  } catch {
    throw new Error('The verified offline cutout model or its license files are missing. Run scripts/download-ios-model.py before building the iOS app.');
  }

  process.stdout.write(`Bundled local web app and offline cutout model at ${path.relative(root, appWebRoot)}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
