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
} from 'react-native';
import {
  getPurchaseOrders,
  getWarehouseLocations,
  barcodeLookup,
  createGoodsReceipt
} from '../api/client';
import { PurchaseOrder, PurchaseOrderLine, WarehouseLocation } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { MobileShell } from '../components/MobileShell';
import { ScanInput } from '../components/ScanInput';
import { QuantityInput } from '../components/QuantityInput';
import { StatusPill } from '../components/StatusPill';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface ReceiveScreenProps {
  navigation: any;
}

export function ReceiveScreen({ navigation }: ReceiveScreenProps) {
  const { activeWarehouse } = useAuth();
  
  // Selection States
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<WarehouseLocation | null>(null);
  
  // App States
  const [loading, setLoading] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [showLocationModal, setShowLocationModal] = useState(false);
  
  // Tally of quantities received during this session
  // Key: variantId, Value: quantity
  const [tally, setTally] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchPOs();
    if (activeWarehouse) {
      fetchLocations(activeWarehouse.id);
    }
  }, [activeWarehouse]);

  const fetchPOs = async () => {
    setLoading(true);
    try {
      const allPOs = await getPurchaseOrders();
      // Only show POs that aren't fully received or cancelled
      const activePOs = allPOs.filter(
        (po) => po.status !== 'FULLY_RECEIVED' && po.status !== 'CANCELLED'
      );
      setPurchaseOrders(activePOs);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load purchase orders: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async (whId: string) => {
    try {
      const locs = await getWarehouseLocations(whId);
      setLocations(locs);
      if (locs.length > 0) {
        setSelectedLocation(locs[0]);
      }
    } catch (err: any) {
      console.error('Failed to load locations', err);
    }
  };

  const handleSelectPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setTally({});
  };

  const handleBarcodeSubmit = async () => {
    if (!scanValue.trim()) return;
    if (!selectedPO) return;

    setLoading(true);
    try {
      const variant = await barcodeLookup(scanValue.trim());
      if (!variant) {
        Alert.alert('Not Found', 'Scanned barcode was not found in catalog.');
        setScanValue('');
        return;
      }

      // Check if this variant is part of the selected PO lines
      const line = selectedPO.lines?.find((l) => l.variant_id === variant.id);
      if (!line) {
        Alert.alert(
          'Mismatch',
          `Variant SKU "${variant.sku}" is not listed in Purchase Order ${selectedPO.po_number}.`
        );
        setScanValue('');
        return;
      }

      // Increment tally
      setTally((prev) => {
        const currentQty = prev[variant.id] || 0;
        const maxReceivable = line.quantity_ordered - line.quantity_received;
        
        if (currentQty >= maxReceivable) {
          Alert.alert(
            'Warning',
            `You are receiving more than ordered. Ordered: ${line.quantity_ordered}, Already Received: ${line.quantity_received}.`
          );
        }

        return {
          ...prev,
          [variant.id]: currentQty + 1,
        };
      });

      setScanValue('');
    } catch (err: any) {
      Alert.alert('Lookup Error', err.message || 'Failed to resolve barcode.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTallyQty = (variantId: string, qty: number) => {
    setTally((prev) => ({
      ...prev,
      [variantId]: qty,
    }));
  };

  const handleSubmitReceipt = async () => {
    if (!selectedPO || !activeWarehouse) return;
    
    const tallyKeys = Object.keys(tally);
    const receiptLines = tallyKeys
      .map((variantId) => ({
        variantId,
        quantityReceived: tally[variantId],
        warehouseLocationId: selectedLocation?.id,
      }))
      .filter((l) => l.quantityReceived > 0);

    if (receiptLines.length === 0) {
      Alert.alert('Empty Receipt', 'Please scan or enter quantities to receive first.');
      return;
    }

    setLoading(true);
    try {
      await createGoodsReceipt({
        purchaseOrderId: selectedPO.id,
        warehouseId: activeWarehouse.id,
        lines: receiptLines,
      });

      Alert.alert('Success', 'Goods Receipt submitted successfully.', [
        {
          text: 'OK',
          onPress: () => {
            setSelectedPO(null);
            setTally({});
            fetchPOs();
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Submission Error', err.message || 'Failed to submit goods receipt.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeWarehouse) {
    return (
      <MobileShell title="Receive Stock" onBack={() => navigation.goBack()}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorMsg}>No active warehouse selected. Please select a warehouse on the Home screen first.</Text>
        </View>
      </MobileShell>
    );
  }

  // If no Purchase Order is selected yet, show PO list selector
  if (!selectedPO) {
    return (
      <MobileShell title="Receive PO Selection" onBack={() => navigation.goBack()} loading={loading}>
        <FlatList
          data={purchaseOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.poCard} onPress={() => handleSelectPO(item)}>
              <View style={styles.poHeader}>
                <Text style={styles.poNumber}>{item.po_number}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={styles.poMeta}>Supplier: {item.supplier_name || 'N/A'}</Text>
              <Text style={styles.poMeta}>Expected Date: {item.expected_date ? new Date(item.expected_date).toLocaleDateString() : 'N/A'}</Text>
              <Text style={styles.poMeta}>Lines: {item.lines?.length || 0} unique items</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No pending Purchase Orders found</Text>
            </View>
          }
        />
      </MobileShell>
    );
  }

  return (
    <MobileShell
      title={`Receive: ${selectedPO.po_number}`}
      onBack={() => setSelectedPO(null)}
      loading={loading}
    >
      <ScrollView contentContainerStyle={styles.container}>
        {/* Destination Location Bin Selector */}
        <View style={styles.locationSelectorCard}>
          <Text style={styles.sectionLabel}>Destination Bin Location</Text>
          <TouchableOpacity
            style={styles.locationPickerButton}
            onPress={() => setShowLocationModal(true)}
          >
            <Text style={styles.locationPickerText}>
              {selectedLocation
                ? `📍 Aisle ${selectedLocation.aisle} • Rack ${selectedLocation.rack} • Shelf ${selectedLocation.shelf} • Bin ${selectedLocation.bin}`
                : 'Select Bin Location ▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Scan Barcode Field */}
        <ScanInput
          value={scanValue}
          onChangeText={setScanValue}
          onScanPress={() => {
            // Can open camera scanning tab or display simulation
            Alert.prompt(
              'Simulate Barcode Scan',
              'Enter item barcode to receive:',
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
          placeholder="Scan PO item barcode..."
        />

        {/* PO Line Items Tally */}
        <Text style={styles.sectionTitle}>Tally Items</Text>
        <View style={styles.linesContainer}>
          {selectedPO.lines?.map((line: PurchaseOrderLine) => {
            const scannedQty = tally[line.variant_id] || 0;
            const remaining = line.quantity_ordered - line.quantity_received;

            return (
              <View key={line.id} style={styles.lineRow}>
                <View style={styles.lineMeta}>
                  <Text style={styles.lineProductName}>{line.product_name || 'Product'}</Text>
                  <Text style={styles.lineSku}>SKU: {line.variant_sku || 'N/A'}</Text>
                  <Text style={styles.lineOrdered}>
                    Ordered: {line.quantity_ordered} | Received: {line.quantity_received} (Remaining: {remaining})
                  </Text>
                </View>
                
                {/* Quantity adjustments stepper */}
                <View style={styles.lineStepper}>
                  <QuantityInput
                    value={scannedQty}
                    onChange={(qty) => handleUpdateTallyQty(line.variant_id, qty)}
                    min={0}
                    max={remaining > 0 ? remaining : undefined}
                  />
                  <Text style={styles.scannedCountText}>Scanned: {scannedQty}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Submit Action */}
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmitReceipt}>
          <Text style={styles.submitButtonText}>SUBMIT GOODS RECEIPT</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bin Location Selector Modal */}
      <Modal visible={showLocationModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Storage Location</Text>
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
  listContent: {
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
  poCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  poHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  poNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  poMeta: {
    fontSize: 13,
    color: colors.muted,
  },
  emptyContainer: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
  },
  locationSelectorCard: {
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
  locationPickerButton: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  locationPickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  linesContainer: {
    gap: spacing.md,
  },
  lineRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lineMeta: {
    gap: 2,
  },
  lineProductName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  lineSku: {
    fontSize: 12,
    color: colors.muted,
  },
  lineOrdered: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
  },
  lineStepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  scannedCountText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    minHeight: spacing.touchTargetMin + 4,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
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
  emptyText: {
    textAlign: 'center',
    color: colors.muted,
    paddingVertical: spacing.xl,
  },
});
