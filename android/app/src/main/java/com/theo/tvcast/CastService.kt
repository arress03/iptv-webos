package com.theo.tvcast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Statut partagé entre le service et l'écran principal. */
object CastState {
    @Volatile var running = false
    @Volatile var text = "Prêt."
    @Volatile var error = false
    @Volatile var listener: (() -> Unit)? = null
    fun set(t: String, err: Boolean = false, run: Boolean = running) {
        text = t; error = err; running = run
        Handler(Looper.getMainLooper()).post { listener?.invoke() }
    }
}

class CastService : Service() {
    private val exec = Executors.newSingleThreadExecutor()
    private var sig: Signaling? = null
    private var pc: PeerConnection? = null
    private var factory: PeerConnectionFactory? = null
    private var egl: EglBase? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var helper: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var stopping = false
    private val main = Handler(Looper.getMainLooper())

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { exec.execute { shutdown(true, "Partage arrêté.", false) }; return START_NOT_STICKY }
        if (CastState.running) return START_NOT_STICKY
        val code = intent?.getStringExtra("code") ?: return START_NOT_STICKY
        val relay = intent.getStringExtra("relay") ?: Signaling.DEFAULT_RELAY
        val resultCode = intent.getIntExtra("resultCode", 0)
        @Suppress("DEPRECATION")
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("data", Intent::class.java) else intent.getParcelableExtra("data")
        if (data == null) { CastState.set("Autorisation de capture manquante.", true, false); stopSelf(); return START_NOT_STICKY }
        startForegroundNotif()   // doit précéder la capture (Android 14)
        CastState.set("Connexion au relais…", false, true)
        exec.execute { try { start(code, relay, resultCode, data) } catch (e: Throwable) { shutdown(false, "Erreur : ${e.message}", true) } }
        return START_NOT_STICKY
    }

    private fun startForegroundNotif() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("cast", "Partage d'écran", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, CastService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "cast").setContentTitle("TVCast").setContentText("Partage d'écran vers la télé")
            .setSmallIcon(android.R.drawable.ic_menu_share).setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Arrêter", stop).build()).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(1, n)
    }

    private fun start(code: String, relay: String, resultCode: Int, data: Intent) {
        val s = Signaling(relay, code, { kind, p, from -> onSignal(kind, p, from) }, { })
        sig = s
        if (!s.open()) { shutdown(false, "Relais injoignable (internet ?).", true); return }

        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())
        val e = EglBase.create(); egl = e
        val f = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(e.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(e.eglBaseContext))
            .createPeerConnectionFactory()
        factory = f

        val cb = object : MediaProjection.Callback() { override fun onStop() { exec.execute { shutdown(true, "Capture arrêtée.", false) } } }
        val cap = ScreenCapturerAndroid(data, cb); capturer = cap
        val src = f.createVideoSource(true); source = src      // true = flux d'écran (texte net)
        val h = SurfaceTextureHelper.create("capture", e.eglBaseContext); helper = h
        cap.initialize(h, applicationContext, src.capturerObserver)
        val (w, hh) = captureSize()
        cap.startCapture(w, hh, 30)
        val t = f.createVideoTrack("screen", src); track = t

        val cfg = PeerConnection.RTCConfiguration(listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()))
        cfg.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        val gathered = CountDownLatch(1)
        val p = f.createPeerConnection(cfg, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) { if (s == PeerConnection.IceGatheringState.COMPLETE) gathered.countDown() }
            override fun onIceCandidate(c: IceCandidate?) {}
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
            override fun onAddStream(s: MediaStream?) {}
            override fun onRemoveStream(s: MediaStream?) {}
            override fun onDataChannel(d: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onConnectionChange(s: PeerConnection.PeerConnectionState?) {
                when (s) {
                    PeerConnection.PeerConnectionState.CONNECTED -> CastState.set("Partage en cours sur la télé ✓", false, true)
                    PeerConnection.PeerConnectionState.FAILED -> exec.execute { shutdown(false, "Connexion impossible (réseaux différents ?).", true) }
                    PeerConnection.PeerConnectionState.CLOSED -> {}
                    else -> {}
                }
            }
        }) ?: throw RuntimeException("PeerConnection indisponible")
        pc = p
        val sender = p.addTrack(t, listOf("tvcast"))
        try { val pr = sender.getParameters(); if (pr.encodings.isNotEmpty()) { pr.encodings[0].maxBitrateBps = 6_000_000; sender.setParameters(pr) } } catch (_: Throwable) {}

        val offer = syncSdp { obs -> p.createOffer(obs, MediaConstraints()) }!!
        syncSdp { obs -> p.setLocalDescription(obs, offer) }
        gathered.await(3, TimeUnit.SECONDS)
        CastState.set("En attente de l’acceptation sur la télé (OK sur la télécommande)…", false, true)
        s.send("offer", JSONObject().put("name", "Android · " + Build.MODEL).put("sdp", p.localDescription.description))
        main.postDelayed({ if (pc != null && p.connectionState() != PeerConnection.PeerConnectionState.CONNECTED && !gotAnswer) exec.execute { shutdown(false, "Pas de réponse de la télé (code incorrect ou app fermée).", true) } }, 60000)
    }

    @Volatile private var gotAnswer = false
    private fun onSignal(kind: String, p: JSONObject, from: String) {
        when (kind) {
            "answer" -> exec.execute {
                try {
                    gotAnswer = true
                    val conn = pc ?: return@execute
                    syncSdp { obs -> conn.setRemoteDescription(obs, SessionDescription(SessionDescription.Type.ANSWER, p.getString("sdp"))) }
                } catch (e: Throwable) { shutdown(true, "Erreur : ${e.message}", true) }
            }
            "refused" -> exec.execute { shutdown(false, "La télé a refusé le partage.", true) }
            "busy" -> exec.execute { shutdown(false, "La télé est déjà utilisée par un autre appareil.", true) }
            "bye" -> exec.execute { shutdown(false, "La télé a arrêté le partage.", false) }
        }
    }

    /** Enveloppe bloquante autour des SdpObserver ; renvoie le SDP créé (ou null pour set*). */
    private fun syncSdp(call: (SdpObserver) -> Unit): SessionDescription? {
        val latch = CountDownLatch(1); var res: SessionDescription? = null; var err: String? = null
        call(object : SdpObserver {
            override fun onCreateSuccess(d: SessionDescription?) { res = d; latch.countDown() }
            override fun onSetSuccess() { latch.countDown() }
            override fun onCreateFailure(e: String?) { err = e ?: "échec"; latch.countDown() }
            override fun onSetFailure(e: String?) { err = e ?: "échec"; latch.countDown() }
        })
        if (!latch.await(10, TimeUnit.SECONDS)) throw RuntimeException("SDP : délai dépassé")
        err?.let { throw RuntimeException(it) }
        return res
    }

    @Suppress("DEPRECATION")
    private fun captureSize(): Pair<Int, Int> {
        val dm = DisplayMetrics(); (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(dm)
        val maxSide = 1280f; val scale = minOf(1f, maxSide / maxOf(dm.widthPixels, dm.heightPixels))
        fun even(v: Float) = (v.toInt() / 2) * 2
        return Pair(even(dm.widthPixels * scale), even(dm.heightPixels * scale))
    }

    @Synchronized
    private fun shutdown(notify: Boolean, msg: String, err: Boolean) {
        if (stopping) return
        stopping = true
        try { if (notify) sig?.send("bye", JSONObject()) } catch (_: Throwable) {}
        try { sig?.close() } catch (_: Throwable) {}
        try { pc?.close() } catch (_: Throwable) {}
        try { capturer?.stopCapture() } catch (_: Throwable) {}
        try { capturer?.dispose() } catch (_: Throwable) {}
        try { helper?.dispose() } catch (_: Throwable) {}
        try { track?.dispose(); source?.dispose(); pc?.dispose(); factory?.dispose(); egl?.release() } catch (_: Throwable) {}
        pc = null; capturer = null; helper = null; track = null; source = null; factory = null; egl = null; sig = null
        CastState.set(msg, err, false)
        main.post { try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Throwable) {}; stopSelf() }
    }

    override fun onDestroy() { exec.execute { shutdown(true, CastState.text, CastState.error) }; exec.shutdown(); super.onDestroy() }

    companion object { const val ACTION_STOP = "com.theo.tvcast.STOP" }
}
