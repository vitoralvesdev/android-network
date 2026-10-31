package com.highsky.txagent;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;
import java.util.Date;

final class TokenStore {
    private static final String PREF = "agent";
    private static final String KEY = "token";
    private static final String INSTALL = "last_install";

    private TokenStore() {}

    static synchronized String get(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        String t = p.getString(KEY, null);
        if (t == null) {
            SecureRandom r = new SecureRandom();
            byte[] b = new byte[4];
            r.nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            t = sb.toString();
            p.edit().putString(KEY, t).apply();
        }
        return t;
    }

    static String lastInstall(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(INSTALL, "");
    }

    static void setLastInstall(Context c, String value) {
        c.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .edit()
                .putString(INSTALL, value + " @ " + new Date())
                .apply();
    }
}
