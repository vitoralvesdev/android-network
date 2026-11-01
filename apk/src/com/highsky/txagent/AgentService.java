package com.highsky.txagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public class AgentService extends Service {
    public static final int PORT = 8790;

    private AgentHttpServer server;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel("agent", "Agente", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(ch);
        Notification n = new Notification.Builder(this, "agent")
                .setContentTitle("HIGHSKY Agent")
                .setContentText("Servidor ativo na porta " + PORT)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setOngoing(true)
                .build();
        startForeground(1, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (server == null) {
            try {
                server = new AgentHttpServer(this, PORT, TokenStore.get(this));
                server.start();
            } catch (Exception e) {
                server = null;
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (server != null) server.stop();
        server = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static String currentIp(Context c) {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                    String ip = addr.getHostAddress();
                    if (ip != null && !ip.startsWith("169.254.")) return ip;
                }
            }
        } catch (Exception ignored) {
        }
        return "?";
    }
}
