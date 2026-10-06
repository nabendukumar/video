package expo.modules.backgroundvideo

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class BackgroundVideoRecordingService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopAndSave()
      ACTION_START -> {
        val facing = intent.getStringExtra(EXTRA_FACING) ?: "back"
        try {
          enterForeground()
          if (
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
          ) {
            failAndStop("Camera and microphone access are required for video recording.")
            return START_NOT_STICKY
          }
          BackgroundVideoCameraController.startRecording(
            this,
            facing,
            onStarted = {
              mainHandler.post {
                getSystemService(NotificationManager::class.java)
                  .notify(NOTIFICATION_ID, createNotification("Video is recording"))
              }
            },
            onError = { message -> mainHandler.post { failAndStop(message) } }
          )
        } catch (error: Exception) {
          failAndStop(error.message ?: "Could not start the background camera service.")
        }
      }
      else -> {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    return START_NOT_STICKY
  }

  private fun enterForeground() {
    createNotificationChannel()
    val notification = createNotification("Starting video recording")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      )
    } else {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, 0)
    }
  }

  private fun stopAndSave() {
    BackgroundVideoCameraController.stopRecording(
      onFinished = { result ->
        mainHandler.post {
          sendBroadcast(
            Intent(ACTION_RECORDING_FINISHED)
              .setPackage(packageName)
              .putExtra(EXTRA_URI, result.uri)
              .putExtra(EXTRA_DURATION_MS, result.durationMs)
          )
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        }
      },
      onError = { message -> mainHandler.post { failAndStop(message) } }
    )
  }

  private fun failAndStop(message: String) {
    sendBroadcast(
      Intent(ACTION_RECORDING_ERROR)
        .setPackage(packageName)
        .putExtra(EXTRA_MESSAGE, message)
    )
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      NOTIFICATION_CHANNEL_ID,
      "Video recording",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows when Fieldnote is recording video in the background."
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(status: String): Notification {
    val stopIntent = PendingIntent.getService(
      this,
      REQUEST_STOP,
      Intent(this, BackgroundVideoRecordingService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        REQUEST_OPEN,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setContentTitle("Fieldnote is recording")
      .setContentText(status)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .addAction(android.R.drawable.ic_media_pause, "Stop recording", stopIntent)
      .build()
  }

  companion object {
    const val ACTION_START = "expo.modules.backgroundvideo.START"
    const val ACTION_STOP = "expo.modules.backgroundvideo.STOP"
    const val ACTION_RECORDING_FINISHED = "expo.modules.backgroundvideo.RECORDING_FINISHED"
    const val ACTION_RECORDING_ERROR = "expo.modules.backgroundvideo.RECORDING_ERROR"

    const val EXTRA_FACING = "facing"
    const val EXTRA_URI = "uri"
    const val EXTRA_DURATION_MS = "durationMs"
    const val EXTRA_MESSAGE = "message"

    private const val NOTIFICATION_CHANNEL_ID = "fieldnote-video-recording"
    private const val NOTIFICATION_ID = 4702
    private const val REQUEST_STOP = 4703
    private const val REQUEST_OPEN = 4704
  }
}
