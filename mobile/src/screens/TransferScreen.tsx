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
import { getWarehouses, barcodeLookup, createTransfer, api } from '../api/client';
import { Warehouse, Branch } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { MobileShell } from '../components/MobileShell';
import { ScanInput } from '../components/ScanInput';
import { QuantityInput } from '../components/QuantityInput';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface TransferScreenProps {
  navigation: any;
}

interface SelectedDest {
  type: 'WAREHOUSE' | 'BRANCH';
  id: string;
  name: string;
}

interface TransferLineItem {
  variantId: string;
  sku: string;
  name: string;
  quantityRequested: number;
}

export function TransferScreen({ navigation }: TransferScreenProps) {
  const { activeWarehouse } = useAuth();

  const [loading, setLoading] = useState(false);
  const [scanValue, setScanValue] = useState('');
  
  // Destination State
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedDest, setSelectedDest] = useState<SelectedDest | null>(null);
  const [showDestModal, setShowDestModal] = useState(false);

  // Scanned Transfer Lines
  const [lines, setLines] = useState<TransferLineItem[]>([]);

  useEffect(() => {
    fetchDestinations();
  }, []);

  const fetchDestinations = async () => {
    setLoading(true);
    try {
      const whs = await getWarehouses();
      // Filter out the active warehouse from potential destinations
      const filteredWhs = whs.filter((w) => w.id !== activeWarehouse?.id);
      setWarehouses(filteredWhs);

      // Fetch branches using the exported api helper
      const brs = await api.get<Branch[]>('/branches');
      setBranches(brs);

      // Select first destination as default if available
      if (filteredWhs.length > 0) {
        setSelectedDest({
          type: 'WAREHOUSE',
          id: filteredWhs[0].id,
          name: filteredWhs[0].name,
        });
      } else if (brs.length > 0) {
        setSelectedDest({
          type: 'BRANCH',
          id: brs[0].id,
          name: brs[0].name,
        });
      }
    } catch (err: any) {
      console.error('Failed to load transfer destinations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeSubmit = async () => {
    if (!scanValue.trim()) return;
    setLoading(true);

    try {
      const variant = await barcodeLookup(scanValue.trim());
      if (!variant) {
        Alert.alert('Not Found', 'Scanned barcode was not found in catalog.');
        setScanValue('');
        return;
      }

      // Add to lines or increment existing line
      setLines((prev) => {
        const existing = prev.find((l) => l.variantId === variant.id);
        if (existing) {
          return prev.map((l) =>
            l.variantId === variant.id
              ? { ...l, quantityRequested: l.quantityRequested + 1 }
              : l
          );
        }
        return [
          ...prev,
          {
            variantId: variant.id,
            sku: variant.sku,
            name: variant.product?.name || 'Unknown SKU',
            quantityRequested: 1,
          },
        ];
      });

      setScanValue('');
    } catch (err: any) {
      Alert.alert('Lookup Error', err.message || 'Failed to resolve barcode.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLineQty = (variantId: string, qty: number) => {
    if (qty <= 0) {
      // Remove line
      setLines((prev) => prev.filter((l) => l.variantId !== variantId));
    } else {
      setLines((prev) =>
        prev.map((l) =>
          l.variantId === variantId ? { ...l, quantityRequested: qty } : l
        )
      );
    }
  };

  const handleSubmitTransfer = async () => {
    if (!activeWarehouse) return;
    if (!selectedDest) {
      Alert.alert('Missing Destination', 'Please select a destination facility first.');
      return;
    }
    if (lines.length === 0) {
      Alert.alert('Empty Transfer', 'Please scan items to transfer.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        sourceOwnerType: 'WAREHOUSE' as const,
        sourceWarehouseId: activeWarehouse.id,
        destinationOwnerType: selectedDest.type,
        destinationWarehouseId: selectedDest.type === 'WAREHOUSE' ? selectedDest.id : undefined,
        destinationBranchId: selectedDest.type === 'BRANCH' ? selectedDest.id : undefined,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          quantityRequested: l.quantityRequested,
        })),
      };

      await createTransfer(payload);

      Alert.alert('Success', 'Transfer request created successfully.', [
        {
          text: 'OK',
          onPress: () => {
            setLines([]);
            navigation.goBack();
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Submission Failed', err.message || 'Failed to create transfer.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeWarehouse) {
    return (
      <MobileShell title="Transfer Stock" onBack={() => navigation.goBack()}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorMsg}>No active warehouse selected. Please select a warehouse on the Home screen first.</Text>
        </View>
      </MobileShell>
    );
  }

  // Combine warehouses and branches for the modal selection list
  const destinationList = [
    ...warehouses.map((w) => ({ type: 'WAREHOUSE' as const, id: w.id, name: `Warehouse: ${w.name}` })),
    ...branches.map((b) => ({ type: 'BRANCH' as const, id: b.id, name: `Branch: ${b.name}` })),
  ];

  return (
    <MobileShell title="Create Transfer" onBack={() => navigation.goBack()} loading={loading}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Source Warehouse Display (Read-Only) */}
        <View style={styles.facilityCard}>
          <Text style={styles.facilityLabel}>Source Facility</Text>
          <Text style={styles.facilityValue}>📍 {activeWarehouse.name} (Active Warehouse)</Text>
        </View>

        {/* Destination Facility Selector */}
        <View style={styles.facilityCard}>
          <Text style={styles.facilityLabel}>Destination Facility</Text>
          <TouchableOpacity
            style={styles.facilityPickerButton}
            onPress={() => setShowDestModal(true)}
          >
            <Text style={styles.facilityPickerText}>
              {selectedDest ? `📍 ${selectedDest.name}` : 'Select Destination Facility ▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Scan Barcode Field */}
        <ScanInput
          value={scanValue}
          onChangeText={setScanValue}
          onScanPress={() => {
            Alert.prompt(
              'Simulate Barcode Scan',
              'Enter item barcode to transfer:',
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
          placeholder="Scan items for transfer..."
        />

        {/* Transfer Lines */}
        <Text style={styles.sectionTitle}>Transfer Lines ({lines.length})</Text>
        <View style={styles.linesList}>
          {lines.map((item) => (
            <View key={item.variantId} style={styles.lineCard}>
              <View style={styles.lineHeader}>
                <Text style={styles.lineName} numberOfLines={1}>
                  {item.name}
                </Text>
                <TouchableOpacity
                  onPress={() => handleUpdateLineQty(item.variantId, 0)}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.lineSku}>SKU: {item.sku}</Text>
              
              <View style={styles.stepperContainer}>
                <Text style={styles.qtyLabel}>Quantity:</Text>
                <QuantityInput
                  value={item.quantityRequested}
                  onChange={(qty) => handleUpdateLineQty(item.variantId, qty)}
                  min={1}
                />
              </View>
            </View>
          ))}
          {lines.length === 0 && (
            <Text style={styles.emptyText}>No items added yet. Scan or type barcode above.</Text>
          )}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, lines.length === 0 && styles.submitButtonDisabled]}
          onPress={handleSubmitTransfer}
          disabled={lines.length === 0}
        >
          <Text style={styles.submitButtonText}>DISPATCH TRANSFER</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Destination Picker Modal */}
      <Modal visible={showDestModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Destination Site</Text>
              <TouchableOpacity onPress={() => setShowDestModal(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={destinationList}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.destinationItem,
                    selectedDest?.id === item.id && styles.destinationItemActive,
                  ]}
                  onPress={() => {
                    setSelectedDest({
                      type: item.type,
                      id: item.id,
                      name: item.name,
                    });
                    setShowDestModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.destinationItemText,
                      selectedDest?.id === item.id && styles.destinationItemTextActive,
                    ]}
                  >
                    📍 {item.name}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No other warehouses or branches found</Text>
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
  facilityCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  facilityLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  facilityValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  facilityPickerButton: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  facilityPickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
  },
  linesList: {
    gap: spacing.sm,
  },
  lineCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  removeButton: {
    padding: spacing.xs,
  },
  removeText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 12,
  },
  lineSku: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  qtyLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: colors.primary,
    minHeight: spacing.touchTargetMin + 4,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitButtonDisabled: {
    backgroundColor: colors.muted,
  },
  submitButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: spacing.lg,
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
  destinationItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  destinationItemActive: {
    backgroundColor: '#E9F6E8',
  },
  destinationItemText: {
    fontSize: 14,
    color: colors.text,
  },
  destinationItemTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
