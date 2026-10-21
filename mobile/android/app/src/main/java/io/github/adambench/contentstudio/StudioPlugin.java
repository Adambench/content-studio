package io.github.adambench.contentstudio;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.moduleinstall.InstallStatusListener;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * What the web UI (web/src/lib/native.ts) needs from Android that a WebView can't do: keeping the pairing safe,
 * receiving shares, picking and recording files, the background upload queue, Firebase from the server's settings,
 * the QR scanner and the fingerprint lock.
 */
@CapacitorPlugin(name = "Studio", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class StudioPlugin extends Plugin {

    private static final String TAG = "StudioPlugin";
    private static final int ALLOWED_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Recorder recorder = new Recorder();

    @Nullable
    private String recordingWorkspace;

    @Nullable
    private File cameraDir;

    @Override
    public void load() {
        ShareInbox.setListener((share) -> notifyListeners("share", share));
        UploadQueue.get(getContext()).setListener((uploads) -> {
            JSObject event = new JSObject();
            event.put("uploads", uploads);
            notifyListeners("uploads", event);
        });
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (ShareInbox.isShare(intent)) ShareInbox.receive(getContext(), intent);
    }

    @Override
    protected void handleOnPause() {
        // Android silences the microphone for apps in the background, so leaving the app ends the memo; it's kept.
        if (!recorder.isRecording()) return;
        JSObject event = finishRecording();
        notifyListeners("recordStopped", event);
    }

    @Override
    protected void handleOnDestroy() {
        ShareInbox.setListener(null);
        UploadQueue.get(getContext()).setListener(null);
        recorder.cancel();
    }

    // ---------- pairing ----------

    @PluginMethod
    public void getPairing(PluginCall call) {
        Pairing pairing = Pairing.read(getContext());
        JSObject result = new JSObject();
        result.put("server", pairing != null ? pairing.server : null);
        result.put("token", pairing != null ? pairing.token : null);
        call.resolve(result);
    }

    @PluginMethod
    public void setPairing(PluginCall call) {
        String server = call.getString("server");
        String token = call.getString("token");
        if (server == null || token == null) {
            call.reject("server and token are required");
            return;
        }
        try {
            Pairing.save(getContext(), server, token);
            UploadQueue.get(getContext()).retryUnpaired();
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn’t store the pairing on this phone: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void clearPairing(PluginCall call) {
        Pairing.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        String name = Settings.Global.getString(getContext().getContentResolver(), Settings.Global.DEVICE_NAME);
        if (name == null || name.isEmpty()) name = Build.MODEL.startsWith(Build.MANUFACTURER) ? Build.MODEL : Build.MANUFACTURER + " " + Build.MODEL;
        result.put("deviceName", name);
        try {
            result.put("appVersion", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
        } catch (Exception e) {
            result.put("appVersion", "");
        }
        call.resolve(result);
    }

    // ---------- opening things ----------

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only web links can be opened");
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (Exception e) {
            call.reject("No browser to open it in", e);
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        getActivity().startActivity(intent);
        call.resolve();
    }

    // ---------- Firebase (notifications) ----------

    /** Firebase options the server handed over (kept, so the next launch starts Firebase before anything needs it). */
    @Nullable
    static FirebaseOptions storedFirebaseOptions(Context context) {
        String stored = firebasePrefs(context).getString("options", null);
        if (stored == null) return null;
        try {
            return firebaseOptions(new JSONObject(stored));
        } catch (Exception e) {
            return null;
        }
    }

    private static SharedPreferences firebasePrefs(Context context) {
        return context.getSharedPreferences("firebase", Context.MODE_PRIVATE);
    }

    private static FirebaseOptions firebaseOptions(JSONObject o) throws Exception {
        FirebaseOptions.Builder builder = new FirebaseOptions.Builder()
            .setApplicationId(o.getString("applicationId"))
            .setApiKey(o.getString("apiKey"))
            .setProjectId(o.getString("projectId"))
            .setGcmSenderId(o.getString("gcmSenderId"));
        if (o.has("storageBucket") && !o.isNull("storageBucket")) builder.setStorageBucket(o.getString("storageBucket"));
        return builder.build();
    }

    @PluginMethod
    public void configureFirebase(PluginCall call) {
        JSObject json = call.getObject("options");
        if (json == null) {
            call.reject("options are required");
            return;
        }
        try {
            FirebaseOptions options = firebaseOptions(json);
            firebasePrefs(getContext()).edit().putString("options", json.toString()).apply();
            JSObject result = new JSObject();
            if (FirebaseApp.getApps(getContext()).isEmpty()) {
                FirebaseApp.initializeApp(getContext(), options);
                result.put("ready", true);
                result.put("restart", false);
            } else {
                // Firebase can't switch projects while running; the new options apply from the next start.
                boolean same = FirebaseApp.getInstance().getOptions().equals(options);
                result.put("ready", same);
                result.put("restart", !same);
            }
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Couldn’t start Firebase: " + e.getMessage(), e);
        }
    }

    // ---------- QR code ----------

    @PluginMethod
    public void scanQrCode(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        ModuleInstallClient installer = ModuleInstall.getClient(getContext());
        installer
            .areModulesAvailable(scanner)
            .addOnSuccessListener((availability) -> {
                if (availability.areModulesAvailable()) {
                    scan(call, scanner);
                    return;
                }
                // First use: Google Play services downloads the scanner.
                InstallStatusListener listener = new InstallStatusListener() {
                    @Override
                    public void onInstallStatusUpdated(ModuleInstallStatusUpdate update) {
                        int state = update.getInstallState();
                        if (state == ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED) {
                            installer.unregisterListener(this);
                            scan(call, scanner);
                        } else if (state == ModuleInstallStatusUpdate.InstallState.STATE_FAILED || state == ModuleInstallStatusUpdate.InstallState.STATE_CANCELED) {
                            installer.unregisterListener(this);
                            call.reject("Couldn’t download Google’s QR scanner. Paste the link instead.");
                        }
                    }
                };
                installer
                    .installModules(ModuleInstallRequest.newBuilder().addApi(scanner).setListener(listener).build())
                    .addOnSuccessListener((response) -> {
                        if (response.areModulesAlreadyInstalled()) {
                            installer.unregisterListener(listener);
                            scan(call, scanner);
                        }
                    })
                    .addOnFailureListener((e) -> call.reject("Couldn’t download Google’s QR scanner. Paste the link instead.", e));
            })
            .addOnFailureListener((e) -> call.reject("The QR scanner needs Google Play services. Paste the link instead.", e));
    }

    private void scan(PluginCall call, GmsBarcodeScanner scanner) {
        scanner
            .startScan()
            .addOnSuccessListener((barcode) -> {
                JSObject result = new JSObject();
                result.put("value", barcode.getRawValue());
                call.resolve(result);
            })
            .addOnCanceledListener(() -> {
                JSObject result = new JSObject();
                result.put("value", null);
                call.resolve(result);
            })
            .addOnFailureListener((e) -> call.reject("Scanning failed: " + e.getMessage(), e));
    }

    // ---------- the share sheet ----------

    @PluginMethod
    public void getShare(PluginCall call) {
        JSObject result = new JSObject();
        result.put("share", ShareInbox.pending());
        call.resolve(result);
    }

    @PluginMethod
    public void discardShare(PluginCall call) {
        String id = call.getString("id");
        if (id != null) ShareInbox.discard(getContext(), id);
        call.resolve();
    }

    // ---------- picking files ----------

    @PluginMethod
    public void pickFiles(PluginCall call) {
        List<String> types = new ArrayList<>();
        boolean anyType = false;
        JSArray accept = call.getArray("accept", new JSArray());
        for (int i = 0; i < accept.length(); i++) {
            String a = accept.optString(i, "");
            if (a.contains("/")) types.add(a);
            else if (!a.isEmpty()) anyType = true; // an extension (".cube"): the picker can't filter by those
        }
        if (anyType) types.clear();
        if (call.getBoolean("camera", false)) {
            pickWithCamera(call, types);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.setType(types.size() == 1 ? types.get(0) : "*/*");
        if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        // Copy while the picker's permission to read them lasts.
        io.execute(() -> {
            File dir = new File(LocalFiles.dir(getContext(), "picks"), UUID.randomUUID().toString());
            JSArray files = new JSArray();
            for (Uri uri : uris) {
                try {
                    files.put(LocalFiles.describe(LocalFiles.copy(getContext(), uri, mkdirs(dir), null), getContext().getContentResolver().getType(uri)));
                } catch (Exception e) {
                    Log.w(TAG, "Couldn't copy a picked file", e);
                }
            }
            JSObject out = new JSObject();
            out.put("files", files);
            call.resolve(out);
        });
    }

    private void pickWithCamera(PluginCall call, List<String> types) {
        boolean video = types.isEmpty() || types.stream().anyMatch((t) -> t.startsWith("video/"));
        boolean photo = types.isEmpty() || types.stream().anyMatch((t) -> t.startsWith("image/"));
        if (video && photo) {
            // Plugin methods run on a background thread; dialogs need the main one.
            getActivity().runOnUiThread(() ->
                new AlertDialog.Builder(getActivity())
                    .setItems(new String[] { "Record a video", "Take a photo" }, (d, which) -> launchCamera(call, which == 0))
                    .setOnCancelListener((d) -> resolveFiles(call, new JSArray()))
                    .show()
            );
        } else launchCamera(call, video);
    }

    private void launchCamera(PluginCall call, boolean video) {
        LocalFiles.deleteOlderThan(LocalFiles.dir(getContext(), "picks"), 24 * 60 * 60 * 1000L);
        cameraDir = mkdirs(new File(LocalFiles.dir(getContext(), "picks"), UUID.randomUUID().toString()));
        String stamp = new java.text.SimpleDateFormat("yyyy-MM-dd-HHmmss", java.util.Locale.ROOT).format(new java.util.Date());
        File out = new File(cameraDir, (video ? "video-" : "photo-") + stamp + (video ? ".mp4" : ".jpg"));
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
        Intent intent = new Intent(video ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("", uri));
        try {
            startActivityForResult(call, intent, "cameraResult");
        } catch (Exception e) {
            call.reject("No camera app found", e);
        }
    }

    @ActivityCallback
    private void cameraResult(PluginCall call, ActivityResult result) {
        JSArray files = new JSArray();
        File dir = cameraDir;
        if (dir != null) {
            File[] taken = dir.listFiles();
            if (result.getResultCode() == Activity.RESULT_OK && taken != null) for (File f : taken) if (f.length() > 0) files.put(LocalFiles.describe(f, null));
            if (files.length() == 0) LocalFiles.deleteTree(dir);
        }
        resolveFiles(call, files);
    }

    private static void resolveFiles(PluginCall call, JSArray files) {
        JSObject out = new JSObject();
        out.put("files", files);
        call.resolve(out);
    }

    private static File mkdirs(File dir) {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    // ---------- the upload queue ----------

    @PluginMethod
    public void enqueueFiles(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        JSArray files = call.getArray("files");
        if (workspaceId == null || files == null) {
            call.reject("workspaceId and files are required");
            return;
        }
        try {
            UploadQueue.get(getContext()).addFiles(files, workspaceId, call.getString("pieceId"), call.getString("assetType"), call.getString("source", "upload"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void enqueueText(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String text = call.getString("text");
        if (workspaceId == null || text == null || text.trim().isEmpty()) {
            call.reject("workspaceId and text are required");
            return;
        }
        try {
            UploadQueue.get(getContext()).addText(workspaceId, text.trim());
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** Something for a page's Saved pile, from the app's own share screen (when "Save to Ideas" had nowhere to go yet). */
    @PluginMethod
    public void enqueueSaved(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String id = call.getString("id");
        String text = call.getString("text");
        if (workspaceId == null || id == null || text == null || text.trim().isEmpty()) {
            call.reject("workspaceId, id and text are required");
            return;
        }
        try {
            UploadQueue.get(getContext()).addSaved(workspaceId, id, text.trim(), null);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** The page "Save to Ideas" sends to: the last personal or business page opened. */
    @PluginMethod
    public void setShareTarget(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String name = call.getString("name");
        if (workspaceId == null || name == null) {
            call.reject("workspaceId and name are required");
            return;
        }
        SavedShare.setTarget(getContext(), workspaceId, name);
        call.resolve();
    }

    @PluginMethod
    public void listUploads(PluginCall call) {
        JSObject result = new JSObject();
        result.put("uploads", UploadQueue.get(getContext()).list());
        call.resolve(result);
    }

    @PluginMethod
    public void retryUpload(PluginCall call) {
        String id = call.getString("id");
        if (id != null) UploadQueue.get(getContext()).retry(id);
        call.resolve();
    }

    @PluginMethod
    public void removeUpload(PluginCall call) {
        String id = call.getString("id");
        if (id != null) UploadQueue.get(getContext()).remove(id);
        call.resolve();
    }

    @PluginMethod
    public void clearFinished(PluginCall call) {
        UploadQueue.get(getContext()).clearFinished();
        call.resolve();
    }

    // ---------- voice memos ----------

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (call.getString("workspaceId") == null) {
            call.reject("workspaceId is required");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", call, "microphonePermission");
        else beginRecording(call);
    }

    @PermissionCallback
    private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginRecording(call);
        else call.reject("Microphone access was blocked. Allow it for Content Studio in Android’s settings.");
    }

    private void beginRecording(PluginCall call) {
        try {
            recorder.start(getContext(), (level, elapsedMs) -> {
                JSObject event = new JSObject();
                event.put("level", level);
                event.put("elapsedMs", elapsedMs);
                notifyListeners("recordLevel", event);
            });
            recordingWorkspace = call.getString("workspaceId");
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn’t start recording: " + e.getMessage(), e);
        }
    }

    /** Stop and queue the memo for the workspace (unless it's too short to be anything). */
    @PluginMethod
    public void stopRecording(PluginCall call) {
        call.resolve(finishRecording());
    }

    @PluginMethod
    public void cancelRecording(PluginCall call) {
        recorder.cancel();
        recordingWorkspace = null;
        call.resolve();
    }

    private JSObject finishRecording() {
        Recorder.Recording recording = recorder.stop();
        String workspaceId = recordingWorkspace;
        recordingWorkspace = null;
        JSObject result = new JSObject();
        result.put("durationMs", recording != null ? recording.durationMs : 0);
        boolean queued = false;
        if (recording != null && recording.durationMs >= 1000 && workspaceId != null) {
            try {
                JSArray files = new JSArray();
                files.put(LocalFiles.describe(recording.file, "audio/mp4"));
                UploadQueue.get(getContext()).addFiles(files, workspaceId, null, null, "capture");
                queued = true;
            } catch (Exception e) {
                Log.w(TAG, "Couldn't queue the memo", e);
            }
        } else if (recording != null) {
            //noinspection ResultOfMethodCallIgnored
            recording.file.delete();
        }
        result.put("queued", queued);
        return result;
    }

    // ---------- the lock ----------

    @PluginMethod
    public void canLock(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", BiometricManager.from(getContext()).canAuthenticate(ALLOWED_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(result);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String title = call.getString("title", "Unlock Content Studio");
        String subtitle = call.getString("subtitle");
        getActivity().runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                getActivity(),
                ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        JSObject out = new JSObject();
                        out.put("ok", true);
                        call.resolve(out);
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        JSObject out = new JSObject();
                        out.put("ok", false);
                        out.put("message", message.toString());
                        call.resolve(out);
                    }
                }
            );
            BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(ALLOWED_AUTHENTICATORS);
            if (subtitle != null) info.setSubtitle(subtitle);
            prompt.authenticate(info.build());
        });
    }
}
