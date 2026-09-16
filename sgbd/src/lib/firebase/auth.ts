import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as firebaseUpdateProfile,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import { getFirebaseApp } from "./client";

export type { User };

/** Obtém a instância de Auth ligada ao app Firebase, ou null se não configurado. */
export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

/**
 * Assina mudanças de estado da sessão. Se o Firebase não estiver configurado,
 * chama o callback imediatamente com `null` (estado anônimo).
 */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => cb(user ?? null));
}

function requireAuth(): Auth {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error(
      "Firebase não configurado. Preencha NEXT_PUBLIC_FIREBASE_* no .env.local e reinicie o servidor."
    );
  }
  return auth;
}

/** Login com popup do Google (Firebase Auth). */
export async function signInWithGoogle(): Promise<User> {
  const auth = requireAuth();
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

/** Login com e-mail e senha. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<User> {
  const auth = requireAuth();
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

/** Cadastro com e-mail e senha; grava o nome no perfil do Firebase. */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<User> {
  const auth = requireAuth();
  const cred = await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
  if (name.trim()) {
    await firebaseUpdateProfile(cred.user, { displayName: name.trim() });
  }
  return cred.user;
}

/** Atualiza foto/display name do perfil e retorna o usuário recarregado. */
export async function updateUserProfile(patch: {
  displayName?: string;
  photoURL?: string | null;
}): Promise<User> {
  const auth = requireAuth();
  const current = auth.currentUser;
  if (!current) throw new Error("Nenhum usuário autenticado.");
  await firebaseUpdateProfile(current, patch);
  await current.reload();
  return auth.currentUser ?? current;
}

/** Encerra a sessão atual. */
export async function signOut(): Promise<void> {
  const auth = requireAuth();
  await firebaseSignOut(auth);
}

const ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Nenhuma conta encontrada com este e-mail.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/too-many-requests":
    "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "auth/email-already-in-use": "Este e-mail já está cadastrado.",
  "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/operation-not-allowed":
    "Este método de login não está habilitado no Firebase Console.",
  "auth/popup-closed-by-user":
    "A janela de login foi fechada antes de concluir.",
  "auth/cancelled-popup-request": "Login cancelado.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/network-request-failed":
    "Falha de rede. Verifique sua conexão e tente novamente.",
};

/** Traduz códigos de erro do Firebase Auth para mensagens amigáveis em pt-BR. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code in ERROR_MESSAGES) return ERROR_MESSAGES[code];
  const message = (e as { message?: string })?.message;
  return message && message !== code
    ? message
    : "Não foi possível concluir a operação.";
}