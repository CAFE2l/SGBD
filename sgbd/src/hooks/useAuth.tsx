"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isFirebaseConfigured } from "@/lib/config";
import {
  onAuthChange,
  signInWithGoogle as googleSignIn,
  signInWithEmail as emailSignIn,
  signUpWithEmail as emailSignUp,
  updateUserProfile as firebaseUpdateUserProfile,
  signOut as firebaseSignOut,
  type User,
} from "@/lib/firebase/auth";

interface AuthContextValue {
  /** Usuário autenticado via Firebase, ou null quando anônimo. */
  user: User | null;
  /** true enquanto resolvemos o estado da sessão no primeiro carregamento. */
  loading: boolean;
  /** true se as variáveis NEXT_PUBLIC_FIREBASE_* estão presentes. */
  configured: boolean;
  signInGoogle: () => Promise<User | null>;
  signInEmail: (email: string, password: string) => Promise<User | null>;
  signUpEmail: (
    name: string,
    email: string,
    password: string
  ) => Promise<User | null>;
  signOut: () => Promise<void>;
  /** Atualiza foto/display name no Firebase e reflete no contexto na hora. */
  updateProfile: (patch: {
    displayName?: string;
    photoURL?: string | null;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured] = useState(() => isFirebaseConfigured());

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInGoogle = useCallback(async () => {
    const u = await googleSignIn();
    setUser(u);
    return u;
  }, []);

  const signInEmail = useCallback(
    async (email: string, password: string) => {
      const u = await emailSignIn(email, password);
      setUser(u);
      return u;
    },
    []
  );

  const signUpEmail = useCallback(
    async (name: string, email: string, password: string) => {
      const u = await emailSignUp(name, email, password);
      setUser(u);
      return u;
    },
    []
  );

  const signOut = useCallback(async () => {
    await firebaseSignOut();
    setUser(null);
  }, []);

  const updateProfile = useCallback(
    async (patch: { displayName?: string; photoURL?: string | null }) => {
      const u = await firebaseUpdateUserProfile(patch);
      setUser(u);
    },
    []
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      configured,
      signInGoogle,
      signInEmail,
      signUpEmail,
      signOut,
      updateProfile,
    }),
    [user, loading, configured, signInGoogle, signInEmail, signUpEmail, signOut, updateProfile]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  }
  return ctx;
}