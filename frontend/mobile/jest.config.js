module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|decode-uri-component))',
    'node_modules/react-native-reanimated/plugin/',
    'node_modules/@react-native/babel-preset/',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/dist/'],
};
