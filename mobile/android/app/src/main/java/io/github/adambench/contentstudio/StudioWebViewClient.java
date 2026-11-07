package io.github.adambench.contentstudio;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Capacitor's WebView client, plus the videos saved to the phone at https://localhost/_studio_download_/<mediaId>. */
public class StudioWebViewClient extends BridgeWebViewClient {

    static final String PREFIX = "/_studio_download_/";
    private final Context context;

    StudioWebViewClient(Bridge bridge) {
        super(bridge);
        context = bridge.getContext().getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if ("localhost".equals(url.getHost()) && path != null && path.startsWith(PREFIX)) {
            return Downloads.serve(context, Uri.decode(path.substring(PREFIX.length())), request.getRequestHeaders());
        }
        return super.shouldInterceptRequest(view, request);
    }
}
