package io.github.adambench.contentstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.JSArray;
import java.io.File;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Save to Ideas" in the share sheet: a link, some text or screenshots go straight into the upload queue for the
 * Saved pile of the last page I used (no screen; I stay in the app I shared from), and a notification says where.
 * Before the app is paired or a page with Ideas has been opened, the app's own share screen asks instead.
 */
public class ShareActivity extends Activity {

    private static final String TAG = "ShareActivity";
    private static final ExecutorService copier = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        SavedShare.Target target = SavedShare.target(this);
        if (!ShareInbox.isShare(intent)) {
            finish();
            return;
        }
        if (target == null || Pairing.read(this) == null) {
            Intent forward = new Intent(intent).setClass(this, MainActivity.class).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(forward);
            finish();
            return;
        }
        List<Uri> uris = ShareInbox.streams(intent);
        String text = ShareInbox.joinText(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getStringExtra(Intent.EXTRA_TEXT));
        String type = intent.getType();
        String ideaId = UUID.randomUUID().toString();
        // Copied while the sharing app's permission to read them lasts (as long as this activity does).
        copier.execute(() -> {
            UploadQueue queue = UploadQueue.get(this);
            int pictures = 0;
            try {
                if (text != null) queue.addSaved(target.workspaceId, ideaId, text, null);
                File dir = new File(LocalFiles.dir(this, "inbox"), ideaId);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                for (int i = 0; i < uris.size(); i++) {
                    try {
                        File copy = LocalFiles.copy(this, uris.get(i), dir, type != null && !type.endsWith("/*") ? type : null);
                        String mime = getContentResolver().getType(uris.get(i));
                        JSArray files = new JSArray();
                        files.put(LocalFiles.describe(copy, mime != null ? mime : LocalFiles.mimeOf(copy)));
                        // The first picture joins the shared text's card; any others are cards of their own.
                        queue.addFiles(files, target.workspaceId, null, null, "idea", i == 0 ? ideaId : UUID.randomUUID().toString());
                        pictures++;
                    } catch (Exception e) {
                        Log.w(TAG, "Couldn't copy a shared picture", e);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Couldn't queue the share", e);
            }
            String what = text != null && ShareInbox.hasLink(text) ? "The post goes into Saved" : pictures > 1 ? pictures + " pictures go into Saved" : pictures == 1 ? "The picture goes into Saved" : "Your note goes into Saved";
            int saved = pictures;
            runOnUiThread(() -> {
                if (text != null || saved > 0) SavedShare.notifySaved(this, target, ideaId, what);
                finish();
                overridePendingTransition(0, 0);
            });
        });
    }
}
