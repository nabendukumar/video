package expo.modules.backgroundvideo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundVideoModule : Module() {
  private var receiver: BroadcastReceiver? = null
  private var pendingStopPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("BackgroundVideo")
    Events(
      BackgroundVideoRecordingService.ACTION_RECORDING_FINISHED,
      BackgroundVideoRecordingService.ACTION_RECORDING_ERROR
    )

    View(BackgroundVideoPreview::class) {
      Events("onCameraReady")
      Prop("facing") { view: BackgroundVideoPreview, facing: String ->
        view.setFacing(facing)
      }
    }

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          when (intent.action) {
            BackgroundVideoRecordingService.ACTION_RECORDING_FINISHED -> {
              val result = mapOf(
                "uri" to (intent.getStringExtra(BackgroundVideoRecordingService.EXTRA_URI) ?: ""),
                "durationMs" to intent.getLongExtra(BackgroundVideoRecordingService.EXTRA_DURATION_MS, 0L)
              )
              sendEvent(BackgroundVideoRecordingService.ACTION_RECORDING_FINISHED, result)
              pendingStopPromise?.resolve(result)
              pendingStopPromise = null
            }
            BackgroundVideoRecordingService.ACTION_RECORDING_ERROR -> {
              val message = intent.getStringExtra(BackgroundVideoRecordingService.EXTRA_MESSAGE)
                ?: "Background video recording failed."
              sendEvent(BackgroundVideoRecordingService.ACTION_RECORDING_ERROR, mapOf("message" to message))
              pendingStopPromise?.reject("E_BACKGROUND_VIDEO", message, null)
              pendingStopPromise = null
            }
          }
        }
      }

      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter().apply {
          addAction(BackgroundVideoRecordingService.ACTION_RECORDING_FINISHED)
          addAction(BackgroundVideoRecordingService.ACTION_RECORDING_ERROR)
        },
        ContextCompat.RECEIVER_NOT_EXPORTED
      )
    }

    OnDestroy {
      val context = appContext.reactContext
      if (context != null && receiver != null) {
        runCatching { context.unregisterReceiver(receiver) }
      }
      receiver = null
      pendingStopPromise = null
    }

    AsyncFunction("startRecording") { facing: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android app context is not available.")
      val intent = Intent(context, BackgroundVideoRecordingService::class.java)
        .setAction(BackgroundVideoRecordingService.ACTION_START)
        .putExtra(BackgroundVideoRecordingService.EXTRA_FACING, facing)
      ContextCompat.startForegroundService(context, intent)
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android app context is not available.")
      if (pendingStopPromise != null) {
        promise.reject("E_STOP_IN_PROGRESS", "A video recording is already stopping.", null)
        return@AsyncFunction
      }
      pendingStopPromise = promise
      context.startService(
        Intent(context, BackgroundVideoRecordingService::class.java)
          .setAction(BackgroundVideoRecordingService.ACTION_STOP)
      )
    }
  }
}
