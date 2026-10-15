package io.github.adambench.contentstudio;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Voice memos for idea capture: AAC in an .m4a, saved on the phone first so they're kept offline. */
final class Recorder {

    interface Level {
        void onLevel(float level, long elapsedMs);
    }

    static final class Recording {

        final File file;
        final long durationMs;

        Recording(File file, long durationMs) {
            this.file = file;
            this.durationMs = durationMs;
        }
    }

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Nullable
    private MediaRecorder recorder;

    @Nullable
    private File file;

    private long startedAt;

    @Nullable
    private Runnable ticker;

    boolean isRecording() {
        return recorder != null;
    }

    @SuppressWarnings("deprecation") // new MediaRecorder() before Android 12
    void start(Context context, Level level) throws IOException {
        cancel();
        File dir = LocalFiles.dir(context, "recordings");
        LocalFiles.deleteOlderThan(dir, 24 * 60 * 60 * 1000L);
        file = new File(dir, "voice-memo-" + new SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ROOT).format(new Date()) + ".m4a");
        file = LocalFiles.unique(dir, file.getName());
        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(context) : new MediaRecorder();
        r.setAudioSource(MediaRecorder.AudioSource.MIC);
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        r.setAudioChannels(1);
        r.setAudioSamplingRate(44100);
        r.setAudioEncodingBitRate(96_000);
        r.setOutputFile(file.getAbsolutePath());
        try {
            r.prepare();
            r.start();
        } catch (IOException | RuntimeException e) {
            r.release();
            throw e instanceof IOException ? (IOException) e : new IOException("The microphone is busy", e);
        }
        recorder = r;
        startedAt = SystemClock.elapsedRealtime();
        ticker = new Runnable() {
            @Override
            public void run() {
                if (recorder == null) return;
                // getMaxAmplitude: the peak since the last call, 0–32767. The square root reads more like loudness.
                float peak = recorder.getMaxAmplitude() / 32767f;
                level.onLevel((float) Math.sqrt(Math.min(1f, peak)), SystemClock.elapsedRealtime() - startedAt);
                handler.postDelayed(this, 100);
            }
        };
        handler.post(ticker);
    }

    /** Finish the file. Null if nothing usable was recorded (stopped straight away). */
    @Nullable
    Recording stop() {
        MediaRecorder r = recorder;
        File f = file;
        if (r == null || f == null) return null;
        long duration = SystemClock.elapsedRealtime() - startedAt;
        clear();
        try {
            r.stop();
        } catch (RuntimeException e) {
            // MediaRecorder throws when stopped before any audio was written.
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            return null;
        } finally {
            r.release();
        }
        return new Recording(f, duration);
    }

    void cancel() {
        MediaRecorder r = recorder;
        File f = file;
        clear();
        if (r != null) {
            try {
                r.stop();
            } catch (RuntimeException ignored) {}
            r.release();
        }
        if (f != null) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    private void clear() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = null;
        recorder = null;
        file = null;
    }
}
