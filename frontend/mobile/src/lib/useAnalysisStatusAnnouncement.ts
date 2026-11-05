import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

export type AnalysisStatusAnnouncement = {
  attemptId: string;
  status: string;
  verdict?: string;
  message: string;
};

type AnnouncedState = Pick<AnalysisStatusAnnouncement, 'attemptId' | 'status' | 'verdict'>;

export function useAnalysisStatusAnnouncement(current: AnalysisStatusAnnouncement | null): void {
  const lastState = useRef<AnnouncedState | null>(null);
  const attemptId = current?.attemptId;
  const status = current?.status;
  const verdict = current?.verdict;
  const message = current?.message;

  useEffect(() => {
    if (attemptId === undefined || status === undefined || message === undefined) {
      lastState.current = null;
      return;
    }

    const nextState: AnnouncedState = {
      attemptId,
      status,
      verdict,
    };
    const previousState = lastState.current;
    lastState.current = nextState;

    if (!previousState || previousState.attemptId !== nextState.attemptId) return;
    if (previousState.status === nextState.status && previousState.verdict === nextState.verdict) return;
    if (!message.trim()) return;

    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true, priority: 'low' });
  }, [attemptId, status, verdict, message]);
}
