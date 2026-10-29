package com.theo.tvcast

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Même protocole que shared/rtcsig.js : relais ntfy, messages découpés en morceaux < 4 Ko. */
class Signaling(
    base: String,
    code: String,
    private val onMessage: (kind: String, payload: JSONObject, from: String) -> Unit,
    private val onLink: (Boolean) -> Unit,
) {
    private val base = base.trimEnd('/')
    private val topic = "tvcast-" + code.uppercase()
    val sid: String = randomId(8)
    @Volatile private var stopped = false
    @Volatile private var last = ""
    @Volatile private var conn: HttpURLConnection? = null
    private class Asm(val n: Int) { val parts = arrayOfNulls<String>(n); var count = 0 }
    private val asm = HashMap<String, Asm>()

    /** Ouvre l'abonnement et attend que le flux soit établi (ou échec/timeout). */
    fun open(): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        Thread {
            var first = true
            while (!stopped) {
                try {
                    val q = if (last.isNotEmpty()) "?since=$last" else ""
                    val c = URL("$base/$topic/json$q").openConnection() as HttpURLConnection
                    c.connectTimeout = 10000; c.readTimeout = 0
                    conn = c
                    if (c.responseCode != 200) throw RuntimeException("relais HTTP ${c.responseCode}")
                    onLink(true)
                    if (first) { first = false; ok = true; latch.countDown() }
                    c.inputStream.bufferedReader().use { r ->
                        while (!stopped) {
                            val line = r.readLine() ?: break
                            if (line.isNotBlank()) handleLine(line)
                        }
                    }
                } catch (e: Exception) {
                    if (stopped) break
                    onLink(false)
                    if (first) { first = false; latch.countDown() }
                }
                if (!stopped) try { Thread.sleep(2500) } catch (_: InterruptedException) { break }
            }
        }.also { it.isDaemon = true; it.start() }
        latch.await(12, TimeUnit.SECONDS)
        return ok
    }

    private fun handleLine(line: String) {
        try {
            val o = JSONObject(line)
            o.optString("id").takeIf { it.isNotEmpty() }?.let { last = it }
            if (o.optString("event") != "message") return
            val m = JSONObject(o.optString("message"))
            if (m.optString("r") == "s") return
            val t = m.optString("t", "")
            if (t.isNotEmpty() && t != sid) return
            val key = m.getString("s") + ":" + m.getString("k")
            val n = m.getInt("n"); val i = m.getInt("i")
            val done: String? = synchronized(asm) {
                val a = asm.getOrPut(key) { Asm(n) }
                if (i < a.n && a.parts[i] == null) { a.parts[i] = m.getString("d"); a.count++ }
                if (a.count >= a.n) { asm.remove(key); a.parts.joinToString("") } else null
            }
            if (done != null) onMessage(m.getString("k"), JSONObject(done), m.getString("s"))
        } catch (_: Exception) { }
    }

    /** Bloquant : à appeler hors du thread principal. */
    fun send(kind: String, obj: JSONObject, to: String? = null) {
        val s = obj.toString()
        val n = maxOf(1, (s.length + CHUNK - 1) / CHUNK)
        for (i in 0 until n) {
            val j = JSONObject().put("r", "s").put("s", sid).put("k", kind).put("i", i).put("n", n)
                .put("d", s.substring(i * CHUNK, minOf(s.length, (i + 1) * CHUNK)))
            if (to != null) j.put("t", to)
            post(j.toString())
        }
    }

    private fun post(body: String) {
        var err: Exception? = null
        repeat(3) {
            try {
                val c = URL("$base/$topic").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10000; c.readTimeout = 10000
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = c.responseCode; c.disconnect()
                if (code in 200..299) return
                err = RuntimeException("relais HTTP $code")
            } catch (e: Exception) { err = e }
            try { Thread.sleep(1200) } catch (_: InterruptedException) { }
        }
        throw err ?: RuntimeException("envoi impossible")
    }

    fun close() { stopped = true; try { conn?.disconnect() } catch (_: Exception) { } }

    companion object {
        const val CHUNK = 2400
        const val DEFAULT_RELAY = "https://ntfy.sh"
        private const val ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        fun randomId(n: Int): String { val r = SecureRandom(); return buildString { repeat(n) { append(ALPHA[r.nextInt(ALPHA.length)]) } } }
    }
}
