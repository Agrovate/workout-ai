import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#0f0f13',
  surface: '#1c1c28',
  surface2: '#24243a',
  accent: '#a855f7',
  accentDim: 'rgba(168,85,247,0.15)',
  text: '#e2e2f0',
  textSec: '#8888aa',
  border: '#2a2a3d',
  success: '#22c55e',
  danger: '#ef4444',
  dangerDim: 'rgba(239,68,68,0.15)',
};

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 24,
    marginBottom: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerBtn: {
    backgroundColor: colors.dangerDim,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  dangerBtnText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSec,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  error: {
    color: colors.danger,
    backgroundColor: colors.dangerDim,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSec,
    textAlign: 'center',
  },
});

export const chartConfig = {
  backgroundColor: colors.surface,
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(168,85,247,${opacity})`,
  labelColor: (opacity = 1) => `rgba(136,136,170,${opacity})`,
  style: { borderRadius: 12 },
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: colors.accent,
  },
  propsForBackgroundLines: {
    stroke: colors.border,
    strokeDasharray: '4 4',
  },
};
