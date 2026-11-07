package io.github.adambench.contentstudio;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.webkit.WebResourceResponse;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Videos saved to the phone. Android's downloads fetch them from the computer (with the device token, a notification
 * while it goes, carrying on with the app closed) into the gallery's Movies/Content Studio; which download holds which
 * video is kept here, so the app plays its own copy afterwards, offline too (StudioWebViewClient → serve).
 */
final class Downloads {

    private static final String TAG = "Downloads";
    private static final String PREFS = "downloads";
    private static final String FOLDER = "Content Studio";

    private Downloads() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static DownloadManager manager(Context context) {
        return (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
    }

    /** No characters a file name can't hold. */
    private static String fileName(String name) {
        String clean = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "-").trim();
        if (clean.isEmpty()) clean = "Video";
        if (!clean.toLowerCase().endsWith(".mp4")) clean += ".mp4";
        return clean;
    }

    /** Start saving a video (a running one is left to finish). */
    static synchronized void start(Context context, Pairing pairing, String mediaId, String name) {
        DownloadManager dm = manager(context);
        long existing = prefs(context).getLong(mediaId, -1);
        if (existing >= 0) {
            String state = state(dm, existing);
            // Already on its way, or saved (removing a download deletes its file).
            if ("running".equals(state) || ("done".equals(state) && exists(dm, existing))) return;
            if (state != null) dm.remove(existing);
        }

        String file = fileName(name);
        Uri url = Uri.parse(pairing.server.replaceAll("/+$", "") + "/api/media/" + Uri.encode(mediaId) + "/file");
        DownloadManager.Request request = new DownloadManager.Request(url)
            .addRequestHeader("Authorization", "Bearer " + pairing.token)
            .setTitle(file)
            .setDescription("Content Studio")
            .setMimeType("video/mp4")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        boolean inGallery = false;
        // The gallery's Movies folder needs no permission from Android 10; before that the copy stays the app's own.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_MOVIES, FOLDER + "/" + file);
                inGallery = true;
            } catch (IllegalStateException e) {
                Log.w(TAG, "No Movies folder, keeping the video in the app's own", e);
            }
        }
        if (!inGallery) request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, file);
        long id = dm.enqueue(request);
        prefs(context).edit().putLong(mediaId, id).apply();
    }

    /** running, done, failed, or null when Android no longer has it. */
    @Nullable
    private static String state(DownloadManager dm, long id) {
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (c == null || !c.moveToFirst()) return null;
            return state(c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)));
        }
    }

    private static String state(int status) {
        if (status == DownloadManager.STATUS_SUCCESSFUL) return "done";
        if (status == DownloadManager.STATUS_FAILED) return "failed";
        return "running";
    }

    /** The saved and saving videos. One whose file was deleted (from the gallery) is forgotten. */
    static synchronized JSArray list(Context context) {
        JSArray out = new JSArray();
        Map<String, ?> all = prefs(context).getAll();
        if (all.isEmpty()) return out;
        DownloadManager dm = manager(context);
        Map<Long, String> byId = new HashMap<>();
        for (Map.Entry<String, ?> e : all.entrySet()) if (e.getValue() instanceof Long) byId.put((Long) e.getValue(), e.getKey());
        long[] ids = new long[byId.size()];
        int i = 0;
        for (Long id : byId.keySet()) ids[i++] = id;

        List<String> gone = new ArrayList<>(all.keySet());
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(ids))) {
            while (c != null && c.moveToNext()) {
                long id = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                String mediaId = byId.get(id);
                if (mediaId == null) continue;
                String state = state(c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)));
                if ("done".equals(state) && !exists(dm, id)) continue;
                long sent = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                JSObject item = new JSObject();
                item.put("mediaId", mediaId);
                item.put("state", state);
                item.put("progress", "done".equals(state) ? 1.0 : total > 0 ? (double) sent / total : 0.0);
                out.put(item);
                gone.remove(mediaId);
            }
        } catch (Exception e) {
            Log.w(TAG, "Couldn’t read the downloads", e);
            return out;
        }
        if (!gone.isEmpty()) {
            SharedPreferences.Editor edit = prefs(context).edit();
            for (String mediaId : gone) edit.remove(mediaId);
            edit.apply();
        }
        return out;
    }

    private static boolean exists(DownloadManager dm, long id) {
        try (ParcelFileDescriptor pfd = dm.openDownloadedFile(id)) {
            return pfd.getStatSize() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    @Nullable
    private static ParcelFileDescriptor open(Context context, String mediaId) {
        long id = prefs(context).getLong(mediaId, -1);
        if (id < 0) return null;
        DownloadManager dm = manager(context);
        if (!"done".equals(state(dm, id))) return null;
        try {
            return dm.openDownloadedFile(id);
        } catch (Exception e) {
            return null;
        }
    }

    private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, headers, new ByteArrayInputStream(new byte[0]));
    }

    /** A saved video for the WebView's player, in the pieces it asks for (Range), so it can seek. */
    static WebResourceResponse serve(Context context, String mediaId, Map<String, String> request) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Cache-Control", "no-store");
        ParcelFileDescriptor pfd = open(context, mediaId);
        if (pfd == null) return empty(404, "Not Found", headers);
        long size = pfd.getStatSize();
        long start = 0;
        long end = size - 1;
        String range = request.get("Range") != null ? request.get("Range") : request.get("range");
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            try {
                if (dash == 0) start = Math.max(0, size - Long.parseLong(spec.substring(1)));
                else if (dash > 0) {
                    start = Long.parseLong(spec.substring(0, dash));
                    String last = spec.substring(dash + 1);
                    if (!last.isEmpty()) end = Math.min(Long.parseLong(last), size - 1);
                }
                partial = dash >= 0;
            } catch (NumberFormatException ignored) {
                // An odd range: the whole file.
            }
        }
        if (start >= size || start > end) {
            try {
                pfd.close();
            } catch (IOException ignored) {}
            headers.put("Content-Range", "bytes */" + size);
            return empty(416, "Range Not Satisfiable", headers);
        }
        try {
            ParcelFileDescriptor.AutoCloseInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
            in.getChannel().position(start);
            long length = end - start + 1;
            headers.put("Content-Length", String.valueOf(length));
            if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return new WebResourceResponse("video/mp4", null, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers, new Slice(in, length));
        } catch (IOException e) {
            Log.w(TAG, "Couldn’t read a saved video", e);
            return empty(500, "Internal Server Error", headers);
        }
    }

    /** At most `left` bytes of a stream. */
    private static final class Slice extends InputStream {

        private final InputStream in;
        private long left;

        Slice(InputStream in, long left) {
            this.in = in;
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(buffer, offset, (int) Math.min(length, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(in.available(), left);
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
