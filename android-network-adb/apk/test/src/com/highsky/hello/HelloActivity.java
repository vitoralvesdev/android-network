package com.highsky.hello;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

public class HelloActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView t = new TextView(this);
        t.setText("HIGHSKY teste OK\n\nAPK instalado pelo agente\n" + android.os.Build.MODEL);
        t.setTextSize(24);
        t.setTextColor(Color.WHITE);
        t.setGravity(Gravity.CENTER);
        t.setBackgroundColor(Color.parseColor("#0f1419"));
        setContentView(t);
    }
}
