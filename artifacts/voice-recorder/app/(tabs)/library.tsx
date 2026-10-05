import { Feather } from '@expo/vector-icons';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  useColorScheme,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import {
  formatDuration,
  formatRecordingDate,
  loadRecordings,
  removeRecording,
  type LocalRecording,
} from '@/lib/recordings';

type Theme = ReturnType<typeof useColors>;

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function LibraryScreen() {
  const colors = useColors();
  const [recordings, setRecordings] = useState<LocalRecording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<LocalRecording | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocalRecording | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async (refreshing = false) => {
    if (refreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);
    try {
      setRecordings(await loadRecordings());
    } catch (error) {
      setErrorMessage(errorText(error));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const shareRecording = async (recording: LocalRecording) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setErrorMessage('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(recording.uri, {
        dialogTitle: 'Share recording',
        mimeType: recording.kind === 'audio' ? 'audio/mp4' : 'video/mp4',
      });
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setDeletingId(target.id);
    setErrorMessage(null);
    try {
      await removeRecording(target);
      setRecordings((current) => current.filter((item) => item.id !== target.id));
      if (playback?.id === target.id) setPlayback(null);
    } catch (error) {
      setErrorMessage(errorText(error));
    } finally {
      setDeletingId(null);
    }
  };

  const isDark = useColorScheme() === 'dark';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={[styles.page, Platform.OS === 'web' && styles.webInsets]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              STORED ON THIS DEVICE
            </Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Your recordings
            </Text>
          </View>
          <View
            style={[
              styles.countPill,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.countText, { color: colors.foreground }]}>
              {recordings.length}
            </Text>
          </View>
        </View>

        {errorMessage ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>
              {errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading recordings"
              testID="retry-library"
              onPress={() => void refresh(true)}
            >
              <Feather name="refresh-cw" size={17} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Loading your recordings…
            </Text>
          </View>
        ) : recordings.length === 0 ? (
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: colors.accent, borderColor: colors.border },
              ]}
            >
              <Feather name="mic" size={25} color={colors.accentForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Nothing recorded yet
            </Text>
            <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>
              Start a voice or video recording and it will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={recordings}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => void refresh(true)}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => (
              <RecordingRow
                colors={colors}
                recording={item}
                deleting={deletingId === item.id}
                onOpen={() => setPlayback(item)}
                onShare={() => void shareRecording(item)}
                onDelete={() => setPendingDelete(item)}
              />
            )}
            ListFooterComponent={
              <Text style={[styles.listFootnote, { color: colors.mutedForeground }]}>
                Files stay on this device until you share or delete them.
              </Text>
            }
          />
        )}
      </View>

      <Modal
        visible={playback !== null}
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={() => setPlayback(null)}
      >
        {playback ? (
          playback.kind === 'audio' ? (
            <AudioPreview
              colors={colors}
              recording={playback}
              onClose={() => setPlayback(null)}
            />
          ) : (
            <VideoPreview
              colors={colors}
              recording={playback}
              onClose={() => setPlayback(null)}
            />
          )
        ) : null}
      </Modal>

      <Modal
        visible={pendingDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <View style={styles.confirmBackdrop}>
          <View
            style={[
              styles.confirmCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <View
              style={[
                styles.confirmIcon,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather name="trash-2" size={19} color={colors.destructive} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
              Delete this recording?
            </Text>
            <Text style={[styles.confirmCopy, { color: colors.mutedForeground }]}>
              This removes the file from this device. It cannot be undone.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                testID="cancel-delete"
                onPress={() => setPendingDelete(null)}
                style={[
                  styles.confirmButton,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.confirmButtonText, { color: colors.foreground }]}>
                  KEEP FILE
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                testID="confirm-delete"
                onPress={() => void confirmDelete()}
                style={[
                  styles.confirmButton,
                  { backgroundColor: colors.destructive, borderColor: colors.destructive },
                ]}
              >
                <Text
                  style={[
                    styles.confirmButtonText,
                    { color: colors.destructiveForeground },
                  ]}
                >
                  DELETE
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RecordingRow({
  colors,
  recording,
  deleting,
  onOpen,
  onShare,
  onDelete,
}: {
  colors: Theme;
  recording: LocalRecording;
  deleting: boolean;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  return (
    <View
      style={[
        styles.recordingRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${recording.kind} recording`}
        testID={`play-${recording.id}`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.recordingMain,
          { opacity: pressed ? 0.76 : 1 },
        ]}
      >
        <View
          style={[
            styles.recordingIcon,
            { backgroundColor: colors.accent, borderColor: colors.border },
          ]}
        >
          <Feather
            name={recording.kind === 'audio' ? 'headphones' : 'video'}
            size={18}
            color={colors.accentForeground}
          />
        </View>
        <View style={styles.recordingCopy}>
          <Text style={[styles.recordingTitle, { color: colors.foreground }]}>
            {recording.kind === 'audio' ? 'Voice recording' : 'Video recording'}
          </Text>
          <Text style={[styles.recordingMeta, { color: colors.mutedForeground }]}>
            {formatRecordingDate(recording.createdAt)} · {formatDuration(recording.durationMs)}
          </Text>
        </View>
        <Feather name="play" size={17} color={colors.primary} />
      </Pressable>

      <View style={[styles.rowActions, { borderTopColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share recording"
          testID={`share-${recording.id}`}
          onPress={onShare}
          style={styles.rowAction}
        >
          <Feather name="share" size={15} color={colors.mutedForeground} />
          <Text style={[styles.rowActionText, { color: colors.mutedForeground }]}>
            SHARE
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete recording"
          testID={`delete-${recording.id}`}
          disabled={deleting}
          onPress={onDelete}
          style={styles.rowAction}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Feather name="trash-2" size={15} color={colors.destructive} />
          )}
          <Text style={[styles.rowActionText, { color: colors.destructive }]}>
            DELETE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function PlayerHeader({
  colors,
  title,
  onClose,
}: {
  colors: Theme;
  title: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.playerHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close playback"
        testID="close-playback"
        onPress={onClose}
        style={[
          styles.closeButton,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="x" size={19} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.playerTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <View style={styles.closeButtonSpacer} />
    </View>
  );
}

function AudioPreview({
  colors,
  recording,
  onClose,
}: {
  colors: Theme;
  recording: LocalRecording;
  onClose: () => void;
}) {
  const player = useAudioPlayer(recording.uri);
  const status = useAudioPlayerStatus(player);

  React.useEffect(() => {
    player.play();
    return () => player.pause();
  }, [player]);

  return (
    <SafeAreaView
      style={[styles.playerScreen, { backgroundColor: colors.background }]}
    >
      <PlayerHeader
        colors={colors}
        title="VOICE RECORDING"
        onClose={onClose}
      />
      <View style={styles.audioPlayerBody}>
        <View
          style={[
            styles.playerArtOuter,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.playerArtInner,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <Feather name="mic" size={37} color={colors.accentForeground} />
          </View>
        </View>
        <Text style={[styles.playerTrackTitle, { color: colors.foreground }]}>
          Voice recording
        </Text>
        <Text style={[styles.playerTrackDate, { color: colors.mutedForeground }]}>
          {formatRecordingDate(recording.createdAt)}
        </Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${
                  status.duration > 0
                    ? Math.min(100, (status.currentTime / status.duration) * 100)
                    : 0
                }%`,
              },
            ]}
          />
        </View>
        <View style={styles.playbackTimes}>
          <Text style={[styles.playbackTime, { color: colors.mutedForeground }]}>
            {formatDuration(status.currentTime * 1000)}
          </Text>
          <Text style={[styles.playbackTime, { color: colors.mutedForeground }]}>
            {formatDuration(status.duration * 1000)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause playback' : 'Play recording'}
          testID="toggle-audio-playback"
          onPress={() => {
            if (status.playing) player.pause();
            else player.play();
          }}
          style={({ pressed }) => [
            styles.playButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Feather
            name={status.playing ? 'pause' : 'play'}
            size={21}
            color={colors.primaryForeground}
          />
        </Pressable>
      </View>
      <Text style={[styles.playerFooter, { color: colors.mutedForeground }]}>
        Saved privately on this device
      </Text>
    </SafeAreaView>
  );
}

function VideoPreview({
  colors,
  recording,
  onClose,
}: {
  colors: Theme;
  recording: LocalRecording;
  onClose: () => void;
}) {
  const player = useVideoPlayer(recording.uri, (videoPlayer) => {
    videoPlayer.play();
  });

  return (
    <SafeAreaView
      style={[styles.playerScreen, { backgroundColor: colors.background }]}
    >
      <PlayerHeader
        colors={colors}
        title="VIDEO RECORDING"
        onClose={onClose}
      />
      <View style={styles.videoPlayerBody}>
        <VideoView
          player={player}
          style={[
            styles.videoPlayer,
            { backgroundColor: colors.background },
          ]}
          nativeControls
          fullscreenOptions={{ enable: true }}
        />
        <Text style={[styles.playerTrackTitle, { color: colors.foreground }]}>
          Video recording
        </Text>
        <Text style={[styles.playerTrackDate, { color: colors.mutedForeground }]}>
          {formatRecordingDate(recording.createdAt)}
        </Text>
      </View>
      <Text style={[styles.playerFooter, { color: colors.mutedForeground }]}>
        Saved privately on this device
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  page: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
  },
  webInsets: {
    paddingTop: 67,
    paddingBottom: 34,
  },
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 17,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -0.8,
  },
  countPill: {
    minWidth: 39,
    height: 39,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 52,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    marginBottom: 7,
  },
  emptyCopy: {
    maxWidth: 245,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  listContent: {
    gap: 12,
    paddingBottom: 28,
  },
  recordingRow: {
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  recordingMain: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingBottom: 12,
  },
  recordingIcon: {
    width: 41,
    height: 41,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCopy: {
    flex: 1,
    gap: 4,
  },
  recordingTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  recordingMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  rowActions: {
    minHeight: 42,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
  },
  rowAction: {
    minWidth: 65,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rowActionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  listFootnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    paddingVertical: 11,
  },
  confirmBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  confirmCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 21,
    alignItems: 'center',
  },
  confirmIcon: {
    width: 47,
    height: 47,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  confirmTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  confirmCopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 260,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 22,
  },
  confirmButton: {
    flex: 1,
    height: 43,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  playerScreen: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 9,
    paddingBottom: 20,
  },
  playerHeader: {
    height: 53,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.4,
  },
  closeButtonSpacer: {
    width: 38,
  },
  audioPlayerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  playerArtOuter: {
    width: 184,
    height: 184,
    borderRadius: 92,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  playerArtInner: {
    width: 135,
    height: 135,
    borderRadius: 68,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTrackTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    marginTop: 5,
  },
  playerTrackDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 7,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 31,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  playbackTimes: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  playbackTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  playButton: {
    width: 61,
    height: 61,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  videoPlayerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: '66%',
    borderRadius: 18,
    overflow: 'hidden',
  },
  playerFooter: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 8,
  },
});
