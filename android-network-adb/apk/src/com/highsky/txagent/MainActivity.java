package com.highsky.txagent;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView info;
    private TextView installState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startAgent();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0f1419"));

        TextView title = new TextView(this);
        title.setText("HIGHSKY Agent");
        title.setTextSize(28);
        title.setTextColor(Color.WHITE);
        root.addView(title);

        info = new TextView(this);
        info.setTextSize(17);
        info.setTextColor(Color.parseColor("#9fe8b0"));
        info.setPadding(0, 28, 0, 20);
        root.addView(info);

        installState = new TextView(this);
        installState.setTextSize(13);
        installState.setTextColor(Color.parseColor("#8a96a8"));
        installState.setPadding(0, 0, 0, 24);
        root.addView(installState);

        Button perm = new Button(this);
        perm.setText("Permitir instalação de APK");
        perm.setOnClickListener(v -> openUnknownSources());
        root.addView(perm);

        Button restart = new Button(this);
        restart.setText("Reiniciar servidor");
        restart.setOnClickListener(v -> {
            stopService(new Intent(this, AgentService.class));
            startAgent();
            refresh();
        });
        root.addView(restart);

        TextView help = new TextView(this);
        help.setTextSize(14);
        help.setTextColor(Color.parseColor("#8a96a8"));
        help.setText("Mantenha este app aberto.\nNo PC: http://" + AgentService.currentIp(this) + ":"
                + AgentService.PORT + "/info  (header x-agent-token)");
        help.setPadding(0, 28, 0, 0);
        root.addView(help);

        setContentView(root);
        refresh();
        installState.postDelayed(new Runnable() {
            @Override
            public void run() {
                refresh();
                installState.postDelayed(this, 2000);
            }
        }, 2000);
    }

    private void startAgent() {
        Intent svc = new Intent(this, AgentService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc);
        else startService(svc);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        String ip = AgentService.currentIp(this);
        info.setText("IP: " + ip + ":" + AgentService.PORT + "\nToken: " + TokenStore.get(this));
        boolean can;
        try {
            can = getPackageManager().canRequestPackageInstalls();
        } catch (Exception e) {
            can = false;
        }
        String last = TokenStore.lastInstall(this);
        installState.setText("Instalação de APK: " + (can ? "permitida" : "bloqueada")
                + (last.isEmpty() ? "" : "\nÚltima: " + last));
    }

    private void openUnknownSources() {
        Intent pkgIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName()));
        if (launchIfResolves(pkgIntent)) return;
        if (launchIfResolves(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))) return;
        if (launchIfResolves(new Intent(Settings.ACTION_SECURITY_SETTINGS))) return;
        if (launchIfResolves(new Intent(Settings.ACTION_APPLICATION_SETTINGS))) return;
        if (launchIfResolves(new Intent(Settings.ACTION_SETTINGS))) return;
        Toast.makeText(this, "Este ROM não tem a tela de fontes desconhecidas. Use o APKPure ou o navegador para instalar APKs.",
                Toast.LENGTH_LONG).show();
    }

    private boolean launchIfResolves(Intent i) {
        if (i.resolveActivity(getPackageManager()) == null) return false;
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            Toast.makeText(this, "Falha ao abrir: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return false;
        }
    }
}
