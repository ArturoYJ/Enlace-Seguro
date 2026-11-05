import type { ConfigContext, ExpoConfig } from 'expo/config';

const E2E_APP_ID = 'com.enlaceseguro.e2e';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.APP_VARIANT !== 'e2e') {
    return {
      ...config,
      name: config.name ?? 'EnlaceSeguro',
      slug: config.slug ?? 'enlaceseguro',
    };
  }

  const existingInfoPlist = config.ios?.infoPlist ?? {};
  const existingTransportSecurity =
    (existingInfoPlist.NSAppTransportSecurity as Record<string, unknown> | undefined) ?? {};

  return {
    ...config,
    name: `${config.name ?? 'EnlaceSeguro'} E2E`,
    slug: config.slug ?? 'enlaceseguro',
    ios: {
      ...config.ios,
      bundleIdentifier: E2E_APP_ID,
      infoPlist: {
        ...existingInfoPlist,
        NSAppTransportSecurity: {
          ...existingTransportSecurity,
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      ...config.android,
      package: E2E_APP_ID,
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  };
};
