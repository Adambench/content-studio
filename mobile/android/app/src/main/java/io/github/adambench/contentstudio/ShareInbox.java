package io.github.adambench.contentstudio;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * What other apps share to Content Studio (Android's share sheet). The files are copied into inbox/<id>/ and the
 * share waits there until the web side sends it to a workspace (the upload queue takes the files) or drops it.
 */
final class ShareInbox {

    private static final String TAG = "ShareInbox";
    private static final ExecutorService copier = Executors.newSingleThreadExecutor();

    @Nullable
    private static JSObject pending;

    @Nullable
    private static Consumer<JSObject> listener;

    private ShareInbox() {}

    static boolean isShare(@Nullable Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        // Opening the app from Recents replays the intent that started it; that share was already handled.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    /** Copy what the intent shares (in the background), then hand it to the listener. */
    static void receive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        List<Uri> uris = streams(intent);
        String text = joinText(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getStringExtra(Intent.EXTRA_TEXT));
        String type = intent.getType();
        copier.execute(() -> {
            LocalFiles.deleteOlderThan(LocalFiles.dir(app, "inbox"), 24 * 60 * 60 * 1000L);
            String id = UUID.randomUUID().toString();
            File dir = new File(LocalFiles.dir(app, "inbox"), id);
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            JSArray files = new JSArray();
            for (Uri uri : uris) {
                try {
                    File copy = LocalFiles.copy(app, uri, dir, type != null && !type.endsWith("/*") ? type : null);
                    String mime = app.getContentResolver().getType(uri);
                    files.put(LocalFiles.describe(copy, mime != null ? mime : LocalFiles.mimeOf(copy)));
                } catch (Exception e) {
                    Log.w(TAG, "Couldn't copy a shared file", e);
                }
            }
            if (files.length() == 0 && text == null) return;
            JSObject share = new JSObject();
            share.put("id", id);
            share.put("files", files);
            share.put("text", text);
            deliver(share);
        });
    }

    private static synchronized void deliver(JSObject share) {
        pending = share;
        if (listener != null) listener.accept(share);
    }

    static synchronized void setListener(@Nullable Consumer<JSObject> l) {
        listener = l;
    }

    @Nullable
    static synchronized JSObject pending() {
        return pending;
    }

    /** Forget the share; files the upload queue hasn't taken are deleted. */
    static synchronized void discard(Context context, String id) {
        if (pending != null && id.equals(pending.getString("id"))) pending = null;
        if (id.matches("[0-9a-f-]{36}")) LocalFiles.deleteTree(new File(LocalFiles.dir(context, "inbox"), id));
    }

    private static List<Uri> streams(Intent intent) {
        Set<Uri> uris = new LinkedHashSet<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (list != null) uris.addAll(list);
        } else {
            Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (uri != null) uris.add(uri);
        }
        // Some apps only put the files in the clip data.
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
        return new ArrayList<>(uris);
    }

    @Nullable
    private static String joinText(@Nullable String subject, @Nullable String text) {
        StringBuilder out = new StringBuilder();
        if (subject != null && !subject.trim().isEmpty() && (text == null || !text.contains(subject.trim()))) out.append(subject.trim());
        if (text != null && !text.trim().isEmpty()) {
            if (out.length() > 0) out.append('\n');
            out.append(text.trim());
        }
        return out.length() > 0 ? out.toString() : null;
    }
}
