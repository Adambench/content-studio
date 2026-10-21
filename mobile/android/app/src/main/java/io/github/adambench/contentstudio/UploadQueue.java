package io.github.adambench.contentstudio;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Files and text captures waiting to go to the computer. Each item is a JSON entry in queue/queue.json (its file
 * next to it) and a WorkManager job that runs whenever there's a network, survives the app closing and the phone
 * restarting, and resumes a half-sent file from where the server says it got to.
 */
final class UploadQueue {

    private static final String TAG = "UploadQueue";
    // Finished items stay listed for a day so the uploads sheet can say they arrived.
    private static final long KEEP_DONE_MS = 24 * 60 * 60 * 1000L;

    @Nullable
    private static UploadQueue instance;

    private final Context context;
    private final File dir;
    private final File store;
    private final List<JSONObject> items = new ArrayList<>();

    @Nullable
    private Consumer<JSArray> listener;

    private long lastProgressNotice = 0;

    private UploadQueue(Context context) {
        this.context = context.getApplicationContext();
        this.dir = LocalFiles.dir(this.context, "queue");
        this.store = new File(dir, "queue.json");
        load();
    }

    static synchronized UploadQueue get(Context context) {
        if (instance == null) instance = new UploadQueue(context);
        return instance;
    }

    synchronized void setListener(@Nullable Consumer<JSArray> l) {
        listener = l;
    }

    // ---------- adding ----------

    /** Take `files` (moved into the queue's folder) and start uploading them to the workspace. */
    synchronized void addFiles(JSArray files, String workspaceId, @Nullable String pieceId, @Nullable String assetType, String source) throws Exception {
        addFiles(files, workspaceId, pieceId, assetType, source, null);
    }

    /** `ideaId`: a picture for the Saved pile, joining (or making) that card once it's all there. */
    synchronized void addFiles(JSArray files, String workspaceId, @Nullable String pieceId, @Nullable String assetType, String source, @Nullable String ideaId) throws Exception {
        for (Object f : files.toList()) {
            JSONObject file = (JSONObject) f;
            File src = new File(file.getString("path"));
            if (!isOurs(src) || !src.isFile()) throw new IOException("Not a file this app can send: " + src.getName());
            String id = UUID.randomUUID().toString();
            File dest = new File(dir, id + extension(src.getName()));
            move(src, dest);
            JSONObject item = new JSONObject();
            item.put("id", id);
            item.put("kind", "file");
            item.put("name", file.optString("name", src.getName()));
            item.put("mime", file.optString("mime", LocalFiles.mimeOf(src)));
            item.put("size", dest.length());
            item.put("path", dest.getAbsolutePath());
            item.put("workspaceId", workspaceId);
            if (pieceId != null) item.put("pieceId", pieceId);
            if (assetType != null) item.put("assetType", assetType);
            if (ideaId != null) item.put("ideaId", ideaId);
            item.put("source", source);
            add(item);
        }
        save();
        notifyChanged();
    }

