package expo.modules.backgroundvideo

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
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
import android.os.SystemClock
import android.view.Surface
import android.view.Surface.ROTATION_0
import android.view.Surface.ROTATION_90
import android.view.Surface.ROTATION_180
import android.view.Surface.ROTATION_270
import android.view.WindowManager
import android.util.Size
import java.io.File

data class FinishedBackgroundVideo(val uri: String, val durationMs: Long)

object BackgroundVideoCameraController {
  private var cameraThread: HandlerThread? = null
  private var handler: Handler? = null
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var previewSurfaceTexture: SurfaceTexture? = null
  private var previewSurface: Surface? = null
  private var recorderSurface: Surface? = null
  private var mediaRecorder: MediaRecorder? = null
  private var outputFile: File? = null
  private var recordingStartedAt = 0L
  private var isRecording = false
  private var facing = "back"
  private var openingCamera = false
  private var onCameraError: ((String) -> Unit)? = null

  @SuppressLint("MissingPermission")
  fun attachPreview(
    context: Context,
    surfaceTexture: SurfaceTexture,
    nextFacing: String,
    onReady: (() -> Unit)? = null
  ) {
    ensureThread()
    val cameraHandler = handler ?: return
    cameraHandler.post {
      if (previewSurfaceTexture !== surfaceTexture) {
        previewSurface?.release()
        previewSurfaceTexture = surfaceTexture
        val selectedSize = chooseVideoSize(context, nextFacing)
        surfaceTexture.setDefaultBufferSize(selectedSize.width, selectedSize.height)
        previewSurface = Surface(surfaceTexture)
      }
      if (isRecording && facing != nextFacing) {
        onCameraError?.invoke("The camera cannot be switched during a recording.")
        return@post
      }
      if (facing != nextFacing && !isRecording) {
        closeCamera()
        facing = nextFacing
      }
      openCameraIfNeeded(context, nextFacing, onReady)
    }
  }

  fun detachPreview(surfaceTexture: SurfaceTexture) {
    handler?.post {
      if (previewSurfaceTexture !== surfaceTexture) return@post
      previewSurfaceTexture = null
      previewSurface?.release()
      previewSurface = null
      if (!isRecording) closeCamera()
      else configureRecordingSession()
    }
  }

  fun startRecording(
    context: Context,
    requestedFacing: String,
    onStarted: () -> Unit,
    onError: (String) -> Unit
  ) {
    ensureThread()
    val cameraHandler = handler ?: run {
      onError("The camera service could not start.")
      return
    }
    cameraHandler.post {
      if (isRecording) {
        onError("A video recording is already in progress.")
        return@post
      }
      if (cameraDevice == null || previewSurface == null || facing != requestedFacing) {
        onError("The camera preview is not ready. Return to the app and try again.")
        return@post
      }
      try {
        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val characteristics = cameraManager.getCameraCharacteristics(cameraDevice!!.id)
        val recorder = MediaRecorder()
        val file = File.createTempFile("fieldnote-video-", ".mp4", context.cacheDir)
        val size = chooseVideoSize(context, requestedFacing)

        recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        recorder.setOutputFile(file.absolutePath)
        recorder.setVideoEncodingBitRate(5_000_000)
        recorder.setVideoFrameRate(30)
        recorder.setVideoSize(size.width, size.height)
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setOrientationHint(orientationHint(context, characteristics, requestedFacing))
        recorder.prepare()

        mediaRecorder = recorder
        outputFile = file
        recorderSurface = recorder.surface
        onCameraError = onError
        configureRecordingSession(
          onConfigured = {
            try {
              recorder.start()
              recordingStartedAt = SystemClock.elapsedRealtime()
              isRecording = true
              onStarted()
            } catch (error: Exception) {
              failStart(error.message ?: "Android could not start the video recorder.")
              onError(error.message ?: "Android could not start the video recorder.")
            }
          },
          onFailure = { message ->
            failStart(message)
            onError(message)
          }
        )
      } catch (error: Exception) {
        failStart(error.message ?: "Android could not prepare the video recorder.")
        onError(error.message ?: "Android could not prepare the video recorder.")
      }
    }
  }

