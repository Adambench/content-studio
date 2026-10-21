package io.github.adambench.contentstudio;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.RemoteInput;

/** "Add a note", typed in the "Saved to …" notification: it joins the same card (queued like the share itself). */
public class SavedNoteReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence note = results != null ? results.getCharSequence(SavedShare.KEY_NOTE) : null;
        String id = intent.getStringExtra("id");
        String workspaceId = intent.getStringExtra("workspaceId");
        String name = intent.getStringExtra("name");
        if (id == null || workspaceId == null) return;
        if (note != null && !note.toString().trim().isEmpty()) {
            try {
                UploadQueue.get(context).addSaved(workspaceId, id, null, note.toString().trim());
            } catch (Exception e) {
                Log.w("SavedNoteReceiver", "Couldn't queue the note", e);
            }
        }
        SavedShare.notifyNoted(context, id, name != null ? name : "Ideas");
    }
}
