import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { syncMpToServer, armServer } from '../lib/mpSync';
import { applyPwaIcon } from '../lib/pwaIcon';

// Rearme do servidor após publicações: o estado em disco não sobrevive ao deploy,
// então QUALQUER usuário logado (profissional ou master) detecta um servidor
// desarmado e o rearma — a fila do WhatsApp não pode depender do master estar online.
let mpArmInterval: ReturnType<typeof setInterval> | null = null;
function ensureServerArmLoop() {
  if (mpArmInterval) return;
  // Heartbeat: marca o usuário como ativo agora (painel master usa para "ativo agora")
  supabase.rpc('user_heartbeat').then(() => {}, () => {});
  mpArmInterval = setInterval(() => {
    supabase.rpc('user_heartbeat').then(() => {}, () => {});
    fetch('/api/mp/armed')
      .then((r) => (r.ok ? r.json() : null))
      .then((a: { rpc_armed?: boolean } | null) => {
        if (a && a.rpc_armed === false) armServer();
      })
      .catch(() => {});
  }, 60_000);
}

export type Profile = {
  id: string;
  name: string;
  whatsapp: string | null;
  is_master: boolean;
  referral_code: string;
};

export type Company = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  whatsapp: string | null;
  instagram: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
  logo_url: string | null;
  photo_url: string | null;
  cover_type: string;
  cover_color: string;
  cover_url: string | null;
  public_enabled: boolean;
};

export type Subscription = {
  id: string;
  company_id: string;
  plan_id: string | null;
  status: string;
  starts_at: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  amount: number;
};

export type Toast = { id: number; kind: 'success' | 'error' | 'info'; msg: string };

