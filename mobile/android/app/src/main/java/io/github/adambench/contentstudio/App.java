package io.github.adambench.contentstudio;

import android.app.Application;
import android.util.Log;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

/**
 * Starts Firebase (for notifications) with the options the paired server handed over, before anything needs it — a
 * notification can start the app's process while the app itself is closed. The APK carries no Firebase config.
 */
public class App extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        FirebaseOptions options = StudioPlugin.storedFirebaseOptions(this);
        if (options != null && FirebaseApp.getApps(this).isEmpty()) {
            try {
                FirebaseApp.initializeApp(this, options);
            } catch (RuntimeException e) {
                Log.w("App", "Firebase didn't start", e);
            }
        }
    }
}
