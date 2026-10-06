package expo.modules.backgroundvideo

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class BackgroundVideoPreview(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  private val textureView = TextureView(context)
  private var facing = "back"

  val onCameraReady by EventDispatcher()

  init {
    addView(
      textureView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    textureView.surfaceTextureListener = this
  }

  fun setFacing(value: String) {
    val normalized = if (value == "front") "front" else "back"
    if (facing == normalized) return
    facing = normalized
    textureView.surfaceTexture?.let {
      BackgroundVideoCameraController.attachPreview(context, it, facing)
    }
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    BackgroundVideoCameraController.attachPreview(context, surface, facing) {
      onCameraReady(mapOf<String, Any>())
    }
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    BackgroundVideoCameraController.detachPreview(surface)
    return true
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
}
