import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface StatusPillProps {
  status: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status }) => {
  const normalized = status.toUpperCase().replace('_', ' ');

  // Determine styles based on status values
  let bgColor = '#F0F0F0';
  let textColor = '#666666';

  switch (status.toUpperCase()) {
    case 'DRAFT':
    case 'PENDING':
      bgColor = '#F5F5F5';
      textColor = '#7A7A7A';
      break;
    case 'SUBMITTED':
    case 'PENDING_APPROVAL':
      bgColor = '#FFF9E6'; // Light yellow
      textColor = '#B27B00'; // Darker amber
      break;
    case 'APPROVED':
      bgColor = '#EAF2FF'; // Light blue
      textColor = '#0052CC'; // Dark blue
      break;
    case 'DISPATCHED':
    case 'PARTIALLY_RECEIVED':
      bgColor = '#FFF2EB'; // Light orange
      textColor = '#B24700'; // Dark orange
      break;
    case 'RECEIVED':
    case 'FULLY_RECEIVED':
      bgColor = '#E9F6E8'; // Light green
      textColor = colors.primary; // Brand green
      break;
    case 'CANCELLED':
      bgColor = '#FEEBEB'; // Light red
      textColor = colors.danger; // Danger red
      break;
  }

  return (
    <View style={[styles.pill, { backgroundColor: bgColor }]}>
      <Text style={[styles.text, { color: textColor }]}>{normalized}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: 12,
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
