import {
  requireNativeModule,
  requireNativeViewManager,
} from 'expo-modules-core';

export type BackgroundVideoResult = {
  uri: string;
  durationMs: number;
};

export type BackgroundVideoModuleEvents = {
  onRecordingFinished: (result: BackgroundVideoResult) => void;
  onRecordingError: (event: { message: string }) => void;
};

export type BackgroundVideoModule = {
  startRecording(facing: 'front' | 'back'): Promise<void>;
  stopRecording(): Promise<BackgroundVideoResult>;
  addListener<EventName extends keyof BackgroundVideoModuleEvents>(
    eventName: EventName,
    listener: BackgroundVideoModuleEvents[EventName],
  ): { remove: () => void };
};

export type BackgroundVideoPreviewProps = {
  facing: 'front' | 'back';
  onCameraReady?: () => void;
  style?: object;
};

export const BackgroundVideo = requireNativeModule<BackgroundVideoModule>(
  'BackgroundVideo',
);

export const BackgroundVideoPreview =
  requireNativeViewManager<BackgroundVideoPreviewProps>(
    'BackgroundVideoPreview',
  );
