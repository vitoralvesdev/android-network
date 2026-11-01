package com.highsky.txagent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

public class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                    TokenStore.setLastInstall(context, "aguardando confirmação na tela");
                    return;
                } catch (Exception ignored) {
                }
            }
            TokenStore.setLastInstall(context, "confirmação necessária, mas não foi possível abrir");
            return;
        }
        String label = status == PackageInstaller.STATUS_SUCCESS ? "instalado" : "falhou (status " + status + ")";
        TokenStore.setLastInstall(context, label + (message != null ? ": " + message : ""));
    }
}
