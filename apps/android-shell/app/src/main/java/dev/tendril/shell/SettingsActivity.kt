package dev.tendril.shell

import android.content.Context
import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText

class SettingsActivity : AppCompatActivity() {

    companion object {
        const val PREFS_NAME = "tendril_shell_prefs"
        const val KEY_PORT = "daemon_port"
        const val KEY_AUTOSTART = "daemon_autostart"
        const val DEFAULT_PORT = 7421
        const val DEFAULT_AUTOSTART = true

        fun getDaemonPort(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getInt(KEY_PORT, DEFAULT_PORT)
        }

        fun isAutostartEnabled(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_AUTOSTART, DEFAULT_AUTOSTART)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val editPort = findViewById<TextInputEditText>(R.id.editPort)
        val switchAutostart = findViewById<SwitchMaterial>(R.id.switchAutostart)
        val btnSave = findViewById<Button>(R.id.btnSaveSettings)

        val currentPort = getDaemonPort(this)
        val currentAutostart = isAutostartEnabled(this)

        editPort.setText(currentPort.toString())
        switchAutostart.isChecked = currentAutostart

        btnSave.setOnClickListener {
            val portText = editPort.text?.toString()?.trim()
            val port = portText?.toIntOrNull() ?: DEFAULT_PORT

            if (port < 1024 || port > 65535) {
                Toast.makeText(this, "Port must be between 1024 and 65535", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putInt(KEY_PORT, port)
                .putBoolean(KEY_AUTOSTART, switchAutostart.isChecked)
                .apply()

            Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