type Ctx = {
  loading: boolean;
  userDataLoading: boolean;
  session: Session | null;
  profile: Profile | null;
  company: Company | null;
  subscription: Subscription | null;
  planFeatures: Record<string, boolean>;
  accessBlocked: boolean;
  trialDaysLeft: number | null;
  brandLogo: string | null;
  connError: boolean;
  refreshCompany: () => Promise<void>;
  signOut: () => Promise<void>;
  toasts: Toast[];
  toast: (kind: Toast['kind'], msg: string) => void;
};

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userDataLoading, setUserDataLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [planFeatures, setPlanFeatures] = useState<Record<string, boolean>>({});
  const [toleranceDays, setToleranceDays] = useState(3);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [connError, setConnError] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast['kind'], msg: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Repete uma consulta de rede: ao voltar de outro app o celular pode
  // demorar alguns segundos para reconectar — sem isso o app "deslogava".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withRetry = useCallback(async (fn: () => PromiseLike<{ data: any; error: any }>, tries = 4): Promise<{ data: any; error: any }> => {
    let last: { data: any; error: any } = { data: null, error: null };
    for (let i = 0; i < tries; i++) {
      const r = await fn();
      if (!r.error) return r;
      last = r;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
    return last;
  }, []);

  const loadUserData = useCallback(async (userId: string) => {
    setUserDataLoading(true);
    try {
      await supabase.auth.getSession();
    let { data: prof, error: profErr } = await withRetry(() => supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
    if (!prof && !profErr) {
      await new Promise((r) => setTimeout(r, 200));
      ({ data: prof, error: profErr } = await withRetry(() => supabase.from('profiles').select('*').eq('id', userId).maybeSingle()));
    }
    if (profErr) {
      // Rede indisponível (ex.: voltando de outro app): mantém os dados já
      // carregados e marca erro de conexão em vez de "deslogar".
      setConnError(true);
      return;
    }
    setConnError(false);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__profDebug = { prof, profErr: profErr?.message };
    }
    setProfile(prof ?? null);
    // Rearma o servidor ao entrar: qualquer usuário logado arma; master sincroniza MP
    if (prof?.is_master) {
      syncMpToServer().catch(() => {});
    } else {
      armServer().catch(() => {});
    }
    ensureServerArmLoop();
    // empresa própria
    const { data: owned } = await withRetry(() => supabase
      .from('companies')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle());
    let comp = owned ?? null;
    if (!comp) {
      const { data: member, error: memberErr } = await withRetry(() => supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle());
      if (memberErr) {
        setConnError(true);
        return;
      }
      if (member) {
        const { data: c } = await withRetry(() => supabase
          .from('companies')
          .select('*')
          .eq('id', member.company_id)
          .maybeSingle());
        comp = c ?? null;
      }
    }
    setCompany(comp);
    if (comp) {
      applyPwaIcon(comp.logo_url);
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', comp.id)
        .maybeSingle();
      setSubscription(sub ?? null);
      // Recursos do plano atual (whatsapp, call_blocker etc.)
      if (sub?.plan_id) {
        supabase.from('plans').select('features').eq('id', sub.plan_id).maybeSingle()
          .then(({ data }) => setPlanFeatures(((data as { features?: Record<string, boolean> } | null)?.features) ?? {}));
      } else {
        setPlanFeatures({});
      }
      supabase.rpc('run_subscription_maintenance').then(() => {
        supabase
          .from('subscriptions')
          .select('*')
          .eq('company_id', comp!.id)
          .maybeSingle()
          .then(({ data }) => {
            setSubscription(data ?? null);
            if (data?.plan_id) {
              supabase.from('plans').select('features').eq('id', data.plan_id).maybeSingle()
                .then(({ data: pl }) => setPlanFeatures(((pl as { features?: Record<string, boolean> } | null)?.features) ?? {}));
            } else setPlanFeatures({});
          });
      });
      supabase.rpc('get_tolerance_days').then(({ data }) => {
        if (typeof data === 'number') setToleranceDays(data);
      });
    } else {
      setSubscription(null);
      setPlanFeatures({});
    }
    } finally {
      setUserDataLoading(false);
    }
  }, []);

  const refreshCompany = useCallback(async () => {
    if (session?.user) await loadUserData(session.user.id);
  }, [session, loadUserData]);

  useEffect(() => {
    supabase.from('app_settings').select('logo_url').eq('id', 1).single()
      .then(({ data }) => setBrandLogo((data as { logo_url: string | null } | null)?.logo_url ?? null));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadUserData(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (s) loadUserData(s.user.id);
      else {
        setProfile(null);
        setCompany(null);
        setSubscription(null);
        setPlanFeatures({});
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUserData]);

  // Ao voltar para o app depois de estar em segundo plano, tenta recarregar
  // os dados se a última tentativa falhou por conexão.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && session?.user && connError) {
        loadUserData(session.user.id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [session, connError, loadUserData]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const trialDaysLeft = useMemo(() => {
    if (!subscription || subscription.status !== 'trial' || !subscription.trial_ends_at) return null;
    const diff = Math.ceil(
      (new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000,
    );
    return Math.max(0, diff);
  }, [subscription]);

  const accessBlocked = useMemo(() => {
    if (!subscription) return false;
    const st = subscription.status;
    if (st === 'bloqueado') return true;
    const now = Date.now();
    const tolMs = Math.max(0, toleranceDays) * 86400000;
    const trialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : null;
    const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end).getTime() : null;
    // trial encerrado sem conversão para plano pago
    if (st === 'trial' && trialEnd && now > trialEnd) return true;
    if (st === 'vencido' && trialEnd && periodEnd && Math.abs(periodEnd - trialEnd) < 60000 && now > trialEnd) return true;
    // plano pago vencido além do período de tolerância
    if ((st === 'ativo' || st === 'pendente' || st === 'vencido') && periodEnd && now > periodEnd + tolMs) return true;
    return false;
  }, [subscription, toleranceDays]);

  const value: Ctx = {
    loading,
    userDataLoading,
    session,
    profile,
    company,
    subscription,
    planFeatures,
    accessBlocked,
    trialDaysLeft,
    brandLogo,
    connError,
    refreshCompany,
    signOut,
    toasts,
    toast,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
