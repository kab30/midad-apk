package app.midad.reader;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

// JS side: Capacitor.Plugins.MidadSpeech. start/append/pause/resume/stop/setRate/setSleep/status,
// events: progress {ch,i}, state {state,reason}, more {}.
@CapacitorPlugin(name = "MidadSpeech")
public class SpeechPlugin extends Plugin implements SpeechService.Listener {

    @Override
    public void load() { SpeechService.listener = this; }

    private int addItems(JSArray arr) throws Exception {
        int n = 0;
        synchronized (SpeechService.queue) {
            for (int k = 0; k < arr.length(); k++) {
                JSONObject o = arr.getJSONObject(k);
                String t = o.optString("t", "").trim();
                if (t.isEmpty()) continue;
                SpeechService.queue.add(new SpeechService.Item(o.optString("ch"), o.optInt("i"), t, o.optString("title", "")));
                n++;
            }
        }
        return n;
    }

    private void send(String action) {
        Intent i = new Intent(getContext(), SpeechService.class);
        if (action != null) i.setAction(action);
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            JSArray items = call.getArray("items");
            if (items == null) { call.reject("no items"); return; }
            synchronized (SpeechService.queue) { SpeechService.queue.clear(); SpeechService.pos = 0; }
            if (addItems(items) == 0) { call.reject("empty"); return; }
            SpeechService.rate = call.getFloat("rate", 1f);
            int min = call.getInt("sleepMin", 0);
            SpeechService.sleepAt = min > 0 ? System.currentTimeMillis() + min * 60000L : 0;
            SpeechService.sleepEndOfChapter = Boolean.TRUE.equals(call.getBoolean("sleepEnd", false));
            send(null); // onStartCommand plays, whether the service is new or already running
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void append(PluginCall call) {
        try { JSArray items = call.getArray("items"); if (items != null) addItems(items); call.resolve(); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void pause(PluginCall call) { SpeechService s = SpeechService.instance; if (s != null) s.pause(); call.resolve(); }

    @PluginMethod
    public void resume(PluginCall call) {
        SpeechService s = SpeechService.instance;
        if (s != null) s.resume(); else if (!SpeechService.queue.isEmpty()) send(SpeechService.ACT_RESUME);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) { SpeechService s = SpeechService.instance; if (s != null) s.finish("user"); call.resolve(); }

    @PluginMethod
    public void setRate(PluginCall call) {
        float r = call.getFloat("rate", 1f);
        SpeechService s = SpeechService.instance;
        if (s != null) s.setRate(r); else SpeechService.rate = r;
        call.resolve();
    }

    @PluginMethod
    public void setSleep(PluginCall call) {
        int min = call.getInt("min", 0);
        SpeechService.sleepAt = min > 0 ? System.currentTimeMillis() + min * 60000L : 0;
        SpeechService.sleepEndOfChapter = Boolean.TRUE.equals(call.getBoolean("endOfChapter", false));
        SpeechService s = SpeechService.instance;
        if (s != null) s.sleepChanged();
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", SpeechService.state);
        synchronized (SpeechService.queue) {
            if (SpeechService.pos < SpeechService.queue.size()) {
                SpeechService.Item it = SpeechService.queue.get(SpeechService.pos);
                r.put("ch", it.ch); r.put("i", it.i);
            }
        }
        call.resolve(r);
    }

    @Override
    public void onProgress(String ch, int i) { JSObject d = new JSObject(); d.put("ch", ch); d.put("i", i); notifyListeners("progress", d, true); }

    @Override
    public void onState(String state, String reason) { JSObject d = new JSObject(); d.put("state", state); if (reason != null) d.put("reason", reason); notifyListeners("state", d, true); }

    @Override
    public void onMore() { notifyListeners("more", new JSObject(), false); }
}
