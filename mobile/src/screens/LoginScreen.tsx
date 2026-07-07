import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    
    setErrorMsg(null);
    setLoading(true);

    try {
      await login(email.trim(), password);
    } catch (error: any) {
      setErrorMsg(error.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        {/* Brand Logo & Name */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>AH</Text>
          </View>
          <Text style={styles.brandName}>Al Hayat ERP</Text>
          <Text style={styles.subtitle}>Mobile Inventory Operations</Text>
        </View>

        {/* Input fields */}
        <View style={styles.form}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setErrorMsg(null);
            }}
            placeholder="worker@alhayat.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setErrorMsg(null);
            }}
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>SIGN IN</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      
      <Text style={styles.footerText}>Authorized Access Only</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    color: colors.accent,
    fontSize: 26,
    fontWeight: '900',
  },
  brandName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.xs,
  },
  input: {
    minHeight: spacing.touchTargetMin,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  errorBox: {
    backgroundColor: '#FEEBEB',
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    marginTop: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    minHeight: spacing.touchTargetMin + 4,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: {
    backgroundColor: colors.muted,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footerText: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xxl,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
