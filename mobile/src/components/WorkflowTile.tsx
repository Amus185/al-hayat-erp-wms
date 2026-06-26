import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type WorkflowTileProps = {
  title: string;
  subtitle: string;
  onPress: () => void;
};

export function WorkflowTile({ title, subtitle, onPress }: WorkflowTileProps) {
  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <View style={styles.marker} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: 132,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    justifyContent: 'space-between'
  },
  marker: {
    width: 36,
    height: 5,
    borderRadius: 8,
    backgroundColor: colors.accent
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800'
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  }
});

