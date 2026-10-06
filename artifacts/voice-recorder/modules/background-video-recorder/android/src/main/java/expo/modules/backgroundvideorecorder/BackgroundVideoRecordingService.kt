package expo.modules.backgroundvideorecorder

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Size
import android.view.Surface
import android.view.WindowManager
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class BackgroundVideoRecordingService : Service() {
  private var cameraThread: HandlerThread? = null
  private var cameraHandler: Handler? = null
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var mediaRecorder: MediaRecorder? = null
  private var outputFile: File? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val isFinishing = AtomicBoolean(false)
  private var recordingStarted = false

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      VideoRecordingContract.ACTION_STOP -> {
        finishRecording()
      }
      VideoRecordingContract.ACTION_START -> {
        if (mediaRecorder != null || cameraDevice != null) {
          failRecording("A video recording is already active.")
          return START_NOT_STICKY
        }
        val path = intent.getStringExtra(VideoRecordingContract.EXTRA_OUTPUT_PATH)
        val facing = intent.getStringExtra(VideoRecordingContract.EXTRA_FACING) ?: "back"
        if (path.isNullOrBlank()) {
          failRecording("Android did not receive a video file location.")
          return START_NOT_STICKY
        }
        outputFile = File(path)
        try {
          startRecordingForeground()
          acquireWakeLock()
          beginCameraRecording(facing)
        } catch (error: Exception) {
          failRecording(error.message ?: "Android could not start video recording.")
        }
      }
      else -> {
        stopSelf(startId)
      }
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startRecordingForeground() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Video recording",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shown while video recording continues in the background."
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val smallIcon = if (applicationInfo.icon != 0) {
      applicationInfo.icon
    } else {
      android.R.drawable.presence_video_online
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(smallIcon)
      .setContentTitle("Video recording")
      .setContentText("Video recording service is active.")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }

  private fun acquireWakeLock() {
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "$packageName:BackgroundVideoRecording",
    ).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun beginCameraRecording(facing: String) {
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Camera permission is required to record video.")
    }
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Microphone permission is required to record video audio.")
    }

    val output = outputFile ?: throw IllegalStateException("Video output is unavailable.")
    currentFacing = facing
    startCameraThread()
    prepareMediaRecorder(output)

    val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val requestedLensFacing = if (facing == "front") {
      CameraCharacteristics.LENS_FACING_FRONT
    } else {
      CameraCharacteristics.LENS_FACING_BACK
    }
    val cameraId = manager.cameraIdList.firstOrNull { id ->
      manager.getCameraCharacteristics(id)
        .get(CameraCharacteristics.LENS_FACING) == requestedLensFacing
    } ?: throw IllegalStateException("The selected camera is not available.")

    openCameraWhenAvailable(manager, cameraId, 0)
  }

  private fun openCameraWhenAvailable(
    manager: CameraManager,
    cameraId: String,
    attempt: Int,
  ) {
    if (isFinishing.get()) return
    try {
      manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
          if (isFinishing.get()) {
            camera.close()
            return
          }
          cameraDevice = camera
          createRecordingSession(camera)
        }

        override fun onDisconnected(camera: CameraDevice) {
          camera.close()
          if (!isFinishing.get()) {
            failRecording("The camera disconnected before recording finished.")
          }
        }

        override fun onError(camera: CameraDevice, error: Int) {
          camera.close()
          if (!isFinishing.get()) {
            failRecording("Android reported a camera error ($error).")
          }
        }
      }, cameraHandler)
    } catch (error: CameraAccessException) {
      val canRetry =
        (error.reason == CameraAccessException.CAMERA_IN_USE ||
          error.reason == CameraAccessException.MAX_CAMERAS_IN_USE) &&
          attempt < MAX_CAMERA_OPEN_RETRIES
      if (canRetry) {
        cameraHandler?.postDelayed(
          { openCameraWhenAvailable(manager, cameraId, attempt + 1) },
          CAMERA_OPEN_RETRY_DELAY_MS,
        )
      } else {
        failRecording(error.message ?: "Android could not access the camera.")
      }
    } catch (error: SecurityException) {
      failRecording(error.message ?: "Camera permission is no longer available.")
    }
  }

  private fun startCameraThread() {
    val thread = HandlerThread("background-video-camera")
    thread.start()
    cameraThread = thread
    cameraHandler = Handler(thread.looper)
  }

  @Suppress("DEPRECATION")
  private fun createMediaRecorder(): MediaRecorder {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaRecorder(this)
    } else {
      MediaRecorder()
    }
  }

  private fun prepareMediaRecorder(output: File) {
    val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val requestedFacing = if (currentFacing == "front") {
      CameraCharacteristics.LENS_FACING_FRONT
    } else {
      CameraCharacteristics.LENS_FACING_BACK
    }
    val cameraId = manager.cameraIdList.firstOrNull { id ->
      manager.getCameraCharacteristics(id)
        .get(CameraCharacteristics.LENS_FACING) == requestedFacing
    } ?: throw IllegalStateException("The selected camera is not available.")
    val characteristics = manager.getCameraCharacteristics(cameraId)
    val configuration = characteristics.get(
      CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP,
    ) ?: throw IllegalStateException("Android could not configure the selected camera.")
    val supportedSizes = configuration.getOutputSizes(MediaRecorder::class.java)
      ?: throw IllegalStateException("Android reported no video recording sizes.")
    val videoSize = chooseVideoSize(supportedSizes)
    val recorder = createMediaRecorder()
    mediaRecorder = recorder
    recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
    recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
    recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    recorder.setOutputFile(output.absolutePath)
    recorder.setVideoEncodingBitRate(4_000_000)
    recorder.setVideoFrameRate(30)
    recorder.setVideoSize(videoSize.width, videoSize.height)
    recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
    recorder.setAudioEncodingBitRate(128_000)
    recorder.setAudioSamplingRate(44_100)
    recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    recorder.setOrientationHint(
      getOrientationHint(
        characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0,
        requestedFacing == CameraCharacteristics.LENS_FACING_FRONT,
      ),
    )
    recorder.prepare()
  }

  private var currentFacing = "back"

  private fun chooseVideoSize(sizes: Array<Size>): Size {
    val targetWidth = 1280
    val targetHeight = 720
    return sizes.minByOrNull { size ->
      val ratioPenalty = if (size.width * 9 == size.height * 16) 0L else 1_000_000_000L
      ratioPenalty + kotlin.math.abs(size.width.toLong() * size.height - targetWidth.toLong() * targetHeight)
    } ?: throw IllegalStateException("Android did not report a usable video size.")
  }

  private fun getOrientationHint(sensorOrientation: Int, isFrontFacing: Boolean): Int {
    val rotation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      display?.rotation ?: Surface.ROTATION_0
    } else {
      @Suppress("DEPRECATION")
      (getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        .defaultDisplay.rotation
    }
    val displayDegrees = when (rotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
    return if (isFrontFacing) {
      (360 - (sensorOrientation + displayDegrees) % 360) % 360
    } else {
      (sensorOrientation - displayDegrees + 360) % 360
    }
  }

  private fun createRecordingSession(camera: CameraDevice) {
    val recorder = mediaRecorder
      ?: return failRecording("Android could not prepare the video encoder.")
    try {
      camera.createCaptureSession(
        listOf(recorder.surface),
        object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(session: CameraCaptureSession) {
            if (isFinishing.get()) {
              session.close()
              return
            }
            captureSession = session
            try {
              val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                addTarget(recorder.surface)
                set(
                  CaptureRequest.CONTROL_AF_MODE,
                  CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO,
                )
                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
              }.build()
              session.setRepeatingRequest(request, null, cameraHandler)
              recorder.start()
              recordingStarted = true
              sendEvent(
                VideoRecordingContract.EVENT_STARTED,
                Uri.fromFile(outputFile ?: throw IllegalStateException("Video output is unavailable."))
                  .toString(),
              )
            } catch (error: Exception) {
              failRecording(error.message ?: "Android could not start capturing video.")
            }
          }

          override fun onConfigureFailed(session: CameraCaptureSession) {
            session.close()
            failRecording("Android could not configure a video capture session.")
          }
        },
        cameraHandler,
      )
    } catch (error: Exception) {
      failRecording(error.message ?: "Android could not access the camera.")
    }
  }

  private fun finishRecording() {
    if (!isFinishing.compareAndSet(false, true)) return
    val output = outputFile
    var stopFailure: Exception? = null
    try {
      captureSession?.stopRepeating()
      captureSession?.abortCaptures()
    } catch (_: Exception) {
      // MediaRecorder.stop() is the authoritative finalization step.
    }
    try {
      if (recordingStarted) {
        mediaRecorder?.stop()
      }
    } catch (error: RuntimeException) {
      stopFailure = error
    }
    closeCameraResources()
    val completedFile = output
    if (stopFailure == null && completedFile != null && completedFile.exists() && completedFile.length() > 0) {
      sendEvent(VideoRecordingContract.EVENT_STOPPED, Uri.fromFile(completedFile).toString())
    } else {
      completedFile?.delete()
      sendEvent(
        VideoRecordingContract.EVENT_ERROR,
        message = stopFailure?.message ?: "The video file could not be finalized.",
      )
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun failRecording(message: String) {
    if (!isFinishing.compareAndSet(false, true)) return
    outputFile?.delete()
    closeCameraResources()
    sendEvent(VideoRecordingContract.EVENT_ERROR, message = message)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun closeCameraResources() {
    try {
      captureSession?.close()
    } catch (_: Exception) {
    }
    captureSession = null
    try {
      cameraDevice?.close()
    } catch (_: Exception) {
    }
    cameraDevice = null
    try {
      mediaRecorder?.reset()
    } catch (_: Exception) {
    }
    try {
      mediaRecorder?.release()
    } catch (_: Exception) {
    }
    mediaRecorder = null
    recordingStarted = false
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
    cameraThread?.quitSafely()
    cameraThread = null
    cameraHandler = null
  }

  private fun sendEvent(action: String, uri: String? = null, message: String? = null) {
    val intent = Intent(action).setPackage(packageName)
    if (uri != null) intent.putExtra(VideoRecordingContract.EXTRA_URI, uri)
    if (message != null) intent.putExtra(VideoRecordingContract.EXTRA_MESSAGE, message)
    sendBroadcast(intent)
  }

  override fun onDestroy() {
    if (!isFinishing.get()) {
      isFinishing.set(true)
      closeCameraResources()
      outputFile?.delete()
    }
    super.onDestroy()
  }

  private companion object {
    const val CHANNEL_ID = "background-video-recording"
    const val NOTIFICATION_ID = 4702
    const val MAX_CAMERA_OPEN_RETRIES = 20
    const val CAMERA_OPEN_RETRY_DELAY_MS = 300L
  }
}
