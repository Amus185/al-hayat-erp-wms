import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'light';
};

export function PrimaryButton({ label, onPress, tone = 'primary' }: PrimaryButtonProps) {
  return (
    <Pressable onPress={onPress} style={[styles.button, tone === 'light' && styles.light]}>
      <Text style={[styles.label, tone === 'light' && styles.lightLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  light: {
    backgroundColor: '#E9F6E8',
    borderWidth: 1,
    borderColor: colors.border
  },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  lightLabel: {
    color: colors.secondary
  }
});

