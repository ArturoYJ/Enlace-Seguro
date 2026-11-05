import { useRouter, useLocalSearchParams, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, typefaces } from '../theme/tokens';

type TabKey = 'home' | 'analyze' | 'history';
const tabs: { key: TabKey; label: string; icon: 'home' | 'scan' | 'history' }[] = [
  { key: 'home', label: 'Inicio', icon: 'home' },
  { key: 'analyze', label: 'Analizar', icon: 'scan' },
  { key: 'history', label: 'Historial', icon: 'history' },
];

function TabIcon({ name, color }: { name: (typeof tabs)[number]['icon']; color: string }) {
  if (name === 'history') return <Svg width={21} height={21} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.7" /><Path d="M12 7v5l3.2 2" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  if (name === 'scan') return <Svg width={21} height={21} viewBox="0 0 24 24" fill="none"><Path d="M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m12-4v3a1 1 0 0 1-1 1h-3" stroke={color} strokeWidth="1.7" strokeLinecap="round" /><Circle cx="12" cy="12" r="3.1" stroke={color} strokeWidth="1.7" /></Svg>;
  return <Svg width={21} height={21} viewBox="0 0 24 24" fill="none"><Path d="M12 2.8 20 6v5.8c0 5.3-3.3 8.1-8 9.9-4.7-1.8-8-4.6-8-9.9V6l8-3.2Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" /><Path d="m9 12 2 2 4-4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

export function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const homeSelected = pathname === '/analysis' && tab !== 'analyze';
  const analyzeSelected = (pathname === '/analysis' && tab === 'analyze') || pathname.startsWith('/analysis/');

  function navigate(key: TabKey) {
    if (key === 'history') router.replace('/history');
    else if (key === 'analyze') router.replace({ pathname: '/analysis', params: { tab: 'analyze' } });
    else router.replace('/analysis');
  }

  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const active = tab.key === 'home' ? homeSelected : tab.key === 'analyze' ? analyzeSelected : pathname === '/history';
        const iconColor = active ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => navigate(tab.key)}
            style={styles.tab}
          >
            <TabIcon name={tab.icon} color={iconColor} />
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 66, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 5 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48 },
  label: { color: colors.textMuted, fontFamily: typefaces.medium, fontSize: 10 },
  activeLabel: { color: colors.primaryText, fontFamily: typefaces.semibold },
});
