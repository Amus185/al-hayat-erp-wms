import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

export const QuantityInput: React.FC<QuantityInputProps> = ({
  value,
  onChange,
  min = 1,
  max,
  label,
}) => {
  const handleDecrease = () => {
    if (value > min) {
      onChange(value - 1);
    }
  };

  const handleIncrease = () => {
    if (max === undefined || value < max) {
      onChange(value + 1);
    }
  };

  const handleTextChange = (text: string) => {
    const parsed = parseInt(text, 10);
    if (isNaN(parsed)) {
      onChange(min);
    } else {
      let finalVal = parsed;
      if (finalVal < min) finalVal = min;
      if (max !== undefined && finalVal > max) finalVal = max;
      onChange(finalVal);
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.stepperContainer}>
        {/* Decrease button */}
        <TouchableOpacity
          style={[styles.button, value <= min && styles.buttonDisabled]}
          onPress={handleDecrease}
          disabled={value <= min}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, value <= min && styles.disabledText]}>−</Text>
        </TouchableOpacity>

        {/* Input box */}
        <TextInput
          style={styles.input}
          value={String(value)}
          onChangeText={handleTextChange}
          keyboardType="number-pad"
          selectTextOnFocus
          textAlign="center"
        />

        {/* Increase button */}
        <TouchableOpacity
          style={[styles.button, max !== undefined && value >= max && styles.buttonDisabled]}
          onPress={handleIncrease}
          disabled={max !== undefined && value >= max}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, max !== undefined && value >= max && styles.disabledText]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    width: 160,
    overflow: 'hidden',
  },
  button: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  buttonDisabled: {
    backgroundColor: '#F0F0F0',
  },
  buttonText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.secondary,
  },
  disabledText: {
    color: '#CCCCCC',
  },
  input: {
    flex: 1,
    height: spacing.touchTargetMin,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.xs,
  },
});
