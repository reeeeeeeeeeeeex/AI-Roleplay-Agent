export const readingThemes = ['graphite', 'midnight', 'warm', 'paper'] as const;
export const readingFonts = ['sans', 'serif', 'mono'] as const;
export type ReadingAppearance = {
  theme: typeof readingThemes[number];
  font: typeof readingFonts[number];
  fontSize: number;
};
export const appearanceStorageKey = 'reading-appearance';
export const defaultAppearance: ReadingAppearance = { theme: 'graphite', font: 'sans', fontSize: 16 };

export function readAppearance(): ReadingAppearance {
  try {
    const value = JSON.parse(localStorage.getItem(appearanceStorageKey) ?? 'null');
    return {
      theme: readingThemes.includes(value?.theme) ? value.theme : defaultAppearance.theme,
      font: readingFonts.includes(value?.font) ? value.font : defaultAppearance.font,
      fontSize: Number.isInteger(value?.fontSize) && value.fontSize >= 12 && value.fontSize <= 28 ? value.fontSize : defaultAppearance.fontSize,
    };
  } catch { return { ...defaultAppearance }; }
}

export function applyAppearance(value: ReadingAppearance): void {
  const root = document.documentElement;
  root.dataset.readingTheme = value.theme;
  root.dataset.readingFont = value.font;
  root.style.setProperty('--reading-font-size', `${value.fontSize}px`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg-canvas').trim());
}

export function saveAppearance(value: ReadingAppearance): void {
  // Persist before applying; a failed write keeps the active appearance unchanged.
  localStorage.setItem(appearanceStorageKey, JSON.stringify(value));
  applyAppearance(value);
}
