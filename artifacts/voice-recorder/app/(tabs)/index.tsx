import { Feather } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { CameraView, type CameraType, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  addBackgroundVideoErrorListener,
  startBackgroundVideoRecording,
  stopBackgroundVideoRecording,
} from 'expo-background-video-recorder';
import {
  formatDuration,
  loadRecordings,
  saveRecording,
} from '@/lib/recordings';

type CaptureMode = 'audio' | 'video';

function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function RecorderScreen() {
  const colors = useColors();
  const router = useRouter();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    directory: 'document',
  });
  const recorderState = useAudioRecorderState(recorder, 350);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const videoPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null,
  );
  const audioSessionActiveRef = useRef(false);
  const audioFinalizingRef = useRef(false);
  const videoSessionActiveRef = useRef(false);
  const videoFinalizingRef = useRef(false);
  const startLockRef = useRef(false);
  const audioStartedAtRef = useRef(0);
  const videoStartedAtRef = useRef(0);
  const finishAudioRef = useRef<() => Promise<void>>(async () => undefined);
  const finishVideoRef = useRef<() => Promise<void>>(async () => undefined);

  const [mode, setMode] = useState<CaptureMode>('audio');
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [audioRecording, setAudioRecording] = useState(false);
  const [videoRecording, setVideoRecording] = useState(false);
  const [nativeCameraHandedOff, setNativeCameraHandedOff] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [settingsNeeded, setSettingsNeeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const isAudioRecording = audioRecording || recorderState.isRecording;
  const isRecording = isAudioRecording || videoRecording;
  const displayedDuration = isAudioRecording
    ? Math.max(recorderState.durationMillis, elapsedMs)
    : videoRecording
      ? elapsedMs
      : 0;

  useFocusEffect(
    useCallback(() => {
      let stillFocused = true;
      loadRecordings()
        .then((items) => {
          if (stillFocused) setSavedCount(items.length);
        })
        .catch(() => {
          if (stillFocused) {
            setErrorMessage('Could not load the recordings saved on this device.');
          }
        });
      return () => {
        stillFocused = false;
      };
    }, []),
  );

  useEffect(() => {
    if (!isRecording) {
      setElapsedMs(0);
      return;
    }

    const startedAt = isAudioRecording
      ? audioStartedAtRef.current
      : videoStartedAtRef.current;
    const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    update();
    const interval = setInterval(update, 300);
    return () => clearInterval(interval);
  }, [isRecording, isAudioRecording]);

  const finishAudioRecording = async () => {
    if (!audioSessionActiveRef.current || audioFinalizingRef.current) return;
    audioFinalizingRef.current = true;
    audioSessionActiveRef.current = false;
    setIsSaving(true);

    try {
      const uri = recorder.uri;
      if (!uri) {
        throw new Error('The audio file was not created. Please try again.');
      }
      const nativeDuration = recorder.getStatus().durationMillis;
      const elapsedDuration = Math.max(0, Date.now() - audioStartedAtRef.current);
      await saveRecording(
        'audio',
        uri,
        Math.max(nativeDuration, elapsedDuration),
      );
      setSavedCount((count) => count + 1);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      audioFinalizingRef.current = false;
      setAudioRecording(false);
      setIsSaving(false);
    }
  };
  finishAudioRef.current = finishAudioRecording;

  useEffect(() => {
    if (recorderState.isRecording) {
      audioSessionActiveRef.current = true;
      return;
    }
    if (audioSessionActiveRef.current) {
      void finishAudioRef.current();
    }
  }, [recorderState.isRecording]);

  const finishVideoRecording = async () => {
    if (!videoSessionActiveRef.current || videoFinalizingRef.current) return;
    videoFinalizingRef.current = true;
    setIsSaving(true);

    try {
      let sourceUri: string | undefined;
      if (Platform.OS === 'android') {
        sourceUri = await stopBackgroundVideoRecording();
      } else {
        cameraRef.current?.stopRecording();
        const result = await videoPromiseRef.current;
        sourceUri = result?.uri;
      }
      if (sourceUri) {
        await saveRecording(
          'video',
          sourceUri,
          Math.max(0, Date.now() - videoStartedAtRef.current),
        );
        setSavedCount((count) => count + 1);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      videoSessionActiveRef.current = false;
      videoPromiseRef.current = null;
      videoFinalizingRef.current = false;
      setVideoRecording(false);
      setNativeCameraHandedOff(false);
      if (Platform.OS === 'android') setCameraReady(false);
      setIsSaving(false);
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
  };
  finishVideoRef.current = finishVideoRecording;

  useEffect(() => {
    const subscription = addBackgroundVideoErrorListener((message) => {
      if (!videoSessionActiveRef.current) return;
      videoSessionActiveRef.current = false;
      setVideoRecording(false);
      setNativeCameraHandedOff(false);
      setCameraReady(false);
      setErrorMessage(message);
      void setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        nextState === 'background' &&
        Platform.OS !== 'android' &&
        videoSessionActiveRef.current
      ) {
        void finishVideoRef.current();
      }
    });
    return () => {
      subscription.remove();
      if (Platform.OS !== 'android' && videoSessionActiveRef.current) {
        cameraRef.current?.stopRecording();
        void finishVideoRef.current();
      }
    };
  }, []);

  const requestMicrophone = async (): Promise<boolean> => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setSettingsNeeded(!permission.canAskAgain);
      setErrorMessage(
        permission.canAskAgain
          ? 'Microphone access is needed to record. Allow it to continue.'
          : 'Microphone access is off. Open Settings to allow recording.',
      );
      return false;
    }
    setSettingsNeeded(false);
    setErrorMessage(null);
    return true;
  };

  const requestCamera = async () => {
    try {
      if (
        cameraPermission?.status === 'denied' &&
        !cameraPermission.canAskAgain
      ) {
        await Linking.openSettings();
        return;
      }
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setSettingsNeeded(!permission.canAskAgain);
        setErrorMessage(
          permission.canAskAgain
            ? 'Camera access is needed to record video.'
            : 'Camera access is off. Open Settings to allow video recording.',
        );
      } else {
        setSettingsNeeded(false);
        setErrorMessage(null);
      }
    } catch (error) {
      setErrorMessage(messageFromError(error));
    }
  };

  const startAudioRecording = async () => {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    try {
      if (!(await requestMicrophone())) return;
      await setAudioModeAsync({
        allowsRecording: true,
        allowsBackgroundRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      audioStartedAtRef.current = Date.now();
      audioSessionActiveRef.current = true;
      setAudioRecording(true);
      recorder.record();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      audioSessionActiveRef.current = false;
      setAudioRecording(false);
      setErrorMessage(messageFromError(error));
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      }).catch(() => undefined);
    } finally {
      startLockRef.current = false;
      setIsStarting(false);
    }
  };

  const stopAudioRecording = async () => {
    setIsStopping(true);
    try {
      await recorder.stop();
      await finishAudioRef.current();
    } catch (error) {
      setErrorMessage(messageFromError(error));
    } finally {
      setIsStopping(false);
    }
  };

  const startVideoRecording = async () => {
    setErrorMessage(null);
    if (Platform.OS === 'web') {
      setErrorMessage('Video recording is available in the Android app.');
      return;
    }
    if (!cameraRef.current || !cameraReady) {
      setErrorMessage('The camera is still getting ready. Please try again.');
      return;
    }
    if (startLockRef.current) return;
    startLockRef.current = true;
    setIsStarting(true);

    try {
      if (!(await requestMicrophone())) return;
      await setAudioModeAsync({
        allowsRecording: true,
        allowsBackgroundRecording: false,
        playsInSilentMode: true,
      });
      if (Platform.OS === 'android') {
        setNativeCameraHandedOff(true);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const uri = await startBackgroundVideoRecording(facing);
        videoStartedAtRef.current = Date.now();
        videoSessionActiveRef.current = true;
        setVideoRecording(true);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      videoStartedAtRef.current = Date.now();
      videoSessionActiveRef.current = true;
      setVideoRecording(true);
      const pendingRecording = cameraRef.current.recordAsync();
      videoPromiseRef.current = pendingRecording;
      void pendingRecording.then(
        () => {
          if (videoSessionActiveRef.current) {
            void finishVideoRef.current();
          }
        },
        (error: unknown) => {
          if (videoSessionActiveRef.current) {
            setErrorMessage(messageFromError(error));
            void finishVideoRef.current();
          }
        },
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      videoSessionActiveRef.current = false;
      setVideoRecording(false);
      setNativeCameraHandedOff(false);
      if (Platform.OS === 'android') setCameraReady(false);
      setErrorMessage(messageFromError(error));
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      }).catch(() => undefined);
    } finally {
      startLockRef.current = false;
      setIsStarting(false);
    }
  };

  const stopVideoRecording = async () => {
    await finishVideoRef.current();
  };

  const onRecordPress = () => {
    if (isSaving || isStopping || isStarting) return;
    if (isAudioRecording) {
      void stopAudioRecording();
    } else if (videoRecording) {
      void stopVideoRecording();
    } else if (mode === 'audio') {
      void startAudioRecording();
    } else {
      void startVideoRecording();
    }
  };

  const stopRecording = () => {
    if (isAudioRecording) {
      void stopAudioRecording();
    } else if (videoRecording) {
      void stopVideoRecording();
    }
  };

  const changeMode = (nextMode: CaptureMode) => {
    if (isRecording || isSaving || isStopping || isStarting) return;
    setErrorMessage(null);
    setCameraReady(false);
    setMode(nextMode);
  };

  const openSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      setErrorMessage('Open this app’s settings to update its permissions.');
    }
  };

  const isDark = useColorScheme() === 'dark';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View
        style={[
          styles.header,
          Platform.OS === 'web' && styles.webHeader,
        ]}
      >
        <View style={styles.brand}>
          <View style={[styles.brandIcon, { backgroundColor: colors.primary }]}>
            <Feather name="mic" size={17} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.brandName, { color: colors.foreground }]}>
            FIELDNOTE
          </Text>
        </View>
        {isRecording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            accessibilityHint="Stops and saves the current recording"
            testID="header-stop-recording"
            disabled={isSaving || isStopping || isStarting}
            onPress={stopRecording}
            style={({ pressed }) => [
              styles.headerStopButton,
              {
                backgroundColor: colors.destructive,
                opacity:
                  isSaving || isStopping || isStarting
                    ? 0.55
                    : pressed
                      ? 0.8
                      : 1,
              },
            ]}
          >
            <View
              style={[
                styles.headerStopSquare,
                { backgroundColor: colors.destructiveForeground },
              ]}
            />
            <Text
              style={[
                styles.headerStopText,
                { color: colors.destructiveForeground },
              ]}
            >
              STOP
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.localBadge, { borderColor: colors.border }]}>
            <Feather name="lock" size={12} color={colors.mutedForeground} />
            <Text
              style={[styles.localBadgeText, { color: colors.mutedForeground }]}
            >
              ON DEVICE
            </Text>
          </View>
        )}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          Platform.OS === 'web' && styles.webInsets,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            A LITTLE SPACE TO REMEMBER
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Record what{'\n'}matters.
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Voice and video, kept right here on this phone.
          </Text>
        </View>

        <View
          style={[
            styles.modeSwitch,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          {(['audio', 'video'] as const).map((captureMode) => {
            const selected = mode === captureMode;
            return (
              <Pressable
                key={captureMode}
                accessibilityRole="tab"
                accessibilityState={{ selected, disabled: isRecording }}
                accessibilityLabel={`Switch to ${captureMode} recording`}
                testID={`mode-${captureMode}`}
                disabled={isRecording || isSaving || isStopping || isStarting}
                onPress={() => changeMode(captureMode)}
                style={[
                  styles.modeButton,
                  selected && [
                    styles.modeButtonSelected,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ],
                ]}
              >
                <Feather
                  name={captureMode === 'audio' ? 'mic' : 'video'}
                  size={16}
                  color={selected ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.modeButtonText,
                    {
                      color: selected
                        ? colors.foreground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {captureMode === 'audio' ? 'VOICE' : 'VIDEO'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'audio' ? (
          <AudioDeck
            colors={colors}
            isRecording={isAudioRecording}
            duration={formatDuration(displayedDuration)}
          />
        ) : (
          <VideoDeck
            colors={colors}
            permission={cameraPermission}
            requestPermission={requestCamera}
            cameraRef={cameraRef}
            cameraReady={cameraReady}
            setCameraReady={setCameraReady}
            facing={facing}
            setFacing={setFacing}
            isRecording={videoRecording}
            nativeRecording={nativeCameraHandedOff}
            duration={formatDuration(displayedDuration)}
          />
        )}

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isRecording
                ? 'Stop recording'
                : mode === 'audio'
                  ? 'Start voice recording'
                  : 'Start video recording'
            }
            testID="record-toggle"
            disabled={
              isSaving ||
              isStopping ||
              isStarting ||
              (mode === 'video' && (!cameraPermission?.granted || !cameraReady)) ||
              (mode === 'video' && Platform.OS === 'web')
            }
            onPress={onRecordPress}
            style={({ pressed }) => [
              styles.recordButtonOuter,
              {
                borderColor: isRecording ? colors.primary : colors.border,
                opacity:
                  isSaving || isStopping || isStarting
                    ? 0.58
                    : pressed
                      ? 0.82
                      : 1,
              },
            ]}
          >
            <View
              style={[
                styles.recordButtonInner,
                { backgroundColor: isRecording ? colors.primary : colors.foreground },
              ]}
            >
              {isSaving || isStopping || isStarting ? (
                <ActivityIndicator
                  size="small"
                  color={isRecording ? colors.primaryForeground : colors.card}
                />
              ) : isRecording ? (
                <View
                  style={[
                    styles.stopSquare,
                    { backgroundColor: colors.primaryForeground },
                  ]}
                />
              ) : (
                <Feather
                  name={mode === 'audio' ? 'mic' : 'video'}
                  size={25}
                  color={colors.card}
                />
              )}
            </View>
          </Pressable>
          <Text style={[styles.controlLabel, { color: colors.foreground }]}>
            {isStarting
              ? 'PREPARING TO RECORD'
              : isSaving
              ? 'SAVING TO THIS DEVICE'
              : isStopping
                ? 'STOPPING RECORDING'
                : isRecording
                  ? 'TAP TO STOP'
                  : mode === 'audio'
                    ? 'TAP TO RECORD VOICE'
                    : 'TAP TO RECORD VIDEO'}
          </Text>
          <Text style={[styles.controlHint, { color: colors.mutedForeground }]}>
            {isRecording
              ? `${mode === 'audio' ? 'VOICE' : 'VIDEO'} · ${formatDuration(displayedDuration)}`
              : 'Nothing records until you start it.'}
          </Text>
        </View>

        {errorMessage ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <View style={styles.errorCopy}>
              <Text style={[styles.errorText, { color: colors.foreground }]}>
                {errorMessage}
              </Text>
              {settingsNeeded ? (
                <Pressable
                  accessibilityRole="button"
                  testID="open-settings"
                  onPress={() => void openSettings()}
                  hitSlop={8}
                >
                  <Text style={[styles.settingsLink, { color: colors.primary }]}>
                    Open app settings
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss message"
              testID="dismiss-error"
              onPress={() => setErrorMessage(null)}
              hitSlop={10}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.accent,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View
            style={[
              styles.infoIcon,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather
              name={mode === 'audio' ? 'moon' : 'sun'}
              size={16}
              color={colors.accentForeground}
            />
          </View>
          <View style={styles.infoCopy}>
            <Text style={[styles.infoTitle, { color: colors.foreground }]}>
              {mode === 'audio'
                ? 'Audio can continue screen-off'
                : 'Android background video'}
            </Text>
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {mode === 'audio'
                ? 'Android shows an ongoing recording notification with a stop action. You can end the recording there at any time.'
                : 'Android uses a camera foreground service to support recording while minimized or with the screen off.'}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${savedCount} saved recordings`}
          testID="open-library"
          onPress={() => router.navigate('/library')}
          style={[
            styles.libraryLink,
            { borderTopColor: colors.border, borderBottomColor: colors.border },
          ]}
        >
          <View style={styles.libraryIconWrap}>
            <Feather name="folder" size={18} color={colors.primary} />
          </View>
          <View style={styles.libraryCopy}>
            <Text style={[styles.libraryTitle, { color: colors.foreground }]}>
              Your recordings
            </Text>
            <Text style={[styles.libraryCount, { color: colors.mutedForeground }]}>
              {savedCount === 1 ? '1 recording saved' : `${savedCount} recordings saved`}
            </Text>
          </View>
          <Feather name="arrow-up-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          No automatic uploads. Your recordings stay on this device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type Theme = ReturnType<typeof useColors>;

function AudioDeck({
  colors,
  isRecording,
  duration,
}: {
  colors: Theme;
  isRecording: boolean;
  duration: string;
}) {
  const barHeights = [14, 25, 18, 34, 22, 42, 27, 17, 31, 45, 24, 38, 18, 29, 16];
  return (
    <LinearGradient
      colors={[colors.card, colors.muted]}
      style={[
        styles.audioDeck,
        { borderColor: colors.border, borderRadius: colors.radius },
      ]}
    >
      <View style={styles.deckTopRow}>
        <View style={styles.deckStatus}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isRecording ? colors.primary : colors.accentForeground },
            ]}
          />
          <Text style={[styles.deckStatusText, { color: colors.mutedForeground }]}>
            {isRecording ? 'RECORDING' : 'READY'}
          </Text>
        </View>
        <Feather name="volume-2" size={17} color={colors.mutedForeground} />
      </View>

      <View style={styles.audioArtwork}>
        <View
          style={[
            styles.artworkOuterRing,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <View
            style={[
              styles.artworkInnerRing,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <Feather name="mic" size={31} color={colors.accentForeground} />
          </View>
        </View>
      </View>

      <Text style={[styles.timer, { color: colors.foreground }]}>{duration}</Text>
      <Text style={[styles.deckCaption, { color: colors.mutedForeground }]}>
        {isRecording ? 'CAPTURING EVERY WORD' : 'VOICE NOTE'}
      </Text>

      <View style={styles.waveform} accessibilityLabel="Audio waveform decoration">
        {barHeights.map((height, index) => (
          <View
            key={`${height}-${index}`}
            style={[
              styles.waveBar,
              {
                height,
                backgroundColor:
                  isRecording && index % 3 === 0
                    ? colors.primary
                    : colors.accentForeground,
                opacity: isRecording ? 0.9 : 0.52,
              },
            ]}
          />
        ))}
      </View>
    </LinearGradient>
  );
}

function VideoDeck({
  colors,
  permission,
  requestPermission,
  cameraRef,
  cameraReady,
  setCameraReady,
  facing,
  setFacing,
  isRecording,
  nativeRecording,
  duration,
}: {
  colors: Theme;
  permission: Awaited<ReturnType<typeof useCameraPermissions>>[0];
  requestPermission: () => Promise<void>;
  cameraRef: React.RefObject<CameraView | null>;
  cameraReady: boolean;
  setCameraReady: (ready: boolean) => void;
  facing: CameraType;
  setFacing: React.Dispatch<React.SetStateAction<CameraType>>;
  isRecording: boolean;
  nativeRecording: boolean;
  duration: string;
}) {
  const permanentlyDenied =
    permission?.status === 'denied' && !permission.canAskAgain;

  return (
    <View
      style={[
        styles.videoDeck,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      {Platform.OS === 'web' ? (
        <View style={styles.cameraPermission}>
          <View
            style={[
              styles.permissionIcon,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <Feather name="smartphone" size={23} color={colors.accentForeground} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.foreground }]}>
            Open on Android to record video
          </Text>
          <Text style={[styles.permissionText, { color: colors.mutedForeground }]}>
            The camera recorder needs the installed Android app.
          </Text>
        </View>
      ) : !permission ? (
        <View style={styles.cameraPermission}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.permissionText, { color: colors.mutedForeground }]}>
            Checking camera permission…
          </Text>
        </View>
      ) : permission.granted ? (
        <View
          style={[
            styles.cameraFrame,
            { backgroundColor: colors.background },
          ]}
        >
          {nativeRecording ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode="video"
              videoQuality="720p"
              onCameraReady={() => setCameraReady(true)}
            />
          )}
          <View style={styles.cameraTopOverlay}>
            <View
              style={[
                styles.previewPill,
                { backgroundColor: colors.foreground },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isRecording
                      ? colors.destructive
                      : colors.card,
                  },
                ]}
              />
              <Text
                style={[
                  styles.previewPillText,
                  { color: colors.card },
                ]}
              >
                {isRecording ? `REC  ${duration}` : 'LIVE PREVIEW'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch camera"
              testID="flip-camera"
              disabled={isRecording}
              onPress={() =>
                setFacing((current) => (current === 'back' ? 'front' : 'back'))
              }
              style={({ pressed }) => [
                styles.flipCamera,
                {
                  backgroundColor: colors.foreground,
                  opacity: isRecording ? 0.45 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="refresh-cw" size={17} color={colors.card} />
            </Pressable>
          </View>
          {!cameraReady ? (
            <View
              style={[
                styles.cameraLoading,
                { backgroundColor: colors.background },
              ]}
            >
              <ActivityIndicator color={colors.card} />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.cameraPermission}>
          <View
            style={[
              styles.permissionIcon,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <Feather name="video" size={23} color={colors.accentForeground} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.foreground }]}>
            Camera stays off until you allow it
          </Text>
          <Text style={[styles.permissionText, { color: colors.mutedForeground }]}>
            Choose video mode to preview the camera. Nothing is captured until you press record.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              permanentlyDenied ? 'Open camera settings' : 'Allow camera access'
            }
            testID="request-camera"
            onPress={() => void requestPermission()}
            style={({ pressed }) => [
              styles.permissionButton,
              { backgroundColor: colors.foreground, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.permissionButtonText, { color: colors.card }]}>
              {permanentlyDenied ? 'OPEN SETTINGS' : 'ALLOW CAMERA'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 26,
  },
  webInsets: {
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  webHeader: {
    paddingTop: 67,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  brandIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 1.9,
  },
  localBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  localBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.1,
  },
  headerStopButton: {
    minWidth: 80,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  headerStopSquare: {
    width: 9,
    height: 9,
    borderRadius: 2,
  },
  headerStopText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
  },
  heading: {
    marginBottom: 21,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.65,
    marginBottom: 11,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 38,
    lineHeight: 43,
    letterSpacing: -1.3,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 15,
    padding: 4,
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 11,
  },
  modeButtonSelected: {
    boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.05)',
    elevation: 1,
  },
  modeButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.3,
  },
  audioDeck: {
    borderWidth: 1,
    borderRadius: 24,
    minHeight: 288,
    paddingHorizontal: 19,
    paddingTop: 17,
    paddingBottom: 17,
    alignItems: 'center',
    overflow: 'hidden',
  },
  deckTopRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deckStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  deckStatusText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.25,
  },
  audioArtwork: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 7,
  },
  artworkOuterRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkInnerRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    fontFamily: 'Inter_500Medium',
    fontSize: 34,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  deckCaption: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.8,
    marginTop: 4,
  },
  waveform: {
    height: 47,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 9,
  },
  waveBar: {
    width: 3,
    borderRadius: 3,
  },
  videoDeck: {
    height: 288,
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  cameraFrame: {
    flex: 1,
    overflow: 'hidden',
  },
  cameraTopOverlay: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  previewPillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1,
  },
  flipCamera: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPermission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 27,
    gap: 12,
  },
  permissionIcon: {
    width: 57,
    height: 57,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  permissionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  permissionButton: {
    minHeight: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 2,
  },
  permissionButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
  },
  controls: {
    alignItems: 'center',
    paddingTop: 17,
    paddingBottom: 17,
  },
  recordButtonOuter: {
    width: 83,
    height: 83,
    borderRadius: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonInner: {
    width: 65,
    height: 65,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 19,
    height: 19,
    borderRadius: 4,
  },
  controlLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 10,
  },
  controlHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 5,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 13,
  },
  errorCopy: {
    flex: 1,
    gap: 7,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 18,
  },
  settingsLink: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  infoIcon: {
    width: 33,
    height: 33,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCopy: {
    flex: 1,
    gap: 4,
  },
  infoTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 17,
  },
  libraryLink: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  libraryIconWrap: {
    width: 36,
  },
  libraryCopy: {
    flex: 1,
    gap: 3,
  },
  libraryTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  libraryCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  footerNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 13,
  },
});
