package dev.tendril.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

class CommandResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val stdout = intent.getStringExtra("stdout")
            ?: intent.getBundleExtra("result")?.getString("stdout")
            ?: return

        try {
            val json = JSONObject(stdout.trim())
            val url = json.optString("url")
            if (url.isNotEmpty()) {
                val launchIntent = Intent(context, MainActivity::class.java).apply {
                    action = MainActivity.ACTION_LOAD_URL
                    putExtra(MainActivity.EXTRA_URL, url)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                }
                context.startActivity(launchIntent)
            }
        } catch (_: Exception) {
            // Non-JSON output or error
        }
    }
}
