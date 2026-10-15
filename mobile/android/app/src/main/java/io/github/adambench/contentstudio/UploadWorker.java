package io.github.adambench.contentstudio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sends one queued item to the computer: a text capture in one request, a file through the server's resumable
 * uploads (POST /api/uploads, then PATCH chunks from the offset the server reports). Network trouble and server
 * errors are retried by WorkManager with growing pauses; what retrying can't fix marks the item failed.
 */
public class UploadWorker extends Worker {

    private static final String TAG = "UploadWorker";
    private static final long CHUNK = 8L * 1024 * 1024;
    // Small files finish quickly; bigger ones show a notification and run as a foreground job.
    private static final long FOREGROUND_FROM = 5L * 1024 * 1024;
    static final String CHANNEL = "uploads";
    private static final MediaType JSON = MediaType.get("application/json");
    private static final MediaType OCTETS = MediaType.get("application/offset+octet-stream");

    private static final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build();

    /** Won't work until something changes (the message is shown on the item). */
    private static class Permanent extends Exception {

        final boolean unpaired;

        Permanent(String message, boolean unpaired) {
            super(message);
            this.unpaired = unpaired;
        }
    }

    private final UploadQueue queue;
    private final String id;

    public UploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
        queue = UploadQueue.get(context);
        id = params.getInputData().getString("id");
    }

    @NonNull
    @Override
    public Result doWork() {
        JSONObject item = id == null ? null : queue.item(id);
        if (item == null || "done".equals(item.optString("state"))) return Result.success();
        queue.markState(id, "uploading", null);
        try {
            Pairing pairing = Pairing.read(getApplicationContext());
            if (pairing == null) throw new Permanent("Pair the app with your computer, then try again.", true);
            if ("text".equals(item.optString("kind"))) sendText(pairing, item);
            else sendFile(pairing, item);
            queue.markState(id, "done", null);
            return Result.success();
        } catch (Permanent e) {
            queue.markState(id, "failed", e.getMessage());
            if (e.unpaired) queue.update(id, "unpaired", true);
            return Result.success();
        } catch (Exception e) {
            // Offline, the computer asleep, the server restarting…: wait and carry on from where it got to.
            Log.i(TAG, "Will retry " + id + ": " + e.getMessage());
            queue.markState(id, "waiting", null);
            return Result.retry();
        }
    }

    private void sendText(Pairing pairing, JSONObject item) throws Exception {
        JSONObject body = new JSONObject().put("text", item.getString("text"));
        try (Response res = call(pairing, "POST", "/api/workspaces/" + item.getString("workspaceId") + "/capture", RequestBody.create(body.toString(), JSON))) {
            check(res);
        }
    }

    private void sendFile(Pairing pairing, JSONObject item) throws Exception {
        File file = new File(item.optString("path"));
        long size = item.getLong("size");
        if (!file.isFile() || file.length() != size) throw new Permanent("The file on this phone is gone.", false);
        if (size >= FOREGROUND_FROM) showProgress(item.optString("name"), 0);

        long offset = -1;
        String uploadId = item.optString("uploadId", null);
        if (uploadId != null) {
            // Carrying on: ask the server how much it has.
            try (Response res = call(pairing, "GET", "/api/uploads/" + uploadId, null)) {
                if (res.code() == 404) uploadId = null;
                else {
                    JSONObject state = check(res);
                    if (!state.isNull("mediaId")) return;
                    offset = state.getLong("offset");
                }
            }
        }
        if (uploadId == null) {
            JSONObject start = new JSONObject()
                .put("workspaceId", item.getString("workspaceId"))
                .put("pieceId", item.opt("pieceId"))
                .put("assetType", item.opt("assetType"))
                .put("source", item.optString("source", "upload"))
                .put("name", item.getString("name"))
                .put("mime", item.optString("mime", "application/octet-stream"))
                .put("size", size);
            try (Response res = call(pairing, "POST", "/api/uploads", RequestBody.create(start.toString(), JSON))) {
                uploadId = check(res).getString("id");
            }
            queue.update(id, "uploadId", uploadId);
            offset = 0;
        }

        while (offset < size) {
            if (isStopped()) throw new IOException("Stopped");
            long length = Math.min(CHUNK, size - offset);
            Request request = new Request.Builder()
                .url(pairing.server + "/api/uploads/" + uploadId)
                .header("Authorization", "Bearer " + pairing.token)
                .header("Upload-Offset", String.valueOf(offset))
                .patch(new Chunk(file, offset, length, size))
                .build();
            try (Response res = http.newCall(request).execute()) {
                if (res.code() == 409) {
                    // Out of step (a retry overtook a slow request): go on from where the server is.
                    JSONObject state = json(res);
                    if (state.has("offset")) offset = state.getLong("offset");
                    else throw new IOException("Upload busy");
                    continue;
                }
                if (res.code() == 404) {
                    // Expired on the server (a week untouched): start again.
                    queue.update(id, "uploadId", null);
                    throw new IOException("Upload expired");
                }
                JSONObject state = check(res);
                offset = state.getLong("offset");
                queue.progress(id, offset);
                if (!state.isNull("mediaId")) return;
            }
        }
    }

    /** One chunk of the file as a request body, reporting progress as it's written. */
    private class Chunk extends RequestBody {

        private final File file;
        private final long offset;
        private final long length;
        private final long size;

        Chunk(File file, long offset, long length, long size) {
            this.file = file;
            this.offset = offset;
            this.length = length;
            this.size = size;
        }

        @Override
        public MediaType contentType() {
            return OCTETS;
        }

        @Override
        public long contentLength() {
            return length;
        }

        @Override
        public void writeTo(@NonNull BufferedSink sink) throws IOException {
            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                raf.seek(offset);
                byte[] buffer = new byte[64 * 1024];
                long written = 0;
                long reported = 0;
                while (written < length) {
                    int n = raf.read(buffer, 0, (int) Math.min(buffer.length, length - written));
                    if (n < 0) throw new IOException("File ended early");
                    sink.write(buffer, 0, n);
                    written += n;
                    if (written - reported >= 512 * 1024 || written == length) {
                        reported = written;
                        queue.progress(id, offset + written);
                        if (size >= FOREGROUND_FROM) showProgress(null, (int) ((offset + written) * 100 / size));
                    }
                }
            }
        }
    }

    private static Response call(Pairing pairing, String method, String path, @Nullable RequestBody body) throws IOException {
        Request request = new Request.Builder().url(pairing.server + path).header("Authorization", "Bearer " + pairing.token).method(method, body).build();
        return http.newCall(request).execute();
    }

    /** The response's JSON if it succeeded; otherwise what kind of failure it was. */
    private static JSONObject check(Response res) throws Exception {
        JSONObject body = json(res);
        if (res.isSuccessful()) return body;
        String error = body.optString("error", "HTTP " + res.code());
        if (res.code() == 401) throw new Permanent("This phone isn’t paired any more. Pair it again, then try again.", true);
        if (res.code() == 400 || res.code() == 403 || res.code() == 404 || res.code() == 413) throw new Permanent(error, false);
        throw new IOException(error);
    }

    private static JSONObject json(Response res) {
        try {
            String text = res.body() != null ? res.body().string() : "";
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (IOException | JSONException e) {
            return new JSONObject();
        }
    }

    // ---------- the progress notification ----------

    @Nullable
    private String title;

    private int lastPercent = -1;

    private void showProgress(@Nullable String name, int percent) {
        if (name != null) title = name;
        if (percent == lastPercent) return;
        lastPercent = percent;
        Context context = getApplicationContext();
        createChannel(context);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title != null ? "Uploading " + title : "Uploading")
            .setContentText(percent + "%")
            .setProgress(100, percent, false)
            .setOngoing(true)
            .setSilent(true)
            .setColor(0xff8b5cf6)
            .build();
        int notificationId = id.hashCode();
        ForegroundInfo info = Build.VERSION.SDK_INT >= 29
            ? new ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            : new ForegroundInfo(notificationId, notification);
        try {
            // Keeps a long upload alive with the app closed. Android 12+ may refuse this when the job starts in the
            // background; then it runs as a plain job and, if stopped, the next run resumes it.
            setForegroundAsync(info);
        } catch (RuntimeException e) {
            Log.i(TAG, "No foreground service: " + e.getMessage());
        }
    }

    static void createChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Uploads", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Files going to your computer");
        manager.createNotificationChannel(channel);
    }
}
