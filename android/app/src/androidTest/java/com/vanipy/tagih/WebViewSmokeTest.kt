package com.vanipy.tagih

import android.provider.MediaStore
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WebViewSmokeTest {

    @get:Rule
    val rule = ActivityScenarioRule(MainActivity::class.java)

    private fun evalJs(js: String): String {
        val latch = CountDownLatch(1)
        var result = "null"
        rule.scenario.onActivity { activity ->
            activity.runOnUiThread {
                activity.webView.evaluateJavascript(js) { v ->
                    result = v ?: "null"
                    latch.countDown()
                }
            }
        }
        latch.await(15, TimeUnit.SECONDS)
        return result
    }

    @Test
    fun pageLoadsAndBridgeSavesExportToDownloads() {
        // 1. The bundled web app loads and its JS runs on a real Android WebView.
        var title = ""
        for (i in 1..20) {
            title = evalJs("document.title")
            if (title.contains("tagih")) break
            Thread.sleep(500)
        }
        assertTrue("page title did not load, got: $title", title.contains("tagih"))

        // 2. The core logic runs on the device: create an invoice, check totals.
        val total = evalJs(
            """(function(){var C=window.TagihCore;var i=C.normInvoice({""" +
            """client:"PT Uji",currency:"IDR",issued:"2026-11-01",due:"2026-11-15",""" +
            """items:[{desc:"uji",qty:2,price_minor:1000}]});return C.totals(i).total;})()"""
        )
        assertTrue("core totals wrong on device: $total", total == "2000")

        // 3. The export path calls the real TagihBridge and the JSON backup lands
        //    in MediaStore Downloads (scoped storage), the same path a user save takes.
        val name = evalJs("window.tagihExport('json')").trim('"')
        assertTrue("export returned no filename: $name", name.startsWith("tagih-backup-"))
        val projection = arrayOf(MediaStore.MediaColumns._ID)
        val selection = "${MediaStore.MediaColumns.DISPLAY_NAME} = ?"
        val args = arrayOf(name)
        var found = false
        for (i in 1..20) {
            rule.scenario.onActivity { activity ->
                activity.contentResolver.query(
                    MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    projection, selection, args, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        found = true
                        val id = cursor.getLong(0)
                        activity.contentResolver.delete(
                            MediaStore.Files.getContentUri(
                                MediaStore.VOLUME_EXTERNAL_PRIMARY),
                            "${MediaStore.MediaColumns._ID} = ?",
                            arrayOf(id.toString()))
                    }
                }
            }
            if (found) break
            Thread.sleep(500)
        }
        assertTrue("$name was not found in MediaStore Downloads", found)
    }
}
