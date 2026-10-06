const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = '.BackgroundVideoRecordingService';
const PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.POST_NOTIFICATIONS',
];

function ensureNamedEntry(entries, name) {
  const exists = entries.some((entry) => entry.$['android:name'] === name);
  if (!exists) entries.push({ $: { 'android:name': name } });
}

module.exports = function withBackgroundVideoService(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const permission of PERMISSIONS) {
      ensureNamedEntry(manifest['uses-permission'], permission);
    }

    const application = manifest.application?.[0];
    if (!application) {
      throw new Error('Android application node is missing from the manifest.');
    }
    application.service ??= [];

    const service = application.service.find(
      (entry) => entry.$['android:name'] === SERVICE_NAME,
    );
    const declaration = {
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'false',
        'android:stopWithTask': 'false',
        'android:foregroundServiceType': 'camera|microphone',
      },
    };
    if (service) {
      service.$ = { ...service.$, ...declaration.$ };
    } else {
      application.service.push(declaration);
    }

    return modConfig;
  });
};
