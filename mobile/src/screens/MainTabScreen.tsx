import React, { useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { HomeScreen } from './HomeScreen';
import { ScanScreen } from './ScanScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { ProfileScreen } from './ProfileScreen';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

interface MainTabScreenProps {
  navigation: any;
}

type TabKey = 'home' | 'scan' | 'notifications' | 'profile';

export function MainTabScreen({ navigation }: MainTabScreenProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'home':
        return <HomeScreen navigation={navigation} />;
      case 'scan':
        return <ScanScreen />;
      case 'notifications':
        return <NotificationsScreen />;
      case 'profile':
        return <ProfileScreen />;
      default:
        return <HomeScreen navigation={navigation} />;
    }
  };

  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'home', label: 'Home', icon: '🏠' },
    { key: 'scan', label: 'Scan', icon: '📷' },
    { key: 'notifications', label: 'Alerts', icon: '🔔' },
    { key: 'profile', label: 'Profile', icon: '👤' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Active screen content */}
      <View style={styles.content}>{renderActiveScreen()}</View>

      {/* Custom Bottom Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  tabBar: {
    height: 64,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabButton: {
    flex: 1,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  tabButtonActive: {
    backgroundColor: '#F5FAF4',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },
});
