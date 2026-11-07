package com.taskly.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * ApkInstallerPlugin
 *
 * Provides native Android APK downloading, pre-flight storage verification,
 * SHA-256 checksum validation, package ID verification, signing certificate compatibility,
 * explicit versionCode downgrade protection, and secure FileProvider-backed package
 * installer launching for Taskly's owner-controlled update system.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String EXPECTED_PACKAGE_NAME = "com.taskly.app";
    private static final long MIN_STORAGE_REQUIRED_BYTES = 45L * 1024 * 1024; // 45 MB minimum free cache space

    private volatile boolean isCancelled = false;
    private Thread activeDownloadThread = null;

    /**
     * Return currently installed application version and package info.
     */
    @PluginMethod
    public void getAppInfo(PluginCall call) {
        JSObject data = new JSObject();
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            PackageInfo pinfo = pm.getPackageInfo(ctx.getPackageName(), 0);

            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = pinfo.getLongVersionCode();
            } else {
                versionCode = pinfo.versionCode;
            }

            data.put("name", "Taskly");
            data.put("packageName", pinfo.packageName);
            data.put("versionName", pinfo.versionName != null ? pinfo.versionName : "1.0.0");
            data.put("versionCode", (int) versionCode);
            data.put("platform", "android");
            call.resolve(data);
        } catch (Exception ex) {
            call.reject("Failed to retrieve package info: " + ex.getMessage());
        }
    }

    /**
     * Check whether Android's REQUEST_INSTALL_PACKAGES permission is granted (Android 8.0+).
     */
    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject data = new JSObject();
        try {
            boolean canInstall = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            }
            data.put("canInstall", canInstall);
            call.resolve(data);
        } catch (Exception ex) {
            call.reject("Failed to check install permission: " + ex.getMessage());
        }
    }

    /**
     * Open Android's system settings page to enable "Install unknown apps" for Taskly.
     */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception ex) {
            call.reject("Failed to open install settings: " + ex.getMessage());
        }
    }

    /**
     * Cancel an active in-flight APK download.
     */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        isCancelled = true;
        if (activeDownloadThread != null && activeDownloadThread.isAlive()) {
            activeDownloadThread.interrupt();
        }
        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
    }

    /**
     * Download approved APK from HTTPS URL, verify storage headroom, verify SHA-256 checksum,
     * verify package identity, check signing certificate compatibility, ensure non-downgrade,
     * and launch Android's native installer.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String urlString = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        String expectedPackageName = call.getString("expectedPackageName", EXPECTED_PACKAGE_NAME);

        if (urlString == null || urlString.trim().isEmpty()) {
            call.reject("Download URL is required.");
            return;
        }

        // Strict security: Require HTTPS for all remote downloads
        if (!urlString.startsWith("https://") && !urlString.startsWith("http://10.0.2.2") && !urlString.startsWith("http://localhost")) {
            call.reject("Security violation: Only secure HTTPS download URLs are permitted.");
            return;
        }

        isCancelled = false;

        activeDownloadThread = new Thread(() -> {
            File apkFile = null;
            try {
                Context ctx = getContext();

                // 1. Storage Pre-Flight Check: Verify cache storage availability
                File cacheDir = ctx.getCacheDir();
                long initialUsableSpace = cacheDir.getUsableSpace();
                if (initialUsableSpace < MIN_STORAGE_REQUIRED_BYTES) {
                    long availableMb = initialUsableSpace / (1024 * 1024);
                    long requiredMb = MIN_STORAGE_REQUIRED_BYTES / (1024 * 1024);
                    call.reject("Insufficient storage space: Taskly update requires at least " + requiredMb +
                        " MB of free cache storage, but only " + availableMb +
                        " MB is available on this device. Please free up storage space and try again.");
                    return;
                }

                File updatesDir = new File(cacheDir, "updates");
                if (!updatesDir.exists()) {
                    updatesDir.mkdirs();
                }

                apkFile = new File(updatesDir, "taskly-update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                // Handle HTTP redirects up to 5 hops (e.g. GitHub Releases redirect to S3/CDN)
                URL url = new URL(urlString);
                HttpURLConnection conn = null;
                int redirects = 0;
                while (redirects < 5) {
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(25000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "Taskly-Android-Updater");
                    conn.connect();

                    int status = conn.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == 307 || status == 308) {
                        String newUrl = conn.getHeaderField("Location");
                        conn.disconnect();
                        url = new URL(newUrl);
                        redirects++;
                    } else if (status >= 200 && status < 300) {
                        break;
                    } else {
                        throw new Exception("HTTP download error: server returned status " + status);
                    }
                }

                if (conn == null) {
                    throw new Exception("Failed to open connection.");
                }

                long totalBytes = conn.getContentLengthLong();

                // 2. Dynamic Storage Check against actual file size (requires 2x headroom for download + staging)
                if (totalBytes > 0) {
                    long requiredDynamic = totalBytes * 2L;
                    long usableNow = cacheDir.getUsableSpace();
                    if (usableNow < requiredDynamic) {
                        conn.disconnect();
                        long availMb = usableNow / (1024 * 1024);
                        long reqMb = requiredDynamic / (1024 * 1024);
                        call.reject("Insufficient storage space: The update file requires " + reqMb +
                            " MB of free space, but only " + availMb +
                            " MB is available. Please clear space to proceed.");
                        return;
                    }
                }

                long downloadedBytes = 0;
                MessageDigest digest = MessageDigest.getInstance("SHA-256");

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(apkFile)) {

                    byte[] buffer = new byte[16384];
                    int bytesRead;
                    long lastNotifyTime = 0;

                    while ((bytesRead = in.read(buffer)) != -1) {
                        if (isCancelled || Thread.currentThread().isInterrupted()) {
                            apkFile.delete();
                            JSObject cancelObj = new JSObject();
                            cancelObj.put("cancelled", true);
                            call.resolve(cancelObj);
                            return;
                        }

                        out.write(buffer, 0, bytesRead);
                        digest.update(buffer, 0, bytesRead);
                        downloadedBytes += bytesRead;

                        long now = System.currentTimeMillis();
                        if (now - lastNotifyTime >= 100 || downloadedBytes == totalBytes) {
                            lastNotifyTime = now;
                            JSObject progress = new JSObject();
                            progress.put("downloadedBytes", downloadedBytes);
                            progress.put("totalBytes", totalBytes);
                            int percent = totalBytes > 0 ? (int) ((downloadedBytes * 100) / totalBytes) : -1;
                            progress.put("percent", percent);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                    out.flush();
                } finally {
                    conn.disconnect();
                }

                // 3. Verify SHA-256 Checksum
                byte[] hashBytes = digest.digest();
                StringBuilder sb = new StringBuilder();
                for (byte b : hashBytes) {
                    sb.append(String.format("%02x", b));
                }
                String calculatedSha256 = sb.toString();

                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    String cleanExpected = expectedSha256.trim().toLowerCase(Locale.ROOT);
                    if (!calculatedSha256.equals(cleanExpected)) {
                        apkFile.delete();
                        call.reject("Security Error: SHA-256 checksum verification failed. The downloaded file may be corrupted or modified. Expected: " + cleanExpected + ", Found: " + calculatedSha256);
                        return;
                    }
                }

                // 4. Verify APK Package Archive and Package Identifier
                PackageManager pm = ctx.getPackageManager();
                PackageInfo archiveInfo = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), PackageManager.GET_SIGNATURES);
                if (archiveInfo == null) {
                    apkFile.delete();
                    call.reject("Validation Error: The downloaded file is not a valid Android APK archive.");
                    return;
                }

                if (!expectedPackageName.equals(archiveInfo.packageName)) {
                    apkFile.delete();
                    call.reject("Security Error: Package identifier mismatch! Expected: " + expectedPackageName + ", but downloaded APK is: " + archiveInfo.packageName);
                    return;
                }

                // 5. Query currently installed application package info
                PackageInfo currentAppInfo = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES);

                // 6. Explicit VersionCode Downgrade Prevention
                long currentVersionCode;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    currentVersionCode = currentAppInfo.getLongVersionCode();
                } else {
                    currentVersionCode = currentAppInfo.versionCode;
                }

                long archiveVersionCode;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    archiveVersionCode = archiveInfo.getLongVersionCode();
                } else {
                    archiveVersionCode = archiveInfo.versionCode;
                }

                if (archiveVersionCode < currentVersionCode) {
                    apkFile.delete();
                    call.reject("Security Error: Downgrade prohibited. Downloaded APK version code (" +
                        archiveVersionCode + ") is lower than currently installed version code (" +
                        currentVersionCode + "). Update stopped to preserve user data.");
                    return;
                }

                // 7. Verify Signing Certificate Compatibility with Currently Installed Taskly App
                if (currentAppInfo.signatures != null && currentAppInfo.signatures.length > 0 &&
                    archiveInfo.signatures != null && archiveInfo.signatures.length > 0) {
                    boolean signatureMatches = false;
                    for (Signature currentSig : currentAppInfo.signatures) {
                        for (Signature archiveSig : archiveInfo.signatures) {
                            if (currentSig.equals(archiveSig)) {
                                signatureMatches = true;
                                break;
                            }
                        }
                        if (signatureMatches) break;
                    }

                    if (!signatureMatches) {
                        apkFile.delete();
                        call.reject("Security Error: Signing certificate mismatch. The new APK is signed with a different certificate than the currently installed application. Update stopped to protect application integrity.");
                        return;
                    }
                }

                // 8. Launch Android Native Package Installer via FileProvider
                Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                ctx.startActivity(installIntent);

                JSObject success = new JSObject();
                success.put("status", "installer_launched");
                success.put("message", "Android package installer launched successfully.");
                success.put("sha256", calculatedSha256);
                success.put("fileSize", downloadedBytes);
                call.resolve(success);

            } catch (Exception ex) {
                if (apkFile != null && apkFile.exists()) {
                    apkFile.delete();
                }
                call.reject("Update installation failed: " + ex.getMessage());
            }
        });

        activeDownloadThread.start();
    }
}
