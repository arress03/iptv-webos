package com.theo.tvcast

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Écran unique, construit en code (pas de XML) : code de la télé, bouton Partager / Arrêter, statut. */
class MainActivity : Activity() {
    private lateinit var codeInput: EditText
    private lateinit var go: Button
    private lateinit var status: TextView
    private var formatting = false

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad); setBackgroundColor(Color.parseColor("#0B0D12")) }
        fun tv(t: String, size: Float, color: String, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(Color.parseColor(color)); if (bold) setTypeface(typeface, Typeface.BOLD)
        }
        root.addView(tv("TVCast", 30f, "#EEF1F7", true))
        root.addView(tv("Partage l’écran de ce téléphone sur la télé.\nSur la télé : ouvre l’app TVCast et note le code.", 15f, "#8F98AB"))
        codeInput = EditText(this).apply {
            hint = "ABCD EFGH"; textSize = 30f; gravity = Gravity.CENTER; typeface = Typeface.MONOSPACE
            setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#4A5266")); setBackgroundColor(Color.parseColor("#1B2130"))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.LengthFilter(9)); setPadding(pad, pad, pad, pad)
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
                override fun afterTextChanged(e: android.text.Editable?) {
                    if (formatting || e == null) return
                    val raw = e.toString().filter { it.isLetterOrDigit() }.uppercase().take(8)
                    val fmt = if (raw.length > 4) raw.substring(0, 4) + " " + raw.substring(4) else raw
                    if (fmt != e.toString()) { formatting = true; e.replace(0, e.length, fmt); formatting = false }
                }
            })
        }
        val lp = LinearLayout.LayoutParams(-1, -2).apply { topMargin = pad * 2 }
        root.addView(codeInput, lp)
        go = Button(this).apply { textSize = 18f; setOnClickListener { onGo() } }
        root.addView(go, LinearLayout.LayoutParams(-1, -2).apply { topMargin = pad })
        status = tv("", 16f, "#8F98AB").apply { setPadding(0, pad, 0, 0) }
        root.addView(status)
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        CastState.listener = { refresh() }
        refresh()
    }

    private fun refresh() {
        go.text = if (CastState.running) "Arrêter le partage" else "Partager l’écran"
        codeInput.isEnabled = !CastState.running
        status.text = CastState.text
        status.setTextColor(Color.parseColor(if (CastState.error) "#FF6B6B" else if (CastState.text.contains("✓")) "#4CD68D" else "#8F98AB"))
    }

    private fun onGo() {
        if (CastState.running) { startService(Intent(this, CastService::class.java).setAction(CastService.ACTION_STOP)); return }
        val code = codeInput.text.toString().filter { it.isLetterOrDigit() }.uppercase()
        if (code.length != 8) { CastState.set("Entre le code à 8 caractères affiché sur la télé.", true, false); return }
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ) return
        if (resultCode != RESULT_OK || data == null) { CastState.set("Partage annulé.", false, false); return }
        val code = codeInput.text.toString().filter { it.isLetterOrDigit() }.uppercase()
        val i = Intent(this, CastService::class.java).putExtra("code", code).putExtra("resultCode", resultCode).putExtra("data", data)
        startForegroundService(i)
    }

    override fun onDestroy() { CastState.listener = null; super.onDestroy() }
    companion object { const val REQ = 42 }
}
