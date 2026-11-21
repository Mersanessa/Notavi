package app.notavi.reader

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Lets the Android system installer open an APK that Notavi downloaded into its own cache. */
class NotaviApkProvider : FileProvider()

/**
 * "Update available" for the Android app: downloads the new APK from Notavi's own website into the app's cache,
 * reporting progress to the page, then opens Android's install screen. Only Notavi's update address is accepted.
 */
class NotaviUpdater(private val activity: Activity, private val webView: WebView) {
    @Volatile private var busy = false

    @JavascriptInterface
    fun download(url: String) {
        if (busy) return
        if (!url.startsWith(PREFIX) || !url.endsWith(".apk") || url.contains("..")) {
            emit("error", "That isn't a Notavi update.")
            return
        }
        busy = true
        Thread {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "notavi-update.apk")
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    useCaches = false
                }
                try {
                    conn.connect()
                    if (conn.responseCode !in 200..299) throw IOException("The update couldn't be downloaded (${conn.responseCode}).")
                    val total = conn.contentLengthLong
                    var done = 0L
                    var last = -1
                    conn.inputStream.use { input ->
                        FileOutputStream(file).use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) {
                                    val pct = (done * 100 / total).toInt()
                                    if (pct != last) {
                                        last = pct
                                        emit("progress", pct.toString())
                                    }
                                }
                            }
                        }
                    }
                    if (total > 0 && done != total) throw IOException("The download was cut short. Try again.")
                } finally {
                    conn.disconnect()
                }
                activity.runOnUiThread { install(file) }
            } catch (e: Exception) {
                emit("error", e.message ?: "The update couldn't be downloaded.")
            } finally {
                busy = false
            }
        }.start()
    }

    private fun install(file: File) {
        try {
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".notaviapk", file)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            emit("installing", "")
        } catch (e: Exception) {
            emit("error", e.message ?: "Android's installer couldn't be opened.")
        }
    }

    private fun emit(kind: String, detail: String) {
        val js = "window.__notaviUpdate && window.__notaviUpdate(${JSONObject.quote(kind)}, ${JSONObject.quote(detail)})"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    companion object {
        const val PREFIX = "https://mersanessa.github.io/Notavi/android/"
    }
}
