import { colors } from '../tokens';

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const DARK_SURFACES = [colors.background, colors.surface, colors.surfaceRaised, colors.surfaceInput];

describe('mobile color contrast tokens', () => {
  it('keeps muted copy readable on all dark surfaces', () => {
    for (const surface of DARK_SURFACES) {
      expect(contrastRatio(colors.textMuted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps primary text actions readable on all dark surfaces', () => {
    for (const surface of DARK_SURFACES) {
      expect(contrastRatio(colors.primaryText, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the primary button label readable in normal and pressed states', () => {
    expect(contrastRatio(colors.white, colors.primaryAction)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.white, colors.primaryPressed)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps semantic verdict colors distinguishable from dark surfaces', () => {
    for (const verdictColor of [colors.danger, colors.warning, colors.success]) {
      for (const surface of DARK_SURFACES) {
        expect(contrastRatio(verdictColor, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
