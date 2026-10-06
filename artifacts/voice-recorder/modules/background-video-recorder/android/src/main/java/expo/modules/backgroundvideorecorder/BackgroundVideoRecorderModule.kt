package expo.modules.backgroundvideorecorder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class BackgroundVideoRecorderModule : Module() {
  private var receiver: BroadcastReceiver? = null
  @Volatile
  private var recordingActive = false

  override fun definition() = ModuleDefinition {
    Name("BackgroundVideoRecorder")
    Events("onRecordingStarted", "onRecordingStopped", "onRecordingError")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      val eventReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          when (intent.action) {
            VideoRecordingContract.EVENT_STARTED -> {
              recordingActive = true
              sendEvent(
                "onRecordingStarted",
                mapOf("uri" to intent.getStringExtra(VideoRecordingContract.EXTRA_URI)),
              )
            }
            VideoRecordingContract.EVENT_STOPPED -> {
              recordingActive = false
              sendEvent(
                "onRecordingStopped",
                mapOf("uri" to intent.getStringExtra(VideoRecordingContract.EXTRA_URI)),
              )
            }
            VideoRecordingContract.EVENT_ERROR -> {
              recordingActive = false
              sendEvent(
                "onRecordingError",
                mapOf("message" to intent.getStringExtra(VideoRecordingContract.EXTRA_MESSAGE)),
              )
            }
          }
        }
      }
      val filter = IntentFilter().apply {
        addAction(VideoRecordingContract.EVENT_STARTED)
        addAction(VideoRecordingContract.EVENT_STOPPED)
        addAction(VideoRecordingContract.EVENT_ERROR)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(eventReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(eventReceiver, filter)
      }
      receiver = eventReceiver
    }

    OnDestroy {
      val context = appContext.reactContext
      val registeredReceiver = receiver
      if (context != null && registeredReceiver != null) {
        try {
          context.unregisterReceiver(registeredReceiver)
        } catch (_: IllegalArgumentException) {
          // The React context may already have unregistered during teardown.
        }
      }
      receiver = null
    }

    AsyncFunction("startRecording") { facing: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android application context is unavailable.")
      if (recordingActive) {
        throw IllegalStateException("A video recording is already active.")
      }

      val outputDirectory = File(context.cacheDir, "video-recordings")
      if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
        throw IllegalStateException("Could not prepare local video storage.")
      }
      val outputFile = File(outputDirectory, "video-${System.currentTimeMillis()}.mp4")
      val intent = Intent(context, BackgroundVideoRecordingService::class.java).apply {
        action = VideoRecordingContract.ACTION_START
        putExtra(VideoRecordingContract.EXTRA_OUTPUT_PATH, outputFile.absolutePath)
        putExtra(VideoRecordingContract.EXTRA_FACING, facing)
      }

      recordingActive = true
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (error: Exception) {
        recordingActive = false
        outputFile.delete()
        throw error
      }
      Uri.fromFile(outputFile).toString()
    }

    AsyncFunction("stopRecording") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android application context is unavailable.")
      if (recordingActive) {
        context.startService(
          Intent(context, BackgroundVideoRecordingService::class.java).apply {
            action = VideoRecordingContract.ACTION_STOP
          },
        )
      }
    }
  }
}
