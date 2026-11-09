package dev.tendril.shell

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

object TermuxBridge {
    const val TERMUX_PACKAGE_NAME = "com.termux"
    const val TERMUX_PERMISSION_RUN_COMMAND = "com.termux.permission.RUN_COMMAND"

    private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"
    private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
    private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
    private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
    private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
    private const val EXTRA_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION"
    private const val EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"

    private const val TENDRIL_BIN_PATH = "/data/data/com.termux/files/usr/bin/tendril"

    fun isTermuxInstalled(context: Context): Boolean {
        return try {
            context.packageManager.getPackageInfo(TERMUX_PACKAGE_NAME, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    fun hasRunCommandPermission(context: Context): Boolean {
        return context.checkSelfPermission(TERMUX_PERMISSION_RUN_COMMAND) == PackageManager.PERMISSION_GRANTED
    }

    fun openTermux(context: Context) {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE_NAME)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
        } else {
            openInstallGuide(context)
        }
    }

    fun openInstallGuide(context: Context) {
        val browserIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://github.com/tendril/tendril/blob/main/docs/01-PRD.md#termux-installation")
        )
        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(browserIntent)
    }

    fun startDaemon(context: Context): Boolean {
        if (!hasRunCommandPermission(context)) return false

        val intent = Intent()
        intent.setClassName(TERMUX_PACKAGE_NAME, RUN_COMMAND_SERVICE)
        intent.action = ACTION_RUN_COMMAND
        intent.putExtra(EXTRA_COMMAND_PATH, TENDRIL_BIN_PATH)
        intent.putExtra(EXTRA_ARGUMENTS, arrayOf("serve", "--detach"))
        intent.putExtra(EXTRA_BACKGROUND, true)
        intent.putExtra(EXTRA_SESSION_ACTION, "0")

        try {
            context.startService(intent)
            return true
        } catch (_: Exception) {
            return false
        }
    }

    fun requestPairUrl(context: Context, callbackPendingIntent: PendingIntent): Boolean {
        if (!hasRunCommandPermission(context)) return false

        val intent = Intent()
        intent.setClassName(TERMUX_PACKAGE_NAME, RUN_COMMAND_SERVICE)
        intent.action = ACTION_RUN_COMMAND
        intent.putExtra(EXTRA_COMMAND_PATH, TENDRIL_BIN_PATH)
        intent.putExtra(EXTRA_ARGUMENTS, arrayOf("pair", "--json"))
        intent.putExtra(EXTRA_BACKGROUND, true)
        intent.putExtra(EXTRA_SESSION_ACTION, "0")
        intent.putExtra(EXTRA_PENDING_INTENT, callbackPendingIntent)

        try {
            context.startService(intent)
            return true
        } catch (_: Exception) {
            return false
        }
    }
}
