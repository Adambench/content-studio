package io.github.adambench.contentstudio;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.Nullable;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The server this phone is paired with and its device token. The token is encrypted with a key kept in Android's
 * Keystore (it never leaves the secure hardware), so the preferences file alone is useless.
 */
final class Pairing {

    private static final String TAG = "Pairing";
    private static final String PREFS = "pairing";
    private static final String KEY_ALIAS = "content-studio-pairing";

    final String server;
    final String token;

    private Pairing(String server, String token) {
        this.server = server;
        this.token = token;
    }

    @Nullable
    static synchronized Pairing read(Context context) {
        SharedPreferences prefs = prefs(context);
        String server = prefs.getString("server", null);
        String sealed = prefs.getString("token", null);
        if (server == null || sealed == null) return null;
        try {
            String[] parts = sealed.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            String token = new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            return new Pairing(server, token);
        } catch (Exception e) {
            // A key that's gone (e.g. data restored onto another phone): it has to be paired again.
            Log.w(TAG, "Couldn't read the device token", e);
            return null;
        }
    }

    static synchronized void save(Context context, String server, String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String sealed =
            Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) +
            ":" +
            Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        prefs(context).edit().putString("server", server).putString("token", sealed).apply();
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }
}
