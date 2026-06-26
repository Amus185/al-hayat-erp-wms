import React from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useAuth } from '../contexts/AuthContext';

interface MobileShellProps {
  children: React.ReactNode;
  title?: string;
  onBack?: () => void;
  loading?: boolean;
  rightAction?: {
    label: string;
    onPress: () => void;
  };
}

export const MobileShell: React.FC<MobileShellProps> = ({
  children,
  title,
  onBack,
  loading = false,
  rightAction,
}) => {
  const { activeWarehouse } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
          )}
          {title && (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
          )}
        </View>

        {rightAction && (
          <TouchableOpacity onPress={rightAction.onPress} style={styles.rightAction}>
            <Text style={styles.rightActionText}>{rightAction.label}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Active Warehouse Indicator Banner */}
      {activeWarehouse && (
        <View style={styles.warehouseBanner}>
          <Text style={styles.warehouseBannerText}>
            Active Warehouse: <Text style={styles.warehouseName}>{activeWarehouse.name}</Text>
          </Text>
        </View>
      )}

      {/* Main Content */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loaderText}>Loading data...</Text>
          </View>
        ) : (
          children
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    minWidth: spacing.touchTargetMin,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  rightAction: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  rightActionText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  warehouseBanner: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  warehouseBannerText: {
    color: colors.surface,
    fontSize: 12,
  },
  warehouseName: {
    fontWeight: '700',
    color: colors.accent,
  },
  container: {
    flex: 1,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loaderText: {
    marginTop: spacing.md,
    color: colors.muted,
    fontSize: 14,
  },
});
