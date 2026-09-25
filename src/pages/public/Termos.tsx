import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { Card } from '../../components/ui';
import { supabase } from '../../lib/supabase';

const SECTIONS: { t: string; p: string[] }[] = [
  {
    t: '1. Sobre o serviço',
    p: [
      'O Agenda Logo é uma plataforma digital de gestão e agendamento online para profissionais e empresas dos segmentos de beleza, estética, barbearia, nail design, lash design, studios e atividades autônomas correlatas.',
      'O serviço inclui, conforme o plano contratado: agenda do profissional, cadastro de clientes e serviços, página pública de agendamento online, fluxo de caixa, catálogo (produtos, pacotes, promoções, pedidos e orçamentos), mensagens automáticas via WhatsApp (confirmações, lembretes e avisos de status), bloqueio automático de chamadas (Call Blocker) e demais funcionalidades descritas na interface.',
      'Alguns recursos são disponibilizados apenas em planos específicos. O que não estiver incluído no plano ativo permanece bloqueado até a contratação do plano correspondente.',
    ],
  },
  {
    t: '2. Aceite dos termos',
    p: [
      'Ao marcar a opção "Li e concordo com os Termos de Uso" na tela de login/cadastro e/ou ao criar uma conta e utilizar o Agenda Logo, você declara ter lido, compreendido e aceito integralmente estes Termos de Uso e a Política de Privacidade.',
      'Caso não concorde com qualquer disposição, você não deve utilizar a plataforma.',
    ],
  },
  {
    t: '3. Conta de acesso',
    p: [
      'Para utilizar o serviço você deve fornecer informações verdadeiras, completas e atualizadas, incluindo nome, e-mail e, se desejar, WhatsApp e dados do seu negócio.',
      'Você é o único responsável pela guarda e segurança da sua senha e por todas as atividades realizadas em sua conta. Não compartilhe seu acesso. Havendo uso não autorizado, avise-nos imediatamente.',
      'Cada conta corresponde a um único espaço (empresa/tenant), totalmente isolado das demais contas. Cada profissional/empresa conecta e administra o próprio número de WhatsApp.',
    ],
  },
  {
    t: '4. Assinatura, planos e pagamentos',
    p: [
      'O uso contínuo do Agenda Logo depende de plano ativo ou período de teste (trial) vigente.',
      'Os planos são cobrados por meio de processadores de pagamento terceirizados, atualmente o Mercado Pago, com pagamento via PIX ou outro método disponibilizado. A confirmação do pagamento é feita de forma automática e segura, com consulta direta ao processador.',
      'A assinatura se renova pelo período do plano (mensal ou outro definido). Quando o pagamento é confirmado dentro da vigência atual, o novo período é acrescido ao final do período vigente, preservando os dias restantes.',
      'Em caso de vencimento sem pagamento aprovado, o acesso às funcionalidades é bloqueado automaticamente, permanecendo seus dados preservados (clientes, agenda, serviços, histórico e configurações). Assim que um novo pagamento for confirmado, o acesso é reativado automaticamente.',
      'Você pode cancelar a assinatura quando quiser deixando de renovar. O cancelamento não gera reembolso proporcional do período já pago, e os dados podem ser excluídos definitivamente após aviso prévio por e-mail, salvo exigência legal.',
    ],
  },
  {
    t: '5. WhatsApp automático e Call Blocker',
    p: [
      'As mensagens automáticas (confirmação de agendamento, lembretes de 24h e 3h, avisos de confirmação, cancelamento, reagendamento e conclusão) são enviadas pelo número de WhatsApp conectado pelo próprio profissional. Você pode ativar/desativar cada tipo de mensagem e personalizar os textos.',
      'Você declara e garante possuir o consentimento de seus clientes finais para receber mensagens no número informado e se compromete a respeitar as políticas de uso do WhatsApp/Meta, não utilizando a plataforma para envio de spam ou mensagens não solicitadas.',
      'O Call Blocker (bloqueio automático de chamadas de voz e vídeo) atua apenas enquanto o WhatsApp estiver conectado à plataforma. Mensagens nunca são bloqueadas. A recusa pode ocorrer com um breve atraso, e a eficácia depende de fatores externos à plataforma (conexão, disponibilidade dos serviços do WhatsApp).',
      'A conectividade depende da Meta/WhatsApp. Alterações, instabilidades ou bloqueios aplicados por terceiros podem afetar o funcionamento dos recursos de WhatsApp, sem responsabilidade da Agenda Logo.',
    ],
  },
  {
    t: '6. Seus clientes e seus dados',
    p: [
      'Você é o responsável (controlador) pelos dados dos seus clientes que cadastra na plataforma (nome, telefone, histórico de atendimentos, anotações, aniversário etc.). A Agenda Logo trata esses dados apenas em seu nome, para funcionamento do serviço (agendamento, envio de mensagens e histórico).',
      'É sua obrigação obter os consentimentos necessários dos seus clientes e utilizar os dados apenas para finalidades legítimas relacionadas ao seu negócio.',
      'Cada empresa tem seus dados rigorosamente isolados dos demais usuários. Nenhum profissional tem acesso aos dados de outro.',
      'Você pode exportar ou excluir seus dados a qualquer momento; a exclusão definitiva da conta remove permanentemente todos os dados associados.',
    ],
  },
  {
    t: '7. Privacidade e LGPD',
    p: [
      'Tratamos dados pessoais em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Dados de acesso e uso (como último acesso, para fins administrativos) podem ser coletados; credenciais sensíveis (como tokens de integração) são armazenadas de forma protegida e nunca exibidas integralmente na interface.',
      'Não vendemos seus dados. Não utilizamos o conteúdo das suas agendas ou conversas para publicidade.',
    ],
  },
  {
    t: '8. Conduta e uso permitido',
    p: [
      'É proibido: utilizar a plataforma para atividades ilícitas; tentar acessar contas de outros usuários; copiar, revender, sublicenciar ou explorar comercialmente o serviço sem autorização; realizar engenharia reversa; sobrecarregar ou atacar a infraestrutura; e enviar mensagens em massa não solicitadas pelos recursos de WhatsApp.',
      'O descumprimento pode resultar em suspensão ou exclusão da conta, sem prejuízo das demais medidas legais.',
    ],
  },
  {
    t: '9. Disponibilidade, suporte e alterações',
    p: [
      'Buscamos alta disponibilidade, mas o serviço pode ficar temporariamente indisponível por manutenções, falhas de infraestrutura, publicações de atualizações ou serviços de terceiros (Supabase, Mercado Pago, Meta/WhatsApp). Períodos de janela técnica podem ocorrer, inclusive brevemente após atualizações.',
      'Podemos alterar estes Termos a qualquer momento, publicando a versão atualizada nesta página. O uso continuado do serviço após a publicação constitui aceite da nova versão.',
      'Também podemos ajustar planos e preços, valendo para assinaturas novas ou renovações futuras, com aviso prévio razoável.',
    ],
  },
  {
    t: '10. Propriedade intelectual e limitação de responsabilidade',
    p: [
      'O Agenda Logo, incluindo sua marca, interface, código e conteúdo, é propriedade de seus titulares, protegido por lei. Seus dados e os de seus clientes continuam sendo seus.',
      'O serviço é oferecido "no estado em que se encontra". Na máxima extensão permitida por lei, a Agenda Logo não responde por lucros cessantes, perda de clientes ou danos indiretos, nem por indisponibilidades de serviços de terceiros essenciais ao funcionamento (WhatsApp, processadores de pagamento, provedores de infraestrutura).',
    ],
  },
  {
    t: '11. Legislação e foro',
    p: [
      'Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro do domicílio do titular da conta para dirimir eventuais controvérsias, salvo previsão legal de competência diversa.',
      'Última atualização: 10/09/2026.',
    ],
  },
];

