import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface ScanInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onScanPress: () => void;
  onSubmitEditing?: () => void;
  label?: string;
  autoFocus?: boolean;
}

export const ScanInput: React.FC<ScanInputProps> = ({
  value,
  onChangeText,
  placeholder = 'Scan or enter barcode...',
  onScanPress,
  onSubmitEditing,
  label,
  autoFocus = false,
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="done"
        />
        <TouchableOpacity
          onPress={onScanPress}
          style={styles.scanButton}
          activeOpacity={0.7}
          accessibilityLabel="Scan barcode with camera"
        >
          <Text style={styles.scanButtonText}>📷 SCAN</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  scanButton: {
    backgroundColor: colors.secondary,
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 12,
  },
});
