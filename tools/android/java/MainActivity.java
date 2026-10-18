package app.midad.reader;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

// Hands two things to the page: text shared from other apps (Share > Midad), and taps on the home-screen widget.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridge.class);
        super.onCreate(savedInstanceState);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    private void handle(Intent i) {
        if (i == null) return;
        String js = null;
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            String t = i.getStringExtra(Intent.EXTRA_TEXT);
            String s = i.getStringExtra(Intent.EXTRA_SUBJECT);
            if (t != null && !t.trim().isEmpty()) {
                js = "window.__midadIn({type:'share',text:" + JSONObject.quote(t) + ",subject:" + JSONObject.quote(s == null ? "" : s) + "})";
            }
        } else if ("app.midad.reader.CONTINUE".equals(i.getAction())) {
            js = "window.__midadIn({type:'continue'})";
        }
        if (js != null) {
            i.setAction(Intent.ACTION_MAIN); // don't replay it on rotation
            deliver(js, 0);
        }
    }

    // the page may still be loading: retry until it can take the event
    private void deliver(final String js, final int attempt) {
        if (attempt > 40) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) { deliver(js, attempt + 1); return; }
            getBridge().getWebView().evaluateJavascript(
                "(function(){if(typeof window.__midadIn!=='function')return 0;" + js + ";return 1})()",
                r -> { if (!"1".equals(r)) deliver(js, attempt + 1); });
        }, attempt == 0 ? 400 : 700);
    }
}
