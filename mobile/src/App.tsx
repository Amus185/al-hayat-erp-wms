import React from 'react';
import { ActivityIndicator, StyleSheet, View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './screens/LoginScreen';
import { MainTabScreen } from './screens/MainTabScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { TransferScreen } from './screens/TransferScreen';
import { CountScreen } from './screens/CountScreen';
import { ProductLookupScreen } from './screens/ProductLookupScreen';
import { colors } from './theme/colors';

const Stack = createNativeStackNavigator();

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loaderText}>Al Hayat ERP starting...</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          // Authenticated Main Stack
          <>
            <Stack.Screen name="MainTab" component={MainTabScreen} />
            <Stack.Screen name="Receive" component={ReceiveScreen} />
            <Stack.Screen name="Transfer" component={TransferScreen} />
            <Stack.Screen name="Count" component={CountScreen} />
            <Stack.Screen name="ProductLookup" component={ProductLookupScreen} />
          </>
        ) : (
          // Unauthenticated Auth Stack
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <AppContent />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 16,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
});
