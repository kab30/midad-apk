package app.midad.reader;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The page calls MidadWidget.update({...}) with the chapter being read; the widget shows it.
@CapacitorPlugin(name = "MidadWidget")
public class WidgetBridge extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        Context c = getContext();
        SharedPreferences.Editor e = c.getSharedPreferences(ContinueWidget.PREFS, Context.MODE_PRIVATE).edit();
        e.putString("title", call.getString("title", ""));
        e.putString("novel", call.getString("novel", ""));
        e.putString("sub", call.getString("sub", ""));
        Integer pct = call.getInt("pct", 0);
        e.putInt("pct", pct == null ? 0 : pct);
        e.apply();
        ContinueWidget.refreshAll(c);
        call.resolve();
    }
}
