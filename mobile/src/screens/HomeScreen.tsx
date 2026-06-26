import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getWarehouses } from '../api/client';
import { Warehouse } from '../types';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface HomeScreenProps {
  navigation: any;
}

export function HomeScreen({ navigation }: HomeScreenProps) {
  const { user, activeWarehouse, setActiveWarehouse } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchWarehouses() {
      setLoading(true);
      try {
        const data = await getWarehouses();
        setWarehouses(data);
        // Automatically select the first warehouse if none is selected
        if (!activeWarehouse && data.length > 0) {
          await setActiveWarehouse(data[0]);
        }
      } catch (error) {
        console.error('Failed to load warehouses:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchWarehouses();
  }, []);

  const handleSelectWarehouse = async (warehouse: Warehouse) => {
    await setActiveWarehouse(warehouse);
    setPickerVisible(false);
  };

  const workflowTiles = [
    {
      title: 'Scan & Lookup',
      subtitle: 'Lookup product specs, barcode information, and stock levels across sites.',
      onPress: () => navigation.navigate('ProductLookup'),
      accentColor: colors.accent,
    },
    {
      title: 'Receive Stock',
      subtitle: 'Scan incoming items against pending Purchase Orders and assign bin storage.',
      onPress: () => navigation.navigate('Receive'),
      accentColor: colors.primary,
    },
    {
      title: 'Transfer Stock',
      subtitle: 'Create transfers between warehouses and branches by scanning item barcodes.',
      onPress: () => navigation.navigate('Transfer'),
      accentColor: '#0052CC',
    },
    {
      title: 'Stock Count',
      subtitle: 'Conduct physical inventory counts by selecting a bin location and scanning variants.',
      onPress: () => navigation.navigate('Count'),
      accentColor: colors.danger,
    },
  ];

  return (
    <View style={styles.container}>
      {/* Header section with User Info */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Marhaban,</Text>
          <Text style={styles.userName}>{user?.fullName || 'WMS Associate'}</Text>
        </View>
        
        {/* Active Warehouse Selector Button */}
        <TouchableOpacity
          onPress={() => setPickerVisible(true)}
          style={styles.selectorButton}
          activeOpacity={0.8}
        >
          <Text style={styles.selectorLabel}>Warehouse</Text>
          {loading ? (
            <ActivityIndicator size="small" color={colors.secondary} />
          ) : (
            <Text style={styles.selectorValue} numberOfLines={1}>
              {activeWarehouse ? activeWarehouse.name : 'Select Warehouse ▾'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Daily Operations</Text>
        
        <View style={styles.grid}>
          {workflowTiles.map((tile, index) => (
            <TouchableOpacity
              key={index}
              onPress={tile.onPress}
              style={styles.tile}
              activeOpacity={0.9}
            >
              <View style={[styles.tileIndicator, { backgroundColor: tile.accentColor }]} />
              <View style={styles.tileContent}>
                <Text style={styles.tileTitle}>{tile.title}</Text>
                <Text style={styles.tileSubtitle}>{tile.subtitle}</Text>
              </View>
              <Text style={styles.arrow}>➔</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Warehouse Selector Modal */}
      <Modal visible={pickerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Active Warehouse</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={warehouses}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.warehouseItem,
                    activeWarehouse?.id === item.id && styles.warehouseItemActive,
                  ]}
                  onPress={() => handleSelectWarehouse(item)}
                >
                  <Text
                    style={[
                      styles.warehouseItemText,
                      activeWarehouse?.id === item.id && styles.warehouseItemTextActive,
                    ]}
                  >
                    {item.name} ({item.city})
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No active warehouses found</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  selectorButton: {
    backgroundColor: '#E9F6E8',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'flex-start',
    maxWidth: 160,
  },
  selectorLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.secondary,
    textTransform: 'uppercase',
  },
  selectorValue: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grid: {
    gap: spacing.md,
  },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 100,
    paddingRight: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  tileIndicator: {
    width: 6,
    alignSelf: 'stretch',
    borderTopLeftRadius: 7,
    borderBottomLeftRadius: 7,
  },
  tileContent: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tileTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  tileSubtitle: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  arrow: {
    fontSize: 18,
    color: colors.muted,
    fontWeight: 'bold',
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
  warehouseItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  warehouseItemActive: {
    backgroundColor: '#E9F6E8',
  },
  warehouseItemText: {
    fontSize: 16,
    color: colors.text,
  },
  warehouseItemTextActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.muted,
    paddingVertical: spacing.xl,
  },
});
