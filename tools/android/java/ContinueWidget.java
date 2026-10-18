package app.midad.reader;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

// Home-screen widget: the chapter you're reading, with a tap to continue it.
public class ContinueWidget extends AppWidgetProvider {
    static final String PREFS = "midad_widget";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) draw(c, m, id);
    }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, ContinueWidget.class));
        for (int id : ids) draw(c, m, id);
    }

    static void draw(Context c, AppWidgetManager m, int id) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_continue);
        String title = p.getString("title", "");
        String novel = p.getString("novel", "");
        v.setTextViewText(R.id.w_title, title.isEmpty() ? "افتح مداد لتبدأ القراءة" : title);
        v.setTextViewText(R.id.w_novel, novel.isEmpty() ? "مداد" : novel);
        v.setTextViewText(R.id.w_sub, p.getString("sub", ""));
        v.setProgressBar(R.id.w_prog, 100, p.getInt("pct", 0), false);
        Intent i = new Intent(c, MainActivity.class);
        i.setAction("app.midad.reader.CONTINUE");
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 7, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.w_root, pi);
        m.updateAppWidget(id, v);
    }
}
