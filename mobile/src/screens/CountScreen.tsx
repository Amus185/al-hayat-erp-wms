import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { getWarehouseLocations, barcodeLookup, adjustStock, getStock } from '../api/client';
import { WarehouseLocation, InventoryStock } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { MobileShell } from '../components/MobileShell';
import { ScanInput } from '../components/ScanInput';
import { QuantityInput } from '../components/QuantityInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface CountScreenProps {
  navigation: any;
}

export function CountScreen({ navigation }: CountScreenProps) {
  const { activeWarehouse } = useAuth();

  const [loading, setLoading] = useState(false);
  const [scanValue, setScanValue] = useState('');
  
  // Location selection
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<WarehouseLocation | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Scanned item details
  const [scannedVariant, setScannedVariant] = useState<any>(null);
  const [recordedStock, setRecordedStock] = useState<number>(0);
  const [countedQty, setCountedQty] = useState<number>(0);
  
  // Recent counts in this session
  const [recentCounts, setRecentCounts] = useState<Array<{
    sku: string;
    location: string;
    counted: number;
    recorded: number;
    adjustment: string;
  }>>([]);

  useEffect(() => {
    if (activeWarehouse) {
      fetchLocations(activeWarehouse.id);
    }
  }, [activeWarehouse]);

  const fetchLocations = async (whId: string) => {
    setLoading(true);
    try {
      const locs = await getWarehouseLocations(whId);
      setLocations(locs);
      if (locs.length > 0) {
        setSelectedLocation(locs[0]);
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load locations: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeSubmit = async () => {
    if (!scanValue.trim()) return;
    if (!selectedLocation) {
      Alert.alert('Location Required', 'Please select a bin location first.');
      return;
    }

    setLoading(true);
    setScannedVariant(null);
    setRecordedStock(0);

    try {
      const variant = await barcodeLookup(scanValue.trim());
      if (!variant) {
        Alert.alert('Not Found', 'Scanned barcode was not found in catalog.');
        setScanValue('');
        return;
      }

      setScannedVariant(variant);

      // Query current stock levels to find recorded amount for this specific location
      const allStocks = await getStock();
      const match = allStocks.find(
        (s) =>
          s.variant_id === variant.id &&
          s.warehouse_location_id === selectedLocation.id
      );

      const qty = match ? match.quantity_on_hand : 0;
      setRecordedStock(qty);
      setCountedQty(qty); // Default counted value to match recorded
      setScanValue('');
    } catch (err: any) {
      Alert.alert('Lookup Error', err.message || 'Failed to resolve barcode.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitCount = async () => {
    if (!scannedVariant || !selectedLocation || !activeWarehouse) return;

    const discrepancy = countedQty - recordedStock;
    
    // Discrepancy === 0 means count is accurate, but WMS workers might still submit it
    // to record a stock count activity (updates last counted timestamp)
    // Here, we submit an adjustment if discrepancy is non-zero
    setLoading(true);
    try {
      if (discrepancy !== 0) {
        const direction = discrepancy > 0 ? ('increase' as const) : ('decrease' as const);
        const adjustmentQty = Math.abs(discrepancy);

        await adjustStock({
          variantId: scannedVariant.id,
          direction,
          quantity: adjustmentQty,
          warehouseId: activeWarehouse.id,
          warehouseLocationId: selectedLocation.id,
          notes: `Cycle stock count discrepancy adjustment. Recorded: ${recordedStock}, counted: ${countedQty}.`,
        });
      }

      // Add to recent counts list
      const locationLabel = `Aisle ${selectedLocation.aisle} R-${selectedLocation.rack} S-${selectedLocation.shelf} B-${selectedLocation.bin}`;
      const sign = discrepancy > 0 ? '+' : '';
      const adjText = discrepancy === 0 ? 'Verified' : `${sign}${discrepancy} units`;
      
      setRecentCounts((prev) => [
        {
          sku: scannedVariant.sku,
          location: locationLabel,
          counted: countedQty,
          recorded: recordedStock,
          adjustment: adjText,
        },
        ...prev,
      ]);

      Alert.alert('Success', 'Stock count line submitted successfully.');
      setScannedVariant(null);
      setRecordedStock(0);
      setCountedQty(0);
    } catch (err: any) {
      Alert.alert('Count Submission Error', err.message || 'Failed to submit adjustment.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeWarehouse) {
    return (
      <MobileShell title="Stock Count" onBack={() => navigation.goBack()}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorMsg}>No active warehouse selected. Please select a warehouse on the Home screen first.</Text>
        </View>
      </MobileShell>
    );
  }

  const locationLabel = selectedLocation
    ? `📍 Aisle ${selectedLocation.aisle} • Rack ${selectedLocation.rack} • Shelf ${selectedLocation.shelf} • Bin ${selectedLocation.bin}`
    : 'Select Bin Location ▾';

  const discrepancy = countedQty - recordedStock;
  const sign = discrepancy > 0 ? '+' : '';

  return (
    <MobileShell title="Stock Counting" onBack={() => navigation.goBack()} loading={loading}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Bin Selector */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Active Bin Location</Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setShowLocationModal(true)}
          >
            <Text style={styles.pickerText}>{locationLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* Scan input */}
        <ScanInput
          value={scanValue}
          onChangeText={setScanValue}
          onScanPress={() => {
            Alert.prompt(
              'Simulate Barcode Scan',
              'Enter item barcode to count:',
              [
                { text: 'Cancel' },
                {
                  text: 'Submit',
                  onPress: (val) => {
                    if (val) {
                      setScanValue(val);
                    }
                  },
                },
              ],
              'plain-text'
            );
          }}
          onSubmitEditing={handleBarcodeSubmit}
          placeholder="Scan product barcode in this bin..."
        />

        {/* Counting UI */}
        {scannedVariant ? (
          <View style={styles.countingCard}>
            <Text style={styles.countingTitle}>Item details</Text>
            <Text style={styles.productName}>{scannedVariant.product?.name || 'Product'}</Text>
            <Text style={styles.skuText}>SKU: {scannedVariant.sku}</Text>
            <Text style={styles.skuText}>Barcode: {scannedVariant.barcode}</Text>

            <View style={styles.divider} />

            <View style={styles.recordedBox}>
              <Text style={styles.recordedLabel}>Recorded Stock (System):</Text>
              <Text style={styles.recordedValue}>{recordedStock} units</Text>
            </View>

            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>Physical Count:</Text>
              <QuantityInput
                value={countedQty}
                onChange={setCountedQty}
                min={0}
              />
            </View>

            {/* Discrepancy indicator */}
            <View style={[styles.discrepancyBox, discrepancy === 0 ? styles.discrepancyOk : styles.discrepancyWarn]}>
              <Text style={styles.discrepancyTitle}>Adjustment Discrepancy</Text>
              <Text style={[styles.discrepancyValue, discrepancy === 0 ? styles.okVal : styles.warnVal]}>
                {discrepancy === 0 ? '✅ Accurate (No discrepancy)' : `⚠️ Adjust: ${sign}${discrepancy} units`}
              </Text>
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleSubmitCount}>
              <Text style={styles.submitButtonText}>SUBMIT COUNT LINE</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.scanNotice}>
            <Text style={styles.scanNoticeText}>Scan a barcode to start count entry</Text>
          </View>
        )}

        {/* Recent Counts */}
        <Text style={styles.sectionTitle}>Recent counts (This session)</Text>
        <View style={styles.recentList}>
          {recentCounts.map((rc, idx) => (
            <View key={idx} style={styles.recentRow}>
              <View style={styles.recentMeta}>
                <Text style={styles.recentSku}>SKU: {rc.sku}</Text>
                <Text style={styles.recentLoc}>{rc.location}</Text>
              </View>
              <View style={styles.recentValueBox}>
                <Text style={styles.recentCounted}>Counted: {rc.counted} (Rec: {rc.recorded})</Text>
                <Text style={[styles.recentAdj, rc.adjustment.includes('Verified') ? styles.recentOk : styles.recentWarn]}>
                  {rc.adjustment}
                </Text>
              </View>
            </View>
          ))}
          {recentCounts.length === 0 && (
            <Text style={styles.emptyText}>No counts registered yet.</Text>
          )}
        </View>
      </ScrollView>

      {/* Bin Picker Modal */}
      <Modal visible={showLocationModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Bin Location</Text>
              <TouchableOpacity onPress={() => setShowLocationModal(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={locations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.locationItem,
                    selectedLocation?.id === item.id && styles.locationItemActive,
                  ]}
                  onPress={() => {
                    setSelectedLocation(item);
                    setScannedVariant(null); // Clear active scan when changing locations
                    setShowLocationModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.locationItemText,
                      selectedLocation?.id === item.id && styles.locationItemTextActive,
                    ]}
                  >
                    📍 Aisle {item.aisle} • Rack {item.rack} • Shelf {item.shelf} • Bin {item.bin}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No storage locations found in this warehouse</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorMsg: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  pickerButton: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  pickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  countingCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  countingTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  productName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  skuText: {
    fontSize: 13,
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  recordedBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: 6,
  },
  recordedLabel: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  recordedValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  discrepancyBox: {
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
  },
  discrepancyOk: {
    backgroundColor: '#E9F6E8',
    borderColor: colors.primary,
  },
  discrepancyWarn: {
    backgroundColor: '#FFF9E6',
    borderColor: colors.accent,
  },
  discrepancyTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  discrepancyValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  okVal: {
    color: colors.primary,
  },
  warnVal: {
    color: '#B27B00',
  },
  submitButton: {
    backgroundColor: colors.primary,
    minHeight: spacing.touchTargetMin + 4,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  submitButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scanNotice: {
    height: 120,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanNoticeText: {
    color: colors.muted,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  recentList: {
    gap: spacing.sm,
  },
  recentRow: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recentMeta: {
    gap: 2,
    flex: 1,
  },
  recentSku: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  recentLoc: {
    fontSize: 12,
    color: colors.muted,
  },
  recentValueBox: {
    alignItems: 'flex-end',
    gap: 2,
  },
  recentCounted: {
    fontSize: 13,
    color: colors.text,
  },
  recentAdj: {
    fontSize: 12,
    fontWeight: '700',
  },
  recentOk: {
    color: colors.primary,
  },
  recentWarn: {
    color: colors.danger,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.muted,
    fontStyle: 'italic',
    paddingVertical: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  closeText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  locationItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  locationItemActive: {
    backgroundColor: '#E9F6E8',
  },
  locationItemText: {
    fontSize: 14,
    color: colors.text,
  },
  locationItemTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