  fun stopRecording(
    onFinished: (FinishedBackgroundVideo) -> Unit,
    onError: (String) -> Unit
  ) {
    val cameraHandler = handler
    if (cameraHandler == null) {
      onError("The video camera is not running.")
      return
    }
    cameraHandler.post {
      if (!isRecording) {
        onError("There is no active video recording to stop.")
        return@post
      }
      val recorder = mediaRecorder
      val file = outputFile
      val duration = (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
      isRecording = false
      try {
        recorder?.stop()
      } catch (error: RuntimeException) {
        failStart("The video was too short to save.")
        onError("The video was too short to save.")
        return@post
      } finally {
        releaseRecorder()
      }

      if (file == null || !file.exists() || file.length() == 0L) {
        file?.delete()
        onError("Android did not create a video file.")
        configurePreviewSession()
        return@post
      }

      configurePreviewSession()
      onFinished(FinishedBackgroundVideo(Uri.fromFile(file).toString(), duration))
    }
  }

  private fun ensureThread() {
    if (cameraThread?.isAlive == true) return
    cameraThread = HandlerThread("FieldnoteBackgroundCamera").also { it.start() }
    handler = Handler(cameraThread!!.looper)
  }

  @SuppressLint("MissingPermission")
  private fun openCameraIfNeeded(
    context: Context,
    requestedFacing: String,
    onReady: (() -> Unit)?
  ) {
    val cameraHandler = handler ?: return
    if (cameraDevice != null && !openingCamera) {
      configurePreviewSession(onReady)
      return
    }
    if (openingCamera) return
    try {
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val cameraId = findCameraId(manager, requestedFacing)
        ?: throw IllegalStateException("No ${requestedFacing} camera is available.")
      openingCamera = true
      manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
          openingCamera = false
          cameraDevice = camera
          facing = requestedFacing
          configurePreviewSession(onReady)
        }

        override fun onDisconnected(camera: CameraDevice) {
          openingCamera = false
          camera.close()
          cameraDevice = null
          if (isRecording) onCameraError?.invoke("The camera disconnected during recording.")
        }

        override fun onError(camera: CameraDevice, error: Int) {
          openingCamera = false
          camera.close()
          cameraDevice = null
          onCameraError?.invoke("Android reported a camera error ($error).")
        }
      }, cameraHandler)
    } catch (error: Exception) {
      openingCamera = false
      onCameraError?.invoke(error.message ?: "Could not open the camera.")
    }
  }

  private fun configurePreviewSession(onReady: (() -> Unit)? = null) {
    val device = cameraDevice ?: return
    val surface = previewSurface
    if (surface == null || !surface.isValid) return
    configureSession(listOf(surface), CaptureRequest.TEMPLATE_PREVIEW, onReady)
  }

  private fun configureRecordingSession(
    onConfigured: (() -> Unit)? = null,
    onFailure: ((String) -> Unit)? = null
  ) {
    val device = cameraDevice
    val videoSurface = recorderSurface
    if (device == null || videoSurface == null || !videoSurface.isValid) {
      onFailure?.invoke("The camera is not ready to start recording.")
      return
    }
    val targets = mutableListOf(videoSurface)
    previewSurface?.takeIf { it.isValid }?.let { targets.add(it) }
    configureSession(
      targets,
      CaptureRequest.TEMPLATE_RECORD,
      onConfigured,
      onFailure
    )
  }

  private fun configureSession(
    targets: List<Surface>,
    template: Int,
    onConfigured: (() -> Unit)? = null,
    onFailure: ((String) -> Unit)? = null
  ) {
    val device = cameraDevice ?: run {
      onFailure?.invoke("The camera is not open.")
      return
    }
    val cameraHandler = handler ?: return
    captureSession?.close()
    try {
      device.createCaptureSession(targets, object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
          captureSession = session
          try {
            val request = device.createCaptureRequest(template).apply {
              targets.forEach { addTarget(it) }
              set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
              set(
                CaptureRequest.CONTROL_AF_MODE,
                CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO
              )
            }.build()
            session.setRepeatingRequest(request, null, cameraHandler)
            onConfigured?.invoke()
          } catch (error: Exception) {
            onFailure?.invoke(error.message ?: "Could not start camera capture.")
          }
        }

        override fun onConfigureFailed(session: CameraCaptureSession) {
          session.close()
          onFailure?.invoke("Android could not configure the camera for video.")
        }
      }, cameraHandler)
    } catch (error: Exception) {
      onFailure?.invoke(error.message ?: "Could not configure the camera.")
    }
  }

  private fun chooseVideoSize(context: Context, requestedFacing: String): Size {
    return try {
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val cameraId = findCameraId(manager, requestedFacing) ?: return Size(1280, 720)
      val map = manager.getCameraCharacteristics(cameraId)
        .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      val sizes = map?.getOutputSizes(MediaRecorder::class.java)?.toList().orEmpty()
      sizes.firstOrNull { it.width == 1280 && it.height == 720 }
        ?: sizes.filter { it.width.toFloat() / it.height.toFloat() in 1.7f..1.8f }
          .minByOrNull { kotlin.math.abs(it.height - 720) }
        ?: sizes.maxByOrNull { it.width.toLong() * it.height.toLong() }
        ?: Size(1280, 720)
    } catch (_: Exception) {
      Size(1280, 720)
    }
  }

  private fun findCameraId(manager: CameraManager, requestedFacing: String): String? {
    val target = if (requestedFacing == "front") {
      CameraCharacteristics.LENS_FACING_FRONT
    } else {
      CameraCharacteristics.LENS_FACING_BACK
    }
    return manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == target
    }
  }

  private fun orientationHint(
    context: Context,
    characteristics: CameraCharacteristics,
    requestedFacing: String
  ): Int {
    val rotation = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val displayRotation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      context.display?.rotation ?: ROTATION_0
    } else {
      @Suppress("DEPRECATION")
      rotation.defaultDisplay.rotation
    }
    val degrees = when (displayRotation) {
      ROTATION_90 -> 90
      ROTATION_180 -> 180
      ROTATION_270 -> 270
      else -> 0
    }
    val sensor = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
    return if (requestedFacing == "front") (sensor + degrees) % 360
    else (sensor - degrees + 360) % 360
  }

  private fun failStart(message: String) {
    isRecording = false
    captureSession?.close()
    captureSession = null
    releaseRecorder()
    outputFile?.delete()
    outputFile = null
    configurePreviewSession()
    onCameraError?.invoke(message)
  }

  private fun releaseRecorder() {
    runCatching { mediaRecorder?.reset() }
    runCatching { mediaRecorder?.release() }
    mediaRecorder = null
    recorderSurface?.release()
    recorderSurface = null
  }

  private fun closeCamera() {
    captureSession?.close()
    captureSession = null
    cameraDevice?.close()
    cameraDevice = null
    openingCamera = false
  }
}
