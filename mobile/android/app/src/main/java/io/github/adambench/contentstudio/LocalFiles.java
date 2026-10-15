package io.github.adambench.contentstudio;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Files handed to the app (shared, picked, recorded) are copied into its own storage first: another app's permission
 * to read them ends with the screen that received them, while uploads may run hours later.
 */
final class LocalFiles {

    private LocalFiles() {}

    /** A folder under the app's private files, created if needed. */
    static File dir(Context context, String name) {
        File dir = new File(context.getFilesDir(), name);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    /** Copy a content:// file into `dir`, keeping its name. */
    static File copy(Context context, Uri uri, File dir, @Nullable String fallbackMime) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        String mime = resolver.getType(uri);
        if (mime == null) mime = fallbackMime;
        String name = displayName(context, uri);
        if (name == null || name.isEmpty()) name = "shared";
        name = name.replaceAll("[/\\\\:*?\"<>|\\x00-\\x1f]", "_");
        if (!name.contains(".") && mime != null) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        File out = unique(dir, name);
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IOException("Can't open " + uri);
            byte[] buffer = new byte[256 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) os.write(buffer, 0, n);
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            throw e;
        }
        return out;
    }

    @Nullable
    private static String displayName(Context context, Uri uri) {
        if ("file".equals(uri.getScheme())) return uri.getLastPathSegment();
        try (Cursor c = context.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (RuntimeException ignored) {
            // Some providers don't answer queries; fall back to the path.
        }
        return uri.getLastPathSegment();
    }

    /** `name`, or `name (2)` etc. if that's taken in `dir`. */
    static File unique(File dir, String name) {
        File file = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; file.exists(); i++) file = new File(dir, base + " (" + i + ")" + ext);
        return file;
    }

    static String mimeOf(File file) {
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    /** What the web side sees of a local file. */
    static JSObject describe(File file, @Nullable String mime) {
        JSObject o = new JSObject();
        o.put("path", file.getAbsolutePath());
        o.put("name", file.getName());
        o.put("mime", mime != null ? mime : mimeOf(file));
        o.put("size", file.length());
        return o;
    }

    static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /** Remove folders in `parent` untouched for `maxAgeMs` (shares never sent, abandoned picks). */
    static void deleteOlderThan(File parent, long maxAgeMs) {
        File[] children = parent.listFiles();
        if (children == null) return;
        long cutoff = System.currentTimeMillis() - maxAgeMs;
        for (File child : children) if (child.lastModified() < cutoff) deleteTree(child);
    }
}