    synchronized void addText(String workspaceId, String text) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("id", UUID.randomUUID().toString());
        item.put("kind", "text");
        item.put("name", text.length() > 80 ? text.substring(0, 80) + "…" : text);
        item.put("text", text);
        item.put("size", 0);
        item.put("workspaceId", workspaceId);
        add(item);
        save();
        notifyChanged();
    }

    /**
     * A share for the Saved pile (`text`: a link or note), or a note for one already sent (`note`). Both name the card
     * by `ideaId`, so whichever reaches the computer first makes it and the other joins it.
     */
    synchronized void addSaved(String workspaceId, String ideaId, @Nullable String text, @Nullable String note) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("id", UUID.randomUUID().toString());
        item.put("kind", "saved");
        String label = note != null ? "Note: " + note : text != null ? text : "Saved";
        item.put("name", label.length() > 80 ? label.substring(0, 80) + "…" : label);
        item.put("ideaId", ideaId);
        if (text != null) item.put("text", text);
        if (note != null) item.put("note", note);
        item.put("size", 0);
        item.put("workspaceId", workspaceId);
        add(item);
        save();
        notifyChanged();
    }

    private void add(JSONObject item) throws JSONException {
        item.put("sent", 0);
        item.put("state", "waiting");
        item.put("createdAt", System.currentTimeMillis());
        items.add(item);
        schedule(item.getString("id"), ExistingWorkPolicy.KEEP);
    }

    private void schedule(String id, ExistingWorkPolicy policy) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UploadWorker.class)
            .setInputData(new Data.Builder().putString("id", id).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag("upload")
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("upload-" + id, policy, request);
    }

    // ---------- the worker's view ----------

    @Nullable
    synchronized JSONObject item(String id) {
        JSONObject item = find(id);
        if (item == null) return null;
        try {
            return new JSONObject(item.toString());
        } catch (JSONException e) {
            return null;
        }
    }

    synchronized void update(String id, String key, @Nullable Object value) {
        JSONObject item = find(id);
        if (item == null) return;
        try {
            if (value == null) item.remove(key);
            else item.put(key, value);
        } catch (JSONException ignored) {
            return;
        }
        save();
        notifyChanged();
    }

    /** Bytes the server has; saved now and then, sent to the web side at most a few times a second. */
    synchronized void progress(String id, long sent) {
        JSONObject item = find(id);
        if (item == null) return;
        try {
            item.put("sent", sent);
        } catch (JSONException ignored) {}
        long now = SystemClock.elapsedRealtime();
        if (now - lastProgressNotice > 300) {
            lastProgressNotice = now;
            notifyChanged();
        }
    }

    synchronized void markState(String id, String state, @Nullable String error) {
        JSONObject item = find(id);
        if (item == null) return;
        try {
            item.put("state", state);
            if (error == null) item.remove("error");
            else item.put("error", error);
            if ("done".equals(state)) {
                item.put("doneAt", System.currentTimeMillis());
                item.put("sent", item.optLong("size"));
                String path = item.optString("path", null);
                if (path != null) {
                    //noinspection ResultOfMethodCallIgnored
                    new File(path).delete();
                    item.remove("path");
                }
                item.remove("text");
                item.remove("note");
            }
        } catch (JSONException ignored) {}
        save();
        notifyChanged();
    }

    // ---------- from the uploads sheet ----------

    synchronized JSArray list() {
        JSArray out = new JSArray();
        long now = System.currentTimeMillis();
        boolean pruned = false;
        for (Iterator<JSONObject> it = items.iterator(); it.hasNext(); ) {
            JSONObject item = it.next();
            if ("done".equals(item.optString("state")) && now - item.optLong("doneAt") > KEEP_DONE_MS) {
                it.remove();
                pruned = true;
                continue;
            }
            JSObject o = new JSObject();
            for (String key : new String[] { "id", "kind", "name", "size", "sent", "state", "workspaceId", "createdAt" }) o.put(key, item.opt(key));
            o.put("error", item.optString("error", null));
            out.put(o);
        }
        if (pruned) save();
        return out;
    }

    synchronized void retry(String id) {
        JSONObject item = find(id);
        if (item == null || !"failed".equals(item.optString("state"))) return;
        markState(id, "waiting", null);
        schedule(id, ExistingWorkPolicy.REPLACE);
    }

    /** Cancel (or forget) one: stops its job and deletes its file. */
    synchronized void remove(String id) {
        JSONObject item = find(id);
        if (item == null) return;
        WorkManager.getInstance(context).cancelUniqueWork("upload-" + id);
        String path = item.optString("path", null);
        if (path != null) {
            //noinspection ResultOfMethodCallIgnored
            new File(path).delete();
        }
        items.remove(item);
        save();
        notifyChanged();
    }

    synchronized void clearFinished() {
        items.removeIf((item) -> "done".equals(item.optString("state")));
        save();
        notifyChanged();
    }

    /** After pairing again, give the ones that failed for want of a pairing another go. */
    synchronized void retryUnpaired() {
        for (JSONObject item : new ArrayList<>(items)) if ("failed".equals(item.optString("state")) && item.optBoolean("unpaired")) {
            item.remove("unpaired");
            retry(item.optString("id"));
        }
    }

    // ---------- storage ----------

    @Nullable
    private JSONObject find(String id) {
        for (JSONObject item : items) if (id.equals(item.optString("id"))) return item;
        return null;
    }

    private void notifyChanged() {
        if (listener != null) listener.accept(list());
    }

    private void load() {
        if (!store.isFile()) return;
        try {
            JSONArray array = new JSONArray(new String(Files.readAllBytes(store.toPath()), StandardCharsets.UTF_8));
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                // A job that was running when the app was killed is just waiting again (WorkManager reruns it).
                if ("uploading".equals(item.optString("state"))) item.put("state", "waiting");
                items.add(item);
            }
        } catch (Exception e) {
            Log.w(TAG, "Couldn't read the queue", e);
        }
    }

    private void save() {
        File tmp = new File(dir, "queue.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(new JSONArray(items).toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            Log.w(TAG, "Couldn't save the queue", e);
            return;
        }
        if (!tmp.renameTo(store)) Log.w(TAG, "Couldn't replace the queue file");
    }

    /** Only files the app put aside for sending: shared, picked or recorded. */
    private boolean isOurs(File file) {
        try {
            String path = file.getCanonicalPath();
            for (String dir : new String[] { "inbox", "picks", "recordings" }) {
                if (path.startsWith(new File(context.getFilesDir(), dir).getCanonicalPath() + File.separator)) return true;
            }
            return false;
        } catch (IOException e) {
            return false;
        }
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(dot).replaceAll("[^.A-Za-z0-9]", "") : "";
    }

    private static void move(File src, File dest) throws IOException {
        if (src.renameTo(dest)) return;
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[256 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
        }
        //noinspection ResultOfMethodCallIgnored
        src.delete();
    }
}
