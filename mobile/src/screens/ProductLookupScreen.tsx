import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { getProducts, barcodeLookup, getStock } from '../api/client';
import { Product, ProductVariant, InventoryStock } from '../types';
import { MobileShell } from '../components/MobileShell';
import { ScanInput } from '../components/ScanInput';
import { StockRow } from '../components/StockRow';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface ProductLookupScreenProps {
  navigation: any;
}

export function ProductLookupScreen({ navigation }: ProductLookupScreenProps) {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scanValue, setScanValue] = useState('');
  
  // Results
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [variantStocks, setVariantStocks] = useState<InventoryStock[]>([]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setVariantStocks([]);

    try {
      const data = await getProducts(searchQuery.trim());
      setProducts(data);
    } catch (err: any) {
      Alert.alert('Error', 'Product search failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeLookup = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setProducts([]);
    setSelectedProduct(null);
    setSelectedVariant(null);
    setVariantStocks([]);

    try {
      const variant = await barcodeLookup(code.trim());
      if (!variant) {
        Alert.alert('Not Found', 'No variant matches the barcode.');
        setScanValue('');
        return;
      }

      // If variant found, fetch its stock levels across warehouses/branches
      const allStocks = await getStock();
      const stocksForVariant = allStocks.filter((s) => s.variant_id === variant.id);

      setSelectedVariant(variant);
      setVariantStocks(stocksForVariant);

      // If it has a related product object, fetch details
      if (variant.product) {
        setSelectedProduct(variant.product);
      }
      setScanValue('');
    } catch (err: any) {
      Alert.alert('Lookup Failed', err.message || 'Failed to search barcode.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProduct = async (product: Product) => {
    setSelectedProduct(product);
    setSelectedVariant(null);
    setVariantStocks([]);
  };

  const handleSelectVariant = async (variant: ProductVariant) => {
    setLoading(true);
    try {
      setSelectedVariant(variant);
      const allStocks = await getStock();
      const filtered = allStocks.filter((s) => s.variant_id === variant.id);
      setVariantStocks(filtered);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to fetch variant stock: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderProductItem = ({ item }: { item: Product }) => (
    <TouchableOpacity style={styles.productCard} onPress={() => handleSelectProduct(item)}>
      <Text style={styles.productCardName}>{item.name}</Text>
      <Text style={styles.productCardSku}>SKU: {item.sku}</Text>
      <Text style={styles.productCardCategory}>
        Category: {item.category || 'N/A'} • Brand: {item.brand || 'N/A'}
      </Text>
      <Text style={styles.productCardVariants}>
        Variants: {item.variants?.length || 0} items
      </Text>
    </TouchableOpacity>
  );

  return (
    <MobileShell title="Product & Stock Lookup" onBack={() => navigation.goBack()} loading={loading}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Search by Name/SKU */}
        <View style={styles.searchCard}>
          <Text style={styles.searchTitle}>Search Catalog</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by product name, SKU..."
              placeholderTextColor={colors.muted}
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
              <Text style={styles.searchButtonText}>SEARCH</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Scan Barcode Field */}
        <ScanInput
          value={scanValue}
          onChangeText={setScanValue}
          onScanPress={() => {
            Alert.prompt(
              'Simulate Barcode Scan',
              'Enter item barcode to lookup:',
              [
                { text: 'Cancel' },
                {
                  text: 'Submit',
                  onPress: (val) => {
                    if (val) {
                      handleBarcodeLookup(val);
                    }
                  },
                },
              ],
              'plain-text'
            );
          }}
          onSubmitEditing={() => handleBarcodeLookup(scanValue)}
          placeholder="Scan variant barcode directly..."
        />

        {/* Selected Product Drilldown */}
        {selectedProduct && (
          <View style={styles.detailCard}>
            <TouchableOpacity
              style={styles.backToResultsButton}
              onPress={() => {
                setSelectedProduct(null);
                setSelectedVariant(null);
                setVariantStocks([]);
              }}
            >
              <Text style={styles.backToResultsText}>← Clear Product Selection</Text>
            </TouchableOpacity>
            
            <Text style={styles.detailTitle}>{selectedProduct.name}</Text>
            <Text style={styles.detailSku}>Base SKU: {selectedProduct.sku}</Text>
            <Text style={styles.detailDesc}>{selectedProduct.description || 'No description available.'}</Text>
            
            <View style={styles.divider} />
            
            <Text style={styles.variantsHeader}>Select Variant to view stock</Text>
            <View style={styles.variantsRow}>
              {selectedProduct.variants?.map((v) => (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.variantBadge,
                    selectedVariant?.id === v.id && styles.variantBadgeActive,
                  ]}
                  onPress={() => handleSelectVariant(v)}
                >
                  <Text
                    style={[
                      styles.variantBadgeText,
                      selectedVariant?.id === v.id && styles.variantBadgeTextActive,
                    ]}
                  >
                    {v.color || ''} {v.dimensions || ''} ({v.sku})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Selected Variant Stock Levels */}
        {selectedVariant && (
          <View style={styles.stockSection}>
            <Text style={styles.stockSectionTitle}>
              Stock Levels for variant: {selectedVariant.sku}
            </Text>
            
            {variantStocks.length > 0 ? (
              variantStocks.map((stock) => (
                <StockRow key={stock.id} stock={stock} />
              ))
            ) : (
              <Text style={styles.noStockText}>
                No stock records found across warehouses/branches for this variant.
              </Text>
            )}
          </View>
        )}

        {/* Search Results List */}
        {!selectedProduct && products.length > 0 && (
          <View style={styles.resultsWrapper}>
            <Text style={styles.sectionHeader}>Search Results ({products.length})</Text>
            <FlatList
              data={products}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              renderItem={renderProductItem}
            />
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
  searchCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  searchButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: spacing.touchTargetMin,
  },
  searchButtonText: {
    color: colors.surface,
    fontWeight: '800',
    fontSize: 12,
  },
  productCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  productCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  productCardSku: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  productCardCategory: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  productCardVariants: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
    marginTop: 6,
  },
  detailCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backToResultsButton: {
    marginBottom: spacing.md,
  },
  backToResultsText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  detailSku: {
    fontSize: 14,
    color: colors.muted,
    marginTop: 2,
  },
  detailDesc: {
    fontSize: 13,
    color: colors.text,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  variantsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  variantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  variantBadge: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  variantBadgeActive: {
    backgroundColor: '#E9F6E8',
    borderColor: colors.primary,
  },
  variantBadgeText: {
    fontSize: 12,
    color: colors.text,
  },
  variantBadgeTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  stockSection: {
    gap: spacing.sm,
  },
  stockSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  noStockText: {
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  resultsWrapper: {
    marginTop: spacing.xs,
  },
});
