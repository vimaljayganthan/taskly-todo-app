package com.taskly.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.DisplayMetrics;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DeviceCompatPlugin
 *
 * Provides native Android hardware, OEM manufacturer, brand, model,
 * and display characteristics to Taskly's Device-Adaptive UI Compatibility System.
 */
@CapacitorPlugin(name = "DeviceCompat")
public class DeviceCompatPlugin extends Plugin {

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "Unknown");
            ret.put("brand", Build.BRAND != null ? Build.BRAND : "Unknown");
            ret.put("model", Build.MODEL != null ? Build.MODEL : "Unknown");
            ret.put("product", Build.PRODUCT != null ? Build.PRODUCT : "Unknown");
            ret.put("device", Build.DEVICE != null ? Build.DEVICE : "Unknown");
            ret.put("hardware", Build.HARDWARE != null ? Build.HARDWARE : "Unknown");
            ret.put("androidVersion", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
            ret.put("sdkInt", Build.VERSION.SDK_INT);
            ret.put("platform", "android");

            // Display density and screen metrics if available
            try {
                if (getActivity() != null && getActivity().getResources() != null) {
                    DisplayMetrics dm = getActivity().getResources().getDisplayMetrics();
                    ret.put("density", (double) dm.density);
                    ret.put("densityDpi", dm.densityDpi);
                    ret.put("screenWidthPixels", dm.widthPixels);
                    ret.put("screenHeightPixels", dm.heightPixels);
                    ret.put("scaledDensity", (double) dm.scaledDensity);
                }
            } catch (Exception ignored) {
                // Display metrics are supplementary; non-fatal if unavailable
            }

            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to retrieve device profile: " + e.getMessage(), e);
        }
    }

    /**
     * Launch an external browser intent for OAuth authentication.
     */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL cannot be empty");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to open URL in browser: " + e.getMessage(), e);
        }
    }
}
