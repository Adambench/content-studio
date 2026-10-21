package io.github.adambench.contentstudio;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

/**
 * Where "Save to Ideas" shares go (the last personal or business page I opened in the app, which the web side keeps
 * here) and the notification that says so: "Add a note" is typed in the notification itself, "Change page" opens the
 * card in the app with its move menu. Nothing to tap if it's fine where it went.
 */
final class SavedShare {

    static final String CHANNEL = "saved";
    static final String KEY_NOTE = "note";
    private static final String PREFS = "share-target";
    /** The notification goes away on its own after this long. */
    private static final long SHOW_MS = 60_000;

    private SavedShare() {}

    static final class Target {

        final String workspaceId;
        final String name;

        Target(String workspaceId, String name) {
            this.workspaceId = workspaceId;
            this.name = name;
        }
    }

    static void setTarget(Context context, String workspaceId, String name) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("workspaceId", workspaceId).putString("name", name).apply();
    }

    @Nullable
    static Target target(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString("workspaceId", null);
        return id == null ? null : new Target(id, prefs.getString("name", "Ideas"));
    }

    /** The app at a path (contentstudio://open?path=…, which the web side follows). */
    private static PendingIntent openApp(Context context, String path, int code) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("contentstudio://open?path=" + Uri.encode(path))).setClass(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Notifications are switched on for the app (the permission, which Android 13 asks for, is checked where they're sent). */
    private static boolean canNotify(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private static void createChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL) != null) return;
        // High, so it shows over the app I'm in; no sound or buzz, it's only a receipt.
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Saved to Ideas", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Where a share went, with a note or another page if you want");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    /** "Saved to Personal brand", with Add a note and Change page. */
    static void notifySaved(Context context, Target target, String ideaId, String what) {
        if (!canNotify(context) || Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(context, "Saved to " + target.name, Toast.LENGTH_SHORT).show();
            return;
        }
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        createChannel(context);
        int code = ideaId.hashCode();
        String card = "/w/" + target.workspaceId + "/ideas?open=" + ideaId;
        Intent noteIntent = new Intent(context, SavedNoteReceiver.class).putExtra("id", ideaId).putExtra("workspaceId", target.workspaceId).putExtra("name", target.name);
        // Mutable: the typed note is added to it.
        PendingIntent notePending = PendingIntent.getBroadcast(context, code, noteIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        NotificationCompat.Action note = new NotificationCompat.Action.Builder(R.drawable.ic_stat_notify, "Add a note", notePending)
            .addRemoteInput(new RemoteInput.Builder(KEY_NOTE).setLabel("A note for it").build())
            .setAllowGeneratedReplies(false)
            .build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xff8b5cf6)
            .setContentTitle("Saved to " + target.name)
            .setContentText(what)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setTimeoutAfter(SHOW_MS)
            .setContentIntent(openApp(context, card, code + 1))
            .addAction(note)
            .addAction(R.drawable.ic_stat_notify, "Change page", openApp(context, card + "&move=1", code + 2));
        try {
            manager.notify(code, builder.build());
        } catch (SecurityException e) {
            Toast.makeText(context, "Saved to " + target.name, Toast.LENGTH_SHORT).show();
        }
    }

    /** After a note: the notification says it's on its way, then goes. */
    static void notifyNoted(Context context, String ideaId, String name) {
        if (!canNotify(context) || Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        createChannel(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xff8b5cf6)
            .setContentTitle("Saved to " + name)
            .setContentText("Note added")
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(2500);
        try {
            NotificationManagerCompat.from(context).notify(ideaId.hashCode(), builder.build());
        } catch (SecurityException ignored) {
            // Notifications were turned off in the meantime.
        }
    }
}
