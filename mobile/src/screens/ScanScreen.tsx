import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { barcodeLookup } from '../api/client';
import { MobileShell } from '../components/MobileShell';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    setScanned(true);
    setBarcode(data);
    await lookupBarcode(data);
  };

  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const data = await barcodeLookup(code.trim());
      if (data) {
        setResult(data);
      } else {
        setErrorMsg('Product variant not found.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Product lookup failed.');
    } finally {
      setLoading(false);
    }
  };

  const triggerReset = () => {
    setScanned(false);
    setBarcode('');
    setResult(null);
    setErrorMsg(null);
  };

  const renderScanner = () => {
    if (hasPermission === null) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (hasPermission === false) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>No access to camera. Use manual entry below.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={async () => {
              const { status } = await BarCodeScanner.requestPermissionsAsync();
              setHasPermission(status === 'granted');
            }}
          >
            <Text style={styles.retryText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scannerWrapper}>
        {scanned ? (
          <View style={styles.scannedScreen}>
            <Text style={styles.scannedLabel}>Barcoded Captured</Text>
            <Text style={styles.scannedValue}>{barcode}</Text>
            <TouchableOpacity style={styles.resetButton} onPress={triggerReset}>
              <Text style={styles.resetText}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <BarCodeScanner
            onBarCodeScanned={handleBarCodeScanned}
            style={StyleSheet.absoluteFillObject}
          />
        )}
      </View>
    );
  };

  return (
    <MobileShell title="Quick Lookup Scanner">
      <ScrollView contentContainerStyle={styles.container}>
        {/* Camera Feed Container */}
        {renderScanner()}

        {/* Manual Fallback Input */}
        <View style={styles.manualSection}>
          <Text style={styles.inputLabel}>Manual Barcode Entry</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={barcode}
              onChangeText={setBarcode}
              placeholder="e.g. 1234567890"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              onSubmitEditing={() => lookupBarcode(barcode)}
            />
            <TouchableOpacity
              style={styles.lookupButton}
              onPress={() => lookupBarcode(barcode)}
              disabled={loading || !barcode}
            >
              <Text style={styles.lookupButtonText}>LOOKUP</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Loading Indicator */}
        {loading && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Searching databases...</Text>
          </View>
        )}

        {/* Error Messages */}
        {errorMsg && (
          <View style={styles.errorCard}>
            <Text style={styles.errorCardText}>❌ {errorMsg}</Text>
          </View>
        )}

        {/* Results Card */}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Product Variant Found</Text>
            
            <View style={styles.metaBox}>
              <Text style={styles.productName}>{result.product?.name || 'Item Name'}</Text>
              <Text style={styles.skuText}>SKU: {result.sku || 'N/A'}</Text>
              <Text style={styles.skuText}>Barcode: {result.barcode || 'N/A'}</Text>
            </View>

            <View style={styles.divider} />

            {/* Spec Attributes */}
            <View style={styles.specRow}>
              {result.color && <Text style={styles.specTag}>🎨 Color: {result.color}</Text>}
              {result.dimensions && <Text style={styles.specTag}>📐 Size: {result.dimensions}</Text>}
              {result.material && <Text style={styles.specTag}>🪵 Material: {result.material}</Text>}
            </View>

            {/* Stock Levels Title */}
            <Text style={styles.stockTitle}>Inventory Levels</Text>
            
            {result.stocks && result.stocks.length > 0 ? (
              result.stocks.map((stock: any) => (
                <View key={stock.id} style={styles.stockLine}>
                  <Text style={styles.stockLoc}>
                    📍 {stock.warehouse?.name || stock.branch?.name || 'Bin Location'}
                    {stock.warehouse_location && ` (${stock.warehouse_location.aisle}-${stock.warehouse_location.rack}-${stock.warehouse_location.shelf}-${stock.warehouse_location.bin})`}
                  </Text>
                  <Text style={styles.stockQty}>
                    {stock.quantity_on_hand - stock.quantity_reserved} avail / {stock.quantity_on_hand} total
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.noStockText}>No stock recorded in WMS warehouses.</Text>
            )}
          </View>
        )}
      </ScrollView>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  permissionContainer: {
    height: 220,
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  permissionText: {
    color: '#CCCCCC',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 6,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  retryText: {
    color: colors.surface,
    fontWeight: '700',
  },
  scannerWrapper: {
    height: 240,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  scannedScreen: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  scannedLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scannedValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginVertical: spacing.sm,
  },
  resetButton: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  resetText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  manualSection: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  lookupButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: spacing.touchTargetMin,
  },
  lookupButtonText: {
    color: colors.surface,
    fontWeight: '800',
    fontSize: 12,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.muted,
  },
  errorCard: {
    backgroundColor: '#FEEBEB',
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorCardText: {
    color: colors.danger,
    fontWeight: '600',
  },
  resultCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  metaBox: {
    gap: 4,
  },
  productName: {
    fontSize: 18,
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
    marginVertical: spacing.md,
  },
  specRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  specTag: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    color: colors.text,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  stockTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  stockLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  stockLoc: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  stockQty: {
    fontSize: 13,
    color: colors.secondary,
    fontWeight: '700',
  },
  noStockText: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
