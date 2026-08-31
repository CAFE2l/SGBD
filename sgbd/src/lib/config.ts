export const config = {
  neon: {
    databaseUrl: process.env.DATABASE_URL ?? "",
  },
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  },
  queryTimeoutMs: Number(process.env.QUERY_TIMEOUT_MS ?? 10_000),
  schemaTtlHours: Number(process.env.SCHEMA_TTL_HOURS ?? 24),
};

export function isNeonConfigured(): boolean {
  return config.neon.databaseUrl.length > 0;
}

export function isFirebaseConfigured(): boolean {
  return (
    config.firebase.apiKey.length > 0 &&
    config.firebase.projectId.length > 0
  );
}
