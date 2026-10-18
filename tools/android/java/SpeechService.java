package app.midad.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

// Reads the chapter aloud from a foreground service, so it keeps going with the screen off.
// The page hands over paragraphs (current chapter + the next one) and gets progress back through SpeechPlugin.
public class SpeechService extends Service {
    public static final String ACT_PAUSE = "app.midad.reader.speech.PAUSE";
    public static final String ACT_RESUME = "app.midad.reader.speech.RESUME";
    public static final String ACT_STOP = "app.midad.reader.speech.STOP";
    private static final String CHANNEL = "midad_speech";
    private static final int NOTE_ID = 7711;

    public static class Item {
        public String ch, text, title; public int i;
        public Item(String ch, int i, String text, String title) { this.ch = ch; this.i = i; this.text = text; this.title = title; }
    }

    public interface Listener {
        void onProgress(String ch, int i);
        void onState(String state, String reason);
        void onMore();
    }

    // shared with the plugin
    static final List<Item> queue = new ArrayList<>();
    static int pos = 0;
    static float rate = 1f;
    static long sleepAt = 0;
    static boolean sleepEndOfChapter = false;
    static String state = "stopped";
    static Listener listener;
    static SpeechService instance;

    private TextToSpeech tts;
    private boolean ready = false;
    private boolean pendingSpeak = false;
    private int token = 0;
    private PowerManager.WakeLock wake;
    private AudioManager audio;
    private AudioFocusRequest focusReq;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable sleepCheck = new Runnable() {
        @Override public void run() {
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) { finish("sleep"); return; }
            if (sleepAt > 0) { main.postDelayed(this, 10000); updateNote(); }
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "midad:speech");
        wake.setReferenceCounted(false);
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) { finish("error"); return; }
            Locale ar = new Locale("ar");
            int r = tts.setLanguage(ar);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                try {
                    for (Voice v : tts.getVoices()) {
                        if (v.getLocale() != null && "ar".equals(v.getLocale().getLanguage())) { tts.setVoice(v); r = TextToSpeech.SUCCESS; break; }
                    }
                } catch (Exception ignored) {}
            }
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) { finish("error"); return; }
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { main.post(() -> advance(id)); }
                @Override public void onError(String id) { main.post(() -> advance(id)); }
            });
            ready = true;
            if (pendingSpeak) { pendingSpeak = false; speakCurrent(); }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        startAsForeground();
        if (ACT_PAUSE.equals(a)) pause();
        else if (ACT_RESUME.equals(a)) resume();
        else if (ACT_STOP.equals(a)) finish("user");
        else play();
        return START_NOT_STICKY;
    }

    private void startAsForeground() {
        Notification n = buildNote();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE_ID, n);
    }

    void play() {
        state = "playing";
        wake.acquire(6 * 60 * 60 * 1000L);
        requestFocus();
        main.removeCallbacks(sleepCheck);
        if (sleepAt > 0) main.postDelayed(sleepCheck, 10000);
        if (ready) speakCurrent(); else pendingSpeak = true;
        emitState(null);
        updateNote();
    }

    void pause() {
        if (!"playing".equals(state)) return;
        state = "paused";
        token++;
        if (tts != null) tts.stop();
        emitState(null);
        updateNote();
    }

    void resume() {
        if ("playing".equals(state)) return;
        play();
    }

    void setRate(float r) {
        rate = r;
        if ("playing".equals(state) && ready) { token++; tts.stop(); speakCurrent(); }
    }

    void sleepChanged() {
        main.removeCallbacks(sleepCheck);
        if (sleepAt > 0) main.postDelayed(sleepCheck, 10000);
        updateNote();
    }

    private void speakCurrent() {
        synchronized (queue) {
            if (pos >= queue.size()) { finish("end"); return; }
            Item it = queue.get(pos);
            token++;
            tts.setSpeechRate(rate);
            Bundle b = new Bundle();
            tts.speak(it.text, TextToSpeech.QUEUE_FLUSH, b, token + ":" + pos);
            if (listener != null) listener.onProgress(it.ch, it.i);
            if (queue.size() - pos < 6 && listener != null) listener.onMore();
        }
        updateNote();
    }

    private void advance(String id) {
        if (!"playing".equals(state)) return;
        if (id == null || !id.startsWith(token + ":")) return; // stale utterance
        synchronized (queue) {
            String prevCh = pos < queue.size() ? queue.get(pos).ch : null;
            pos++;
            if (sleepEndOfChapter && prevCh != null && (pos >= queue.size() || !prevCh.equals(queue.get(pos).ch))) { finish("sleep"); return; }
        }
        speakCurrent();
    }

    void finish(String reason) {
        state = "stopped";
        token++;
        main.removeCallbacks(sleepCheck);
        sleepAt = 0; sleepEndOfChapter = false;
        try { if (tts != null) tts.stop(); } catch (Exception ignored) {}
        abandonFocus();
        if (wake != null && wake.isHeld()) wake.release();
        emitState(reason);
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void emitState(String reason) { if (listener != null) listener.onState(state, reason); }

    private void requestFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setOnAudioFocusChangeListener(ch -> {
                        if (ch == AudioManager.AUDIOFOCUS_LOSS || ch == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) main.post(this::pause);
                    }).build();
            audio.requestAudioFocus(focusReq);
        }
    }

    private void abandonFocus() {
        if (audio != null && focusReq != null && Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focusReq);
    }

    private PendingIntent action(String act, int code) {
        Intent i = new Intent(this, SpeechService.class).setAction(act);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNote() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "القراءة الصوتية", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        String title = "مداد", sub = "";
        synchronized (queue) {
            if (pos < queue.size()) { Item it = queue.get(pos); title = it.title == null || it.title.isEmpty() ? "مداد" : it.title; sub = "الفقرة " + (it.i + 1); }
        }
        if (sleepEndOfChapter) sub += " · يتوقف مع نهاية الفصل";
        else if (sleepAt > 0) sub += " · يتوقف بعد " + Math.max(1, (sleepAt - System.currentTimeMillis() + 59999) / 60000) + " د";
        if ("paused".equals(state)) sub = "متوقفة مؤقتاً · " + sub;
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = open == null ? null : PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int icon = getApplicationInfo().icon;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(icon)
                .setContentTitle(title)
                .setContentText(sub)
                .setOngoing("playing".equals(state))
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT);
        if (content != null) b.setContentIntent(content);
        if ("paused".equals(state)) b.addAction(0, "متابعة", action(ACT_RESUME, 11));
        else b.addAction(0, "إيقاف مؤقت", action(ACT_PAUSE, 12));
        b.addAction(0, "إنهاء", action(ACT_STOP, 13));
        return b.build();
    }

    private void updateNote() {
        if ("stopped".equals(state)) return;
        try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE_ID, buildNote()); } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacksAndMessages(null);
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception ignored) {}
        if (wake != null && wake.isHeld()) wake.release();
        abandonFocus();
        if (!"stopped".equals(state)) { state = "stopped"; emitState("killed"); }
        super.onDestroy();
    }
}
