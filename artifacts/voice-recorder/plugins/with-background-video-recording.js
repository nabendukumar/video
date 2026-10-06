const { withAndroidManifest } = require('@expo/config-plugins');

const requiredPermissions = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.WAKE_LOCK',
];

module.exports = function withBackgroundVideoRecording(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    const existingPermissions = new Set(
      permissions.map((permission) => permission.$?.['android:name']),
    );

    for (const permission of requiredPermissions) {
      if (!existingPermissions.has(permission)) {
        permissions.push({ $: { 'android:name': permission } });
      }
    }
    manifest['uses-permission'] = permissions;

    const services = manifest.application?.[0]?.service ?? [];
    const serviceName =
      'expo.modules.backgroundvideorecorder.BackgroundVideoRecordingService';
    if (
      !services.some(
        (service) => service.$?.['android:name'] === serviceName,
      )
    ) {
      services.push({
        $: {
          'android:name': serviceName,
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'camera|microphone',
          'android:stopWithTask': 'false',
        },
      });
    }
    manifest.application[0].service = services;
    return mod;
  });
};
