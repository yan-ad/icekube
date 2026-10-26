import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

export const brandTheme = defineTheme({
  name: 'brand',
  extends: neutralTheme,

  localTokens: {
    '--color-log-background': '#000000',
    '--color-log-text': '#f5f5f5',
    '--color-log-match-background': '#facc15',
    '--color-log-match-text': '#000000',
  },

  typography: {
    body: {
      family: '-apple-system',
      fallbacks: 'Inter, BlinkMacSystemFont, sans-serif',
    },
    heading: {
      family: '-apple-system',
      fallbacks: 'Inter, BlinkMacSystemFont, sans-serif',
    },
    code: {
      family: 'ui-monospace',
      fallbacks: 'SFMono-Regular, Menlo, monospace',
    },
  },
});
