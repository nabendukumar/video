import { requireOptionalNativeModule } from 'expo-modules-core';

type Facing = 'back' | 'front';

type RecordingEvent = {
  uri?: string;
  message?: string;
};

type BackgroundVideoRecorderEvents = {
  onRecordingStarted: (event: RecordingEvent) => void;
  onRecordingStopped: (event: RecordingEvent) => void;
  onRecordingError: (event: RecordingEvent) => void;
};

type BackgroundVideoRecorderNativeModule = {
  addListener<EventName extends keyof BackgroundVideoRecorderEvents>(
    eventName: EventName,
    listener: BackgroundVideoRecorderEvents[EventName],
  ): { remove: () => void };
  startRecording(facing: Facing): Promise<string>;
  stopRecording(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<BackgroundVideoRecorderNativeModule>(
    'BackgroundVideoRecorder',
  );
const emitter = nativeModule;

function getNativeModule(): BackgroundVideoRecorderNativeModule {
  if (!nativeModule || !emitter) {
    throw new Error(
      'Background video recording needs an installed Android Development Build. It is not available in Expo Go.',
    );
  }
  return nativeModule;
}

function waitForEvent(
  name: 'onRecordingStarted' | 'onRecordingStopped',
  begin: () => Promise<void>,
): Promise<string> {
  const events = emitter;
  if (!events) return Promise.reject(
    new Error(
      'Background video recording needs an installed Android Development Build. It is not available in Expo Go.',
    ),
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const removeListeners = () => {
      clearTimeout(timeout);
      successSubscription.remove();
      errorSubscription.remove();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      removeListeners();
      callback();
    };
    const successSubscription = events.addListener(
      name,
      ({ uri }: RecordingEvent) => {
        if (!uri) {
          finish(() => reject(new Error('Android returned no video file.')));
        } else {
          finish(() => resolve(uri));
        }
      },
    );
    const errorSubscription = events.addListener(
      'onRecordingError',
      ({ message }: RecordingEvent) =>
        finish(() =>
          reject(new Error(message || 'Android could not record video.')),
        ),
    );

    timeout = setTimeout(() => {
      finish(() => {
        if (name === 'onRecordingStarted') {
          void getNativeModule().stopRecording().catch(() => undefined);
        }
        reject(
          new Error('Android did not respond to the video recording request.'),
        );
      });
    }, 30_000);

    const handleBeginError = (error: unknown) => {
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error('Could not communicate with the Android recorder.'),
        ),
      );
    };
    try {
      void begin().catch(handleBeginError);
    } catch (error) {
      handleBeginError(error);
    }
  });
}

export function startBackgroundVideoRecording(
  facing: Facing,
): Promise<string> {
  const module = getNativeModule();
  return waitForEvent('onRecordingStarted', async () => {
    await module.startRecording(facing);
  });
}

export function stopBackgroundVideoRecording(): Promise<string> {
  const module = getNativeModule();
  return waitForEvent('onRecordingStopped', () => module.stopRecording());
}

export function addBackgroundVideoErrorListener(
  listener: (message: string) => void,
): { remove: () => void } {
  if (!emitter) return { remove: () => undefined };
  return emitter.addListener(
    'onRecordingError',
    ({ message }: RecordingEvent) =>
      listener(message || 'Android could not continue recording video.'),
  );
}
