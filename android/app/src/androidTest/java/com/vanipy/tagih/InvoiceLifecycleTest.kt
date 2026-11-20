package com.vanipy.tagih

import android.provider.MediaStore
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/* Drives the real page UI handlers (same code paths as taps) through a full
   synthetic invoice lifecycle: create -> sent -> partial payment -> full
   payment -> archive -> unarchive -> CSV export saved via the bridge. */
@RunWith(AndroidJUnit4::class)
class InvoiceLifecycleTest {

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
        return result.trim('"')
    }

    private fun waitFor(js: String, want: (String) -> Boolean, what: String): String {
        var v = ""
        for (i in 1..20) {
            v = evalJs(js)
            if (want(v)) return v
            Thread.sleep(500)
        }
        throw AssertionError("$what; last value: $v")
    }

    @Test
    fun fullInvoiceLifecycleOnDevice() {
        // page ready
        waitFor("document.title", { it.contains("tagih") }, "page title never loaded")

        // 1. create: open the form, fill it, save
        evalJs("document.getElementById('btn-new').click(); 'ok'")
        assertEquals("false", evalJs("document.getElementById('ov-form').hidden"))
        evalJs("""(function(){
            var c=document.getElementById('f-client');
            c.value='PT Uji Runtime'; c.dispatchEvent(new Event('input'));
            var d=document.querySelector('#f-items input[data-k="desc"]');
            d.value='Jasa uji siklus'; d.dispatchEvent(new Event('input'));
            var p=document.querySelector('#f-items input[data-k="price"]');
            p.value='1000000'; p.dispatchEvent(new Event('input'));
            return 'ok';})()""")
        evalJs("document.getElementById('f-save').click(); 'ok'")
        waitFor(
            "document.querySelectorAll('#list .card').length",
            { it == "1" }, "invoice card never appeared in the list")

        // 2. open detail, mark sent
        evalJs("document.querySelector('#list .card').click(); 'ok'")
        evalJs("document.getElementById('d-sent').click(); 'ok'")
        waitFor("document.querySelector('#list .chip').textContent",
            { it == "sent" }, "status never became sent")

        // 3. partial payment of 400000
        evalJs("document.querySelector('#list .card').click(); 'ok'")
        evalJs("""(function(){
            var a=document.getElementById('pay-amount');
            a.value='400000'; return 'ok';})()""")
        evalJs("document.getElementById('d-addpay').click(); 'ok'")
        waitFor("document.querySelector('#list .chip').textContent",
            { it == "partial" }, "status never became partial")

        // 4. remaining 600000 (prefilled outstanding) completes the invoice
        evalJs("document.querySelector('#list .card').click(); 'ok'")
        waitFor("document.getElementById('pay-amount').value",
            { it == "600000" }, "outstanding prefill wrong")
        evalJs("document.getElementById('d-addpay').click(); 'ok'")
        waitFor("document.querySelector('#list .chip').textContent",
            { it == "paid" }, "status never became paid")

        // 5. archive: active list empties, archived view shows the invoice
        evalJs("document.querySelector('#list .card').click(); 'ok'")
        evalJs("document.getElementById('d-arch').click(); 'ok'")
        waitFor("document.querySelectorAll('#list .card').length",
            { it == "0" }, "archived invoice still in the active list")
        evalJs("document.getElementById('btn-menu').click(); 'ok'")
        evalJs("document.getElementById('m-arch').click(); 'ok'")
        waitFor("document.querySelectorAll('#list .card').length",
            { it == "1" }, "archived invoice not visible in archived view")

        // 6. unarchive (restore), back on the active list
        evalJs("document.querySelector('#list .card').click(); 'ok'")
        evalJs("document.getElementById('d-unarch').click(); 'ok'")
        evalJs("document.getElementById('btn-menu').click(); 'ok'")
        evalJs("document.getElementById('m-arch').click(); 'ok'")
        waitFor("document.querySelectorAll('#list .card').length",
            { it == "1" }, "restored invoice not back on the active list")

        // 7. CSV export through the real bridge; verify CONTENT in MediaStore
        val name = evalJs("window.tagihExport('csv-inv')")
        assertTrue("no csv filename: $name", name.startsWith("tagih-invoices-"))
        var content: String? = null
        for (i in 1..20) {
            rule.scenario.onActivity { activity ->
                activity.contentResolver.query(
                    MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    arrayOf(MediaStore.MediaColumns._ID),
                    "${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
                    arrayOf(name), null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val id = cursor.getLong(0)
                        val uri = android.content.ContentUris.withAppendedId(
                            MediaStore.Files.getContentUri(
                                MediaStore.VOLUME_EXTERNAL_PRIMARY), id)
                        content = activity.contentResolver.openInputStream(uri)
                            ?.bufferedReader()?.readText()
                        activity.contentResolver.delete(
                            MediaStore.Files.getContentUri(
                                MediaStore.VOLUME_EXTERNAL_PRIMARY),
                            "${MediaStore.MediaColumns._ID} = ?",
                            arrayOf(id.toString()))
                    }
                }
            }
            if (content != null) break
            Thread.sleep(500)
        }
        assertTrue("CSV never landed in MediaStore", content != null)
        assertTrue("CSV missing client row: $content",
            content!!.contains("PT Uji Runtime"))
        assertTrue("CSV missing paid status: $content",
            content!!.contains("paid"))
    }
}
