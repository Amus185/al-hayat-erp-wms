import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getNotifications, markNotificationRead } from '../api/client';
import { Notification } from '../types';
import { MobileShell } from '../components/MobileShell';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const data = await getNotifications();
      // Sort: unread first, then newest first
      const sorted = data.sort((a, b) => {
        if (a.is_read === b.is_read) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        return a.is_read ? 1 : -1;
      });
      setNotifications(sorted);
    } catch (err: any) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      // Update local state
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err: any) {
      Alert.alert('Error', 'Failed to mark notification as read: ' + err.message);
    }
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const timeStr = new Date(item.created_at).toLocaleDateString() + ' ' + new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return (
      <View style={[styles.card, !item.is_read && styles.unreadCard]}>
        <View style={styles.cardHeader}>
          <View style={styles.titleContainer}>
            {!item.is_read && <View style={styles.unreadDot} />}
            <Text style={[styles.cardTitle, !item.is_read && styles.unreadTitle]}>
              {item.title}
            </Text>
          </View>
          <Text style={styles.timeText}>{timeStr}</Text>
        </View>

        <Text style={styles.cardBody}>{item.body}</Text>

        {!item.is_read && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleMarkRead(item.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>Mark as read</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <MobileShell
      title="Notifications & Alerts"
      loading={loading}
      rightAction={{
        label: 'Refresh',
        onPress: fetchNotifications,
      }}
    >
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No alerts or notifications recorded</Text>
          </View>
        }
      />
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  unreadCard: {
    borderColor: '#C3E6C2',
    backgroundColor: '#FAFDF9',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  unreadTitle: {
    color: colors.secondary,
  },
  timeText: {
    fontSize: 11,
    color: colors.muted,
  },
  cardBody: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
    marginTop: 2,
  },
  actionButton: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginTop: spacing.xs,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  actionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
  },
});
