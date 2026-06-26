import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InventoryStock } from '../types';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface StockRowProps {
  stock: InventoryStock;
}

export const StockRow: React.FC<StockRowProps> = ({ stock }) => {
  const available = stock.quantity_on_hand - stock.quantity_reserved;
  
  // Format location string
  const hasLocation = stock.aisle || stock.rack || stock.shelf || stock.bin;
  const locationText = hasLocation
    ? `Loc: A-${stock.aisle || '0'} R-${stock.rack || '0'} S-${stock.shelf || '0'} B-${stock.bin || '0'}`
    : 'No assigned bin';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.productName} numberOfLines={1}>
          {stock.name || 'Unknown Product'}
        </Text>
        <View style={styles.ownerBadge}>
          <Text style={styles.ownerBadgeText}>
            {stock.owner_type === 'WAREHOUSE' ? 'WH' : 'BR'}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.skuText}>SKU: {stock.sku || 'N/A'}</Text>
        <Text style={styles.barcodeText}>Barcode: {stock.barcode || 'N/A'}</Text>
      </View>

      <View style={styles.locationContainer}>
        <Text style={styles.locationText}>{locationText}</Text>
        {stock.warehouse && <Text style={styles.siteText}>{stock.warehouse}</Text>}
        {stock.branch && <Text style={styles.siteText}>{stock.branch}</Text>}
      </View>

      <View style={styles.divider} />

      <View style={styles.stockValues}>
        <View style={styles.stockCol}>
          <Text style={styles.stockValLabel}>On Hand</Text>
          <Text style={styles.stockVal}>{stock.quantity_on_hand}</Text>
        </View>
        <View style={styles.stockCol}>
          <Text style={styles.stockValLabel}>Reserved</Text>
          <Text style={[styles.stockVal, stock.quantity_reserved > 0 && styles.reservedVal]}>
            {stock.quantity_reserved}
          </Text>
        </View>
        <View style={[styles.stockCol, styles.availCol]}>
          <Text style={styles.stockValLabel}>Available</Text>
          <Text style={[styles.stockVal, styles.availVal, available <= 0 && styles.lowStockText]}>
            {available}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  ownerBadge: {
    backgroundColor: '#E9F6E8',
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.primary,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  skuText: {
    fontSize: 12,
    color: colors.muted,
  },
  barcodeText: {
    fontSize: 12,
    color: colors.muted,
  },
  locationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 4,
    marginBottom: spacing.md,
  },
  locationText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
  },
  siteText: {
    fontSize: 12,
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  stockValues: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stockCol: {
    alignItems: 'center',
    flex: 1,
  },
  availCol: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  stockValLabel: {
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  stockVal: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  reservedVal: {
    color: colors.danger,
  },
  availVal: {
    color: colors.primary,
  },
  lowStockText: {
    color: colors.danger,
  },
});
