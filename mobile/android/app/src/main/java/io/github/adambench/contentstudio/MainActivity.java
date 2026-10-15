package io.github.adambench.contentstudio;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(StudioPlugin.class);
        super.onCreate(savedInstanceState);
        // The UI draws under the system bars (and pads itself with their insets); light icons on the dark UI. After
        // super.onCreate, which switches from the launch theme: touching the window before that would keep its title bar.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
    }
}