type Section = { t: string; p: string[] };

function parseCustom(raw: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let buf: string[] = [];
  const flush = () => {
    const p = buf.join(' ').trim();
    buf = [];
    if (p && cur) cur.p.push(p);
  };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      flush();
      if (cur) sections.push(cur);
      cur = { t: trimmed.slice(2).trim(), p: [] };
    } else if (trimmed === '') {
      flush();
    } else {
      if (!cur) cur = { t: '', p: [] };
      buf.push(trimmed);
    }
  }
  flush();
  if (cur) sections.push(cur);
  return sections;
}

export default function Termos() {
  const nav = useNavigate();
  const [sections, setSections] = useState<Section[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('app_settings').select('terms_content').eq('id', 1).maybeSingle();
      if (!alive) return;
      const raw = (data?.terms_content ?? '').trim();
      const parsed = raw ? parseCustom(raw) : [];
      setSections(parsed.length > 0 ? parsed : SECTIONS);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/70 to-slate-50 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <button onClick={() => nav(-1)} className="inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-brand-800 mb-6">
          <ArrowLeft size={16} /> Voltar
        </button>
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white shadow-lg shadow-brand-600/30">
            <CalendarDays size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-extrabold text-ink tracking-tight">Termos de Uso</h1>
            <p className="text-sm text-sub mt-1">Agenda Logo — Gestão para o seu negócio</p>
          </div>
        </div>
        <Card className="p-6 sm:p-9">
          <div className="space-y-7">
            {(sections ?? SECTIONS).map((s, si) => (
              <section key={si}>
                {s.t && <h2 className="font-extrabold text-ink text-base mb-2">{s.t}</h2>}
                <div className="space-y-2">
                  {s.p.map((par, i) => (
                    <p key={i} className="text-sm text-slate-600 leading-relaxed">{par}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Card>
        <p className="text-[11px] text-slate-400 text-center mt-6">
          Dúvidas sobre estes termos? Fale com o suporte pelo menu Conta → Pedir ajuda.
        </p>
      </div>
    </div>
  );
}
