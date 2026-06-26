import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { MobileShell } from '../components/MobileShell';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export function ProfileScreen() {
  const { user, activeWarehouse, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Al Hayat WMS?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  return (
    <MobileShell title="User Profile">
      <ScrollView contentContainerStyle={styles.container}>
        {/* User Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.fullName ? user.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'U'}
            </Text>
          </View>
          <Text style={styles.fullName}>{user?.fullName || 'WMS User'}</Text>
          <Text style={styles.email}>{user?.email || 'N/A'}</Text>
        </View>

        {/* Info list */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>Session Details</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>User ID</Text>
            <Text style={styles.infoValue}>{user?.id || 'N/A'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Current Facility</Text>
            <Text style={styles.infoValue}>
              {activeWarehouse ? `${activeWarehouse.name} (${activeWarehouse.city})` : 'None selected'}
            </Text>
          </View>
        </View>

        {/* Permissions */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>Roles & Permissions</Text>
          
          <View style={styles.permissionContainer}>
            {user?.permissions && user.permissions.length > 0 ? (
              user.permissions.map((p, idx) => (
                <View key={idx} style={styles.permissionBadge}>
                  <Text style={styles.permissionText}>{p}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.noPermissionText}>No specific permission codes assigned.</Text>
            )}
          </View>
        </View>

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutText}>SIGN OUT OF WORKSTATION</Text>
        </TouchableOpacity>
      </ScrollView>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  profileCard: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: {
    fontSize: 24,
    color: colors.accent,
    fontWeight: '800',
  },
  fullName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  email: {
    fontSize: 14,
    color: colors.muted,
  },
  infoSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  permissionContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  permissionBadge: {
    backgroundColor: colors.background,
    borderWidth: 0.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  permissionText: {
    fontSize: 11,
    fontFamily: 'System',
    color: colors.secondary,
    fontWeight: '700',
  },
  noPermissionText: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  logoutButton: {
    backgroundColor: colors.danger,
    minHeight: spacing.touchTargetMin + 4,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  logoutText: {
    color: colors.surface,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
