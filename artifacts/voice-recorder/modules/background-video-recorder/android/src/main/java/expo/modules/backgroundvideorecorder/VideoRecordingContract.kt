package expo.modules.backgroundvideorecorder

internal object VideoRecordingContract {
  const val ACTION_START = "expo.modules.backgroundvideorecorder.START"
  const val ACTION_STOP = "expo.modules.backgroundvideorecorder.STOP"
  const val EVENT_STARTED = "expo.modules.backgroundvideorecorder.RECORDING_STARTED"
  const val EVENT_STOPPED = "expo.modules.backgroundvideorecorder.RECORDING_STOPPED"
  const val EVENT_ERROR = "expo.modules.backgroundvideorecorder.RECORDING_ERROR"
  const val EXTRA_OUTPUT_PATH = "outputPath"
  const val EXTRA_FACING = "facing"
  const val EXTRA_URI = "uri"
  const val EXTRA_MESSAGE = "message"
}
