package io.github.adambench.contentstudio;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * A carousel's slides on the phone: fetched from the computer in order (with the device token), then saved to the
 * gallery (Pictures/Content Studio/<folder>) or handed to Android's share sheet all at once, so Instagram opens them
 * as one carousel in the right order.
 */
final class Slides {

    private static final String FOLDER = "Content Studio";
    private static final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build();

    private Slides() {}

    /** No characters a file or folder name can't hold. */
    private static String clean(String name, String fallback) {
        String out = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "-").trim();
        return out.isEmpty() ? fallback : out;
    }

    private static String extension(String mime) {
        if (mime == null) return ".png";
        if (mime.contains("jpeg")) return ".jpg";
        if (mime.contains("webp")) return ".webp";
        return ".png";
    }

    /** Each slide into the app's cache (shared through its FileProvider), in order. */
    static List<File> fetch(Context context, Pairing pairing, List<String> mediaIds, List<String> names) throws IOException {
        File dir = new File(context.getCacheDir(), "slides");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No room for the slides on this phone.");
        String base = pairing.server.replaceAll("/+$", "");
        List<File> files = new ArrayList<>();
        for (int i = 0; i < mediaIds.size(); i++) {
            Request request = new Request.Builder()
                .url(base + "/api/media/" + Uri.encode(mediaIds.get(i)) + "/file")
                .header("Authorization", "Bearer " + pairing.token)
                .build();
            try (Response response = http.newCall(request).execute()) {
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) throw new IOException("Couldn’t fetch slide " + (i + 1) + " (" + response.code() + ").");
                String name = clean(i < names.size() ? names.get(i) : null, String.format("%02d", i + 1));
                File file = new File(dir, name + extension(body.contentType() == null ? null : body.contentType().toString()));
                try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(file)) {
                    copy(in, out);
                }
                files.add(file);
            }
        }
        return files;
    }

    /** Into the gallery: Pictures/Content Studio/<folder> (no permission needed from Android 10; before that, Pictures). */
    static int save(Context context, List<File> files, String folder) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        String sub = FOLDER + "/" + clean(folder, "Carousel");
        int saved = 0;
        for (File file : files) {
            String mime = file.getName().endsWith(".jpg") ? "image/jpeg" : file.getName().endsWith(".webp") ? "image/webp" : "image/png";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, file.getName());
                values.put(MediaStore.Images.Media.MIME_TYPE, mime);
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + sub);
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("The gallery wouldn’t take " + file.getName() + ".");
                try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException("The gallery wouldn’t take " + file.getName() + ".");
                    copy(in, out);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File dir = new File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), sub);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No room for the slides on this phone.");
                try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(new File(dir, file.getName()))) {
                    copy(in, out);
                }
            }
            saved++;
        }
        return saved;
    }

    /** Android's share sheet with every slide, in order (Instagram's "Feed" makes one carousel of them). */
    static Intent shareIntent(Context context, List<File> files) {
        ArrayList<Uri> uris = new ArrayList<>();
        String authority = context.getPackageName() + ".fileprovider";
        for (File f : files) uris.add(FileProvider.getUriForFile(context, authority, f));
        Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
        send.setType("image/*");
        send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        // The receiving app may only read what's listed in ClipData on newer Androids.
        ClipData clip = ClipData.newRawUri("", uris.get(0));
        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
        send.setClipData(clip);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, "Post the carousel");
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return chooser;
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
    }
}
