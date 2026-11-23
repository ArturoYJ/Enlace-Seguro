import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

type LiveItem = { processingStatus: string; analysis?: { verdict?: string } };

export function isAnalysisActive(item: LiveItem): boolean {
  return !item.analysis?.verdict && (item.processingStatus === 'received' || item.processingStatus === 'processing');
}

/**
 * Mantiene al día una lista de análisis:
 * - la vuelve a pedir cuando la pantalla recupera el foco (al regresar de otra pantalla),
 * - y cuando la app vuelve del segundo plano,
 * - y la consulta cada pocos segundos mientras haya alguno en proceso.
 * Así un análisis que terminó o falló mientras no mirabas deja de verse "analizando".
 */
export function useLiveAnalysisRefresh(items: LiveItem[], refresh: () => void, intervalMs = 4000): void {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const firstFocus = useRef(true);

  useFocusEffect(useCallback(() => {
    // La primera vez la pantalla ya carga sus datos al montarse.
    if (firstFocus.current) { firstFocus.current = false; return; }
    refreshRef.current();
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshRef.current();
    });
    return () => subscription.remove();
  }, []);

  const hasActive = items.some(isAnalysisActive);
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => refreshRef.current(), intervalMs);
    return () => clearInterval(timer);
  }, [hasActive, intervalMs]);
}
