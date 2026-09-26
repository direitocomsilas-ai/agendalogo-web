import { supabase } from './supabase';

// Services ID da Apple para o login via navegador (criado no Apple Developer).
// No app nativo iOS não é necessário: usamos o Sign in with Apple do sistema.
const APPLE_WEB_CLIENT_ID = (import.meta.env.VITE_APPLE_SERVICES_ID as string | undefined) || '';

type NativeResult = { idToken?: string; firstName?: string; familyName?: string; error?: string };
type WebkitWindow = Window & {
  webkit?: { messageHandlers?: { appleSignIn?: { postMessage: (v: null) => void } } };
  AppleID?: {
    auth: {
      init: (cfg: Record<string, unknown>) => void;
      signIn: () => void;
    };
  };
  __appleNativeSignInResult?: (data: NativeResult) => void;
};

// App nativo iOS registra a ponte "appleSignIn" no WebView.
export function isAppleNativeAvailable(): boolean {
  const w = window as WebkitWindow;
  return !!w.webkit?.messageHandlers?.appleSignIn;
}

// Login web pela Apple só aparece quando o Services ID está configurado.
export function isAppleWebAvailable(): boolean {
  return !!APPLE_WEB_CLIENT_ID && !isAppleNativeAvailable();
}

export function isAppleAvailable(): boolean {
  return isAppleNativeAvailable() || isAppleWebAvailable();
}

// ---- Fluxo nativo (app iOS): aciona o Sign in with Apple do sistema ----
function nativeSignIn(): Promise<NativeResult> {
  return new Promise((resolve) => {
    const w = window as WebkitWindow;
    // Timeout de segurança: se o usuário não responder em 3 minutos, resolve vazio.
    const timer = setTimeout(() => resolve({ error: 'Tempo esgotado.' }), 3 * 60_000);
    w.__appleNativeSignInResult = (data: NativeResult) => {
      clearTimeout(timer);
      resolve(data ?? { error: 'Sem resposta.' });
    };
    w.webkit!.messageHandlers!.appleSignIn!.postMessage(null);
  });
}

// ---- Fluxo web (navegadores): Apple JS SDK em modo popup ----
function loadAppleSdk(): Promise<NonNullable<WebkitWindow['AppleID']>> {
  return new Promise((resolve, reject) => {
    const w = window as WebkitWindow;
    if (w.AppleID) return resolve(w.AppleID);
    const s = document.createElement('script');
    s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.min.js';
    s.onload = () => (w.AppleID ? resolve(w.AppleID) : reject(new Error('SDK da Apple não carregou.')));
    s.onerror = () => reject(new Error('Não foi possível carregar o login da Apple. Verifique sua conexão.'));
    document.head.appendChild(s);
  });
}

export async function appleSignIn(): Promise<void> {
  if (isAppleNativeAvailable()) {
    const res = await nativeSignIn();
    if (res.error || !res.idToken) throw new Error(res.error || 'Login com a Apple cancelado.');
    return exchange(res.idToken, res.firstName, res.familyName);
  }

  const AppleID = await loadAppleSdk();
  AppleID.auth.init({
    clientId: APPLE_WEB_CLIENT_ID,
    scope: 'name email',
    redirectURI: `${window.location.origin}/entrar`,
    usePopup: true,
  });

  const data = await new Promise<{ id_token?: string; user?: { name?: { firstName?: string; lastName?: string } } }>(
    (resolve, reject) => {
      const ok = (e: Event) => {
        cleanup();
        const detail = (e as CustomEvent).detail as { data?: { id_token?: string; user?: { name?: { firstName?: string; lastName?: string } } } } | undefined;
        if (detail?.data?.id_token) resolve(detail.data);
        else reject(new Error('Token da Apple não recebido.'));
      };
      const fail = () => {
        cleanup();
        reject(new Error('Login com a Apple cancelado.'));
      };
      const cleanup = () => {
        document.removeEventListener('AppleIDSignInOnSuccess', ok);
        document.removeEventListener('AppleIDSignInOnFailure', fail);
      };
      document.addEventListener('AppleIDSignInOnSuccess', ok);
      document.addEventListener('AppleIDSignInOnFailure', fail);
      AppleID.auth.signIn();
    },
  );

  if (!data.id_token) throw new Error('Token da Apple não recebido.');
  return exchange(data.id_token, data.user?.name?.firstName, data.user?.name?.lastName);
}

// Envia o identity token para a edge function e aplica a sessão retornada.
async function exchange(idToken: string, firstName?: string, lastName?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('apple-auth', {
    body: { idToken, firstName, lastName },
  });
  if (error) throw new Error('Falha de conexão com o servidor de login.');
  const session = data?.session;
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error(data?.error || 'Não foi possível entrar com a Apple. Tente novamente.');
  }
  const { error: setErr } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setErr) throw setErr;
}
