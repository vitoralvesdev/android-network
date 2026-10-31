package com.highsky.txagent;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AgentHttpServer {
    private final Context ctx;
    private final int port;
    private final String token;
    private ServerSocket serverSocket;
    private volatile boolean running;
    private ExecutorService pool;

    AgentHttpServer(Context ctx, int port, String token) {
        this.ctx = ctx.getApplicationContext();
        this.port = port;
        this.token = token;
    }

    void start() throws IOException {
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(port));
        running = true;
        pool = Executors.newFixedThreadPool(4);
        Thread t = new Thread(() -> {
            while (running) {
                try {
                    Socket s = serverSocket.accept();
                    pool.execute(() -> handle(s));
                } catch (IOException e) {
                    if (running) continue;
                }
            }
        }, "agent-http");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        if (pool != null) pool.shutdownNow();
    }

    private void handle(Socket raw) {
        try (Socket s = raw) {
            s.setSoTimeout(20000);
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String line = in.readLine();
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;

            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = in.readLine()) != null && !h.isEmpty()) {
                int i = h.indexOf(':');
                if (i > 0) headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
            }

            URI uri;
            try {
                uri = URI.create(parts[1]);
            } catch (IllegalArgumentException e) {
                send(s, 400, "application/json", "{\"ok\":false,\"error\":\"URI inválida\"}");
                return;
            }
            String path = uri.getPath() == null ? "/" : uri.getPath();
            Map<String, String> q = query(uri.getRawQuery());

            if ("/health".equals(path)) {
                send(s, 200, "application/json", "{\"ok\":true,\"agent\":\"txagent\"}");
                return;
            }

            String supplied = headers.containsKey("x-agent-token") ? headers.get("x-agent-token") : q.get("token");
            if (!token.equals(supplied)) {
                send(s, 401, "application/json", "{\"ok\":false,\"error\":\"token inválido\"}");
                return;
            }

            if ("/info".equals(path)) {
                send(s, 200, "application/json", info());
            } else if ("/apps".equals(path)) {
                send(s, 200, "application/json", apps());
            } else if ("/launch".equals(path)) {
                send(s, 200, "application/json", launch(q.get("pkg")));
            } else if ("/open".equals(path)) {
                send(s, 200, "application/json", open(q.get("url")));
            } else if ("/install".equals(path)) {
                send(s, 200, "application/json", install(q.get("url"), q.get("mode"), q.get("installer")));
            } else if ("/uninstall".equals(path)) {
                send(s, 200, "application/json", uninstall(q.get("pkg")));
            } else if ("/settings".equals(path)) {
                send(s, 200, "application/json", settings(q.get("what")));
            } else if ("/result".equals(path)) {
                send(s, 200, "application/json", "{\"ok\":true,\"result\":" + str(TokenStore.lastInstall(ctx)) + "}");
            } else {
                send(s, 404, "application/json",
                        "{\"ok\":false,\"error\":\"endpoint desconhecido\",\"endpoints\":[\"/health\",\"/info\",\"/apps\",\"/launch?pkg=\",\"/open?url=\",\"/install?url=\",\"/uninstall?pkg=\",\"/settings?what=\",\"/result\"]}");
            }
        } catch (Exception e) {
            try {
                send(raw, 500, "application/json", "{\"ok\":false,\"error\":" + str(e.getMessage()) + "}");
            } catch (Exception ignored) {
            }
        }
    }

    private String info() {
        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        String ip = AgentService.currentIp(ctx);
        PackageManager pm = ctx.getPackageManager();
        boolean canInstall;
        try {
            canInstall = pm.canRequestPackageInstalls();
        } catch (Exception e) {
            canInstall = false;
        }
        String json = "{"
                + "\"ok\":true,"
                + "\"agent\":\"txagent/2\","
                + "\"brand\":" + str(Build.BRAND) + ","
                + "\"manufacturer\":" + str(Build.MANUFACTURER) + ","
                + "\"model\":" + str(Build.MODEL) + ","
                + "\"device\":" + str(Build.DEVICE) + ","
                + "\"product\":" + str(Build.PRODUCT) + ","
                + "\"android\":" + str(Build.VERSION.RELEASE) + ","
                + "\"sdk\":" + Build.VERSION.SDK_INT + ","
                + "\"ip\":" + str(ip) + ","
                + "\"port\":" + port + ","
                + "\"screen\":\"" + dm.widthPixels + "x" + dm.heightPixels + "\","
                + "\"density\":" + dm.density + ","
                + "\"uptimeMs\":" + SystemClock.elapsedRealtime() + ","
                + "\"canInstall\":" + canInstall + ","
                + "\"installer\":" + str(installerOf(pm)) + ","
                + "\"settings\":{"
                + "\"unknownSources\":" + resolves(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName())))
                + ",\"security\":" + resolves(new Intent(Settings.ACTION_SECURITY_SETTINGS))
                + ",\"applications\":" + resolves(new Intent(Settings.ACTION_APPLICATION_SETTINGS))
                + ",\"main\":" + resolves(new Intent(Settings.ACTION_SETTINGS))
                + "},"
                + "\"installers\":" + installers(pm)
                + "}";
        return json;
    }

    private String installerOf(PackageManager pm) {
        try {
            return pm.getInstallerPackageName(ctx.getPackageName());
        } catch (Exception e) {
            return null;
        }
    }

    private boolean resolves(Intent i) {
        try {
            return i.resolveActivity(ctx.getPackageManager()) != null;
        } catch (Exception e) {
            return false;
        }
    }

    private String installers(PackageManager pm) {
        Intent probe = new Intent(Intent.ACTION_VIEW).setDataAndType(
                Uri.parse("content://" + ApkProvider.AUTHORITY + "/update.apk"),
                "application/vnd.android.package-archive");
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        try {
            for (ResolveInfo ri : pm.queryIntentActivities(probe, 0)) {
                if (ri.activityInfo == null) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append(str(ri.activityInfo.packageName + "/" + ri.activityInfo.name));
            }
        } catch (Exception ignored) {
        }
        return sb.append(']').toString();
    }

    private String apps() {
        PackageManager pm = ctx.getPackageManager();
        List<String> user = new ArrayList<>();
        List<String> system = new ArrayList<>();
        for (PackageInfo pi : pm.getInstalledPackages(0)) {
            boolean sys = pi.applicationInfo != null
                    && (pi.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            (sys ? system : user).add(pi.packageName);
        }
        java.util.Collections.sort(user);
        java.util.Collections.sort(system);
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"user\":[");
        for (int i = 0; i < user.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(str(user.get(i)));
        }
        sb.append("],\"system\":[");
        for (int i = 0; i < system.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(str(system.get(i)));
        }
        return sb.append("]}").toString();
    }

    private String launch(String pkg) {
        if (pkg == null || pkg.isEmpty()) return "{\"ok\":false,\"error\":\"pkg obrigatório\"}";
        PackageManager pm = ctx.getPackageManager();
        Intent i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return "{\"ok\":false,\"error\":\"app sem atividade de launcher\"}";
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
            return "{\"ok\":true}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + str(e.getMessage()) + "}";
        }
    }

    private String open(String url) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            return "{\"ok\":false,\"error\":\"url http(s) obrigatória\"}";
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return "{\"ok\":true}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + str(e.getMessage()) + "}";
        }
    }

    private String install(String url, String mode, String installer) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            return "{\"ok\":false,\"error\":\"url http(s) do APK obrigatória\"}";
        }
        TokenStore.setLastInstall(ctx, "baixando…");
        final boolean viaSession = "session".equals(mode);
        final String target = installer == null || installer.isEmpty() ? null : installer;
        Thread t = new Thread(() -> {
            try {
                File apk = download(url);
                if (viaSession) commit(apk);
                else view(apk, target);
            } catch (Exception e) {
                TokenStore.setLastInstall(ctx, "falhou: " + e.getMessage());
            }
        }, "agent-install");
        t.setDaemon(true);
        t.start();
        return "{\"ok\":true,\"mode\":" + str(viaSession ? "session" : "view")
                + ",\"msg\":\"download iniciado; confirme na tela da TV\"}";
    }

    private void view(File apk, String installer) throws Exception {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(Uri.parse("content://" + ApkProvider.AUTHORITY + "/update.apk"),
                "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (installer != null) i.setPackage(installer);
        ctx.startActivity(i);
        TokenStore.setLastInstall(ctx, "instalador aberto na TV; aguardando confirmação");
    }

    private String uninstall(String pkg) {
        if (pkg == null || pkg.isEmpty()) return "{\"ok\":false,\"error\":\"pkg obrigatório\"}";
        try {
            Intent result = new Intent("com.highsky.txagent.INSTALL_RESULT").setPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(
                    ctx, 77, result, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            ctx.getPackageManager().getPackageInstaller().uninstall(pkg, pi.getIntentSender());
            TokenStore.setLastInstall(ctx, "desinstalação de " + pkg + " enviada; confirme na TV");
            return "{\"ok\":true,\"msg\":\"confirme na TV\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + str(e.getMessage()) + "}";
        }
    }

    private String settings(String what) {
        Intent i;
        if ("unknown".equals(what)) {
            i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName()));
            if (!resolves(i)) i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        } else if ("security".equals(what)) {
            i = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        } else if ("applications".equals(what)) {
            i = new Intent(Settings.ACTION_APPLICATION_SETTINGS);
        } else {
            i = new Intent(Settings.ACTION_SETTINGS);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!resolves(i)) {
            return "{\"ok\":false,\"error\":\"tela não existe neste ROM\",\"what\":" + str(what) + "}";
        }
        try {
            ctx.startActivity(i);
            return "{\"ok\":true,\"what\":" + str(what) + ",\"action\":" + str(i.getAction()) + "}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + str(e.getMessage()) + "}";
        }
    }

    private File download(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(60000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code != 200) throw new IOException("HTTP " + code);
        File out = new File(ctx.getCacheDir(), "update.apk");
        try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
            byte[] buf = new byte[65536];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 300L * 1024 * 1024) throw new IOException("APK maior que 300 MB");
                o.write(buf, 0, n);
            }
        } finally {
            c.disconnect();
        }
        return out;
    }

    private void commit(File apk) throws IOException {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new java.io.FileInputStream(apk);
                 OutputStream out = session.openWrite("txagent", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent result = new Intent("com.highsky.txagent.INSTALL_RESULT").setPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(
                    ctx, id, result, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            session.commit(pi.getIntentSender());
        }
        TokenStore.setLastInstall(ctx, "enviado para confirmação na TV");
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> map = new HashMap<>();
        if (raw == null || raw.isEmpty()) return map;
        for (String pair : raw.split("&")) {
            int i = pair.indexOf('=');
            String k = i >= 0 ? pair.substring(0, i) : pair;
            String v = i >= 0 ? pair.substring(i + 1) : "";
            try {
                map.put(URLDecoder.decode(k, "UTF-8"), URLDecoder.decode(v, "UTF-8"));
            } catch (Exception ignored) {
            }
        }
        return map;
    }

    private static String str(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    private static void send(Socket s, int code, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        PrintWriter w = new PrintWriter(new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8));
        w.print("HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "ERR") + "\r\n");
        w.print("Content-Type: " + type + "; charset=utf-8\r\n");
        w.print("Content-Length: " + bytes.length + "\r\n");
        w.print("Connection: close\r\n\r\n");
        w.flush();
        s.getOutputStream().write(bytes);
        s.getOutputStream().flush();
    }
}
