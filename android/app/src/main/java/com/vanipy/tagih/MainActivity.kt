package com.vanipy.tagih

import android.app.Activity
import android.content.ContentValues
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.util.Base64
import android.util.Log
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {

    internal lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        this.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // Serve the bundled web assets over the reserved appassets domain instead
        // of file:///android_asset, which WebView restricts for targetSdk 30+.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                Log.e("tagih", "WebView error ${error.errorCode} ${error.description} for ${request.url}")
            }
        }
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun saveFile(base64Data: String, filename: String, mime: String) {
                val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_")
                val safeMime = when (mime) {
                    "application/json" -> "application/json"
                    "text/csv" -> "text/csv"
                    else -> "application/octet-stream"
                }
                Log.i("tagih", "saveFile called: $safeName ($safeMime)")
                val bytes = try {
                    Base64.decode(base64Data, Base64.DEFAULT)
                } catch (e: Exception) {
                    Log.e("tagih", "saveFile base64 decode failed", e)
                    return
                }
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(MediaStore.MediaColumns.MIME_TYPE, safeMime)
                    put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/tagih"
                    )
                }
                val uri = contentResolver.insert(
                    MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    values
                )
                Log.i("tagih", "saveFile insert uri=$uri bytes=${bytes.size}")
                val ok = uri?.let { contentResolver.openOutputStream(it) }?.use {
                    it.write(bytes)
                    true
                } ?: false
                Log.i("tagih", "saveFile write ok=$ok")
                runOnUiThread {
                    val msg = if (ok) "saved to Download/tagih/$safeName" else "save failed"
                    Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
                }
            }
        }, "TagihBridge")
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        setContentView(webView)
    }
}
