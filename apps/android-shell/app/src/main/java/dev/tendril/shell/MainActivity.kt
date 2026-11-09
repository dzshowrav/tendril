package dev.tendril.shell

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    companion object {
        const val ACTION_LOAD_URL = "dev.tendril.shell.LOAD_URL"
        const val EXTRA_URL = "extra_url"
        private const val HEALTH_POLL_INTERVAL_MS = 500L
        private const val HEALTH_MAX_TIMEOUT_MS = 20000L
    }

    private lateinit var webView: WebView
    private lateinit var statusContainer: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var statusSubtext: TextView
    private lateinit var helpContainer: ScrollView
    private lateinit var helpTitle: TextView
    private lateinit var helpDescription: TextView
    private lateinit var commandBox: LinearLayout
    private lateinit var commandText: TextView
    private lateinit var btnPrimaryAction: Button
    private lateinit var btnCopyCommand: Button
    private lateinit var btnOpenTermux: Button
    private lateinit var btnInstallGuide: Button
    private lateinit var appMenuBar: LinearLayout
    private lateinit var btnReload: ImageButton
    private lateinit var btnSettings: ImageButton

    private var activePort = SettingsActivity.DEFAULT_PORT
    private var isStartingDaemon = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            startDaemonAndConnect()
        } else {
            showSetupHelp(
                title = getString(R.string.help_permission_missing_title),
                description = getString(R.string.help_permission_missing_desc),
                fixCommand = null,
                primaryButtonText = getString(R.string.btn_grant_permission),
                onPrimaryAction = { requestTermuxPermission() }
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        setupWebView()
        setupBackNavigation()

        handleIntentUrl(intent)

        if (savedInstanceState == null) {
            checkDaemonOrStart()
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntentUrl(intent)
    }

    override fun onResume() {
        super.onResume()
        val configuredPort = SettingsActivity.getDaemonPort(this)
        if (configuredPort != activePort) {
            activePort = configuredPort
            checkDaemonOrStart()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    private fun initViews() {
        webView = findViewById(R.id.webView)
        statusContainer = findViewById(R.id.statusContainer)
        statusText = findViewById(R.id.statusText)
        statusSubtext = findViewById(R.id.statusSubtext)
        helpContainer = findViewById(R.id.helpContainer)
        helpTitle = findViewById(R.id.helpTitle)
        helpDescription = findViewById(R.id.helpDescription)
        commandBox = findViewById(R.id.commandBox)
        commandText = findViewById(R.id.commandText)
        btnPrimaryAction = findViewById(R.id.btnPrimaryAction)
        btnCopyCommand = findViewById(R.id.btnCopyCommand)
        btnOpenTermux = findViewById(R.id.btnOpenTermux)
        btnInstallGuide = findViewById(R.id.btnInstallGuide)
        appMenuBar = findViewById(R.id.appMenuBar)
        btnReload = findViewById(R.id.btnReload)
        btnSettings = findViewById(R.id.btnSettings)

        activePort = SettingsActivity.getDaemonPort(this)

        btnReload.setOnClickListener {
            webView.reload()
        }

        btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        btnOpenTermux.setOnClickListener {
            TermuxBridge.openTermux(this)
        }

        btnInstallGuide.setOnClickListener {
            TermuxBridge.openInstallGuide(this)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings

        // Hardened WebView settings per TRD
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.safeBrowsingEnabled = true

        // Strict security: Zero native JavaScript interface bridges are registered.

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val host = uri.host ?: ""

                // Keep navigation inside 127.0.0.1:<port> and localhost:<port>
                if (host == "127.0.0.1" || host == "localhost") {
                    return false
                }

                // External links handed off to system browser via ACTION_VIEW
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(browserIntent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "No browser found to open link", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                showWebView()
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })
    }

    private fun handleIntentUrl(intent: Intent?) {
        if (intent == null) return
        val url = intent.getStringExtra(EXTRA_URL)
        if (!url.isNullOrEmpty()) {
            loadInWebView(url)
        }
    }

    private fun showStatus(title: String, subtext: String? = null) {
        statusContainer.visibility = View.VISIBLE
        helpContainer.visibility = View.GONE
        webView.visibility = View.GONE
        appMenuBar.visibility = View.GONE

        statusText.text = title
        if (subtext != null) {
            statusSubtext.visibility = View.VISIBLE
            statusSubtext.text = subtext
        } else {
            statusSubtext.visibility = View.GONE
        }
    }

    private fun showWebView() {
        statusContainer.visibility = View.GONE
        helpContainer.visibility = View.GONE
        webView.visibility = View.VISIBLE
        appMenuBar.visibility = View.VISIBLE
    }

    private fun showSetupHelp(
        title: String,
        description: String,
        fixCommand: String?,
        primaryButtonText: String = getString(R.string.btn_retry),
        onPrimaryAction: () -> Unit
    ) {
        statusContainer.visibility = View.GONE
        webView.visibility = View.GONE
        helpContainer.visibility = View.VISIBLE
        appMenuBar.visibility = View.VISIBLE

        helpTitle.text = title
        helpDescription.text = description

        if (fixCommand != null) {
            commandBox.visibility = View.VISIBLE
            commandText.text = fixCommand
            btnCopyCommand.visibility = View.VISIBLE
            btnCopyCommand.setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("Tendril Fix Command", fixCommand)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, getString(R.string.toast_copied), Toast.LENGTH_SHORT).show()
            }
        } else {
            commandBox.visibility = View.GONE
            btnCopyCommand.visibility = View.GONE
        }

        btnPrimaryAction.text = primaryButtonText
        btnPrimaryAction.setOnClickListener {
            onPrimaryAction()
        }
    }

    private fun checkDaemonOrStart() {
        showStatus(getString(R.string.status_checking))

        lifecycleScope.launch {
            val isHealthy = checkHealth(activePort)
            if (isHealthy) {
                loadInWebView("http://127.0.0.1:$activePort")
            } else {
                if (SettingsActivity.isAutostartEnabled(this@MainActivity)) {
                    startDaemonAndConnect()
                } else {
                    showSetupHelp(
                        title = getString(R.string.status_offline),
                        description = getString(R.string.help_daemon_failed_desc),
                        fixCommand = "tendril serve --detach",
                        primaryButtonText = "Start Daemon",
                        onPrimaryAction = { startDaemonAndConnect() }
                    )
                }
            }
        }
    }

    private fun startDaemonAndConnect() {
        if (isStartingDaemon) return

        // 1. Verify Termux installed
        if (!TermuxBridge.isTermuxInstalled(this)) {
            showSetupHelp(
                title = getString(R.string.help_termux_not_installed_title),
                description = getString(R.string.help_termux_not_installed_desc),
                fixCommand = null,
                primaryButtonText = getString(R.string.btn_open_termux),
                onPrimaryAction = { TermuxBridge.openInstallGuide(this) }
            )
            return
        }

        // 2. Verify RUN_COMMAND permission
        if (!TermuxBridge.hasRunCommandPermission(this)) {
            requestTermuxPermission()
            return
        }

        isStartingDaemon = true
        showStatus(getString(R.string.status_starting), "Waiting up to 20 s…")

        // 3. Send RUN_COMMAND to start daemon
        val started = TermuxBridge.startDaemon(this)
        if (!started) {
            isStartingDaemon = false
            showSetupHelp(
                title = getString(R.string.help_external_apps_title),
                description = getString(R.string.help_external_apps_desc),
                fixCommand = "echo \"allow-external-apps = true\" >> ~/.termux/termux.properties",
                onPrimaryAction = { checkDaemonOrStart() }
            )
            return
        }

        // 4. Poll health
        lifecycleScope.launch {
            val startTime = System.currentTimeMillis()
            var healthy = false

            while (System.currentTimeMillis() - startTime < HEALTH_MAX_TIMEOUT_MS) {
                delay(HEALTH_POLL_INTERVAL_MS)
                if (checkHealth(activePort)) {
                    healthy = true
                    break
                }
            }

            isStartingDaemon = false

            if (healthy) {
                // Request pair URL via RUN_COMMAND
                requestPairAndConnect()
            } else {
                showSetupHelp(
                    title = getString(R.string.help_daemon_failed_title),
                    description = getString(R.string.help_daemon_failed_desc),
                    fixCommand = "tendril serve --detach",
                    onPrimaryAction = { checkDaemonOrStart() }
                )
            }
        }
    }

    private fun requestTermuxPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            permissionLauncher.launch(TermuxBridge.TERMUX_PERMISSION_RUN_COMMAND)
        }
    }

    private fun requestPairAndConnect() {
        showStatus(getString(R.string.status_pairing))

        val intent = Intent(this, CommandResultReceiver::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getBroadcast(this, 0, intent, flags)

        val pairSent = TermuxBridge.requestPairUrl(this, pendingIntent)
        if (!pairSent) {
            // Fallback: connect directly to pair screen
            loadInWebView("http://127.0.0.1:$activePort/pair")
            return
        }

        // If PendingIntent takes longer than 4s, fallback to direct load
        lifecycleScope.launch {
            delay(4000L)
            if (webView.visibility != View.VISIBLE) {
                loadInWebView("http://127.0.0.1:$activePort")
            }
        }
    }

    private fun loadInWebView(url: String) {
        showWebView()
        webView.loadUrl(url)
    }

    private suspend fun checkHealth(port: Int): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = URL("http://127.0.0.1:$port/api/health")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 1000
            conn.readTimeout = 1000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code == 200
        } catch (_: Exception) {
            false
        }
    }
}
