// Adds the in-app updater to the generated Android project (src-tauri/gen/android, made by `tauri android init`):
// the Kotlin updater next to MainActivity, a hook that hands it to the WebView, the install permission and a
// file provider for the downloaded APK. Run in CI after `tauri android init`.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = 'src-tauri/gen/android/app/src/main';
const find = (dir, name) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      const r = find(p, name);
      if (r) return r;
    } else if (f === name) return p;
  }
  return null;
};

const main = find(join(root, 'java'), 'MainActivity.kt');
if (!main) throw new Error('MainActivity.kt not found');
copyFileSync('src-tauri/android-extra/NotaviUpdater.kt', join(dirname(main), 'NotaviUpdater.kt'));
let act = readFileSync(main, 'utf8');
if (!act.includes('NotaviUpdater')) {
  const end = act.lastIndexOf('}');
  act =
    act.slice(0, end) +
    `
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(NotaviUpdater(this, webView), "NotaviUpdater")
  }
` +
    act.slice(end);
  writeFileSync(main, act);
}

mkdirSync(join(root, 'res/xml'), { recursive: true });
copyFileSync('src-tauri/android-extra/notavi_apk_paths.xml', join(root, 'res/xml/notavi_apk_paths.xml'));

const mf = join(root, 'AndroidManifest.xml');
let m = readFileSync(mf, 'utf8');
if (!m.includes('REQUEST_INSTALL_PACKAGES')) {
  m = m.replace(/<application/, '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application');
  m = m.replace(
    /<\/application>/,
    `    <provider
            android:name="app.notavi.reader.NotaviApkProvider"
            android:authorities="\${applicationId}.notaviapk"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/notavi_apk_paths" />
        </provider>
    </application>`,
  );
  writeFileSync(mf, m);
}
console.log('Added the in-app updater to', main);
