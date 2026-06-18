/**
 * migrar-lid-conversas.js
 * Migração one-time: encontra conversas cujo telefone é um LID WhatsApp
 * (ex: 62972877619405) e tenta vinculá-las à conversa real do contato.
 *
 * Executar: node scripts/migrar-lid-conversas.js
 * Seguro — só lê e imprime. Não altera nada sem --aplicar flag.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const APLICAR = process.argv.includes('--aplicar');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

function isLid(tel) {
  // LID: numérico puro, 12-15 dígitos, NÃO começa com 55 + DDD válido
  if (!tel) return false;
  const t = String(tel).replace(/\D/g, '');
  return t.length >= 12 && !t.startsWith('55');
}

async function main() {
  console.log('=== Migração LID WhatsApp ===');
  console.log('Modo:', APLICAR ? 'APLICAR MUDANÇAS' : 'SÓ ANÁLISE (use --aplicar para salvar)');
  console.log('');

  // 1. Busca conversas com telefone que parece LID
  const { data: conversas, error } = await sb
    .from('conversas_whatsapp')
    .select('id, telefone, lead_id, nome_contato, dados_extras, ultima_msg_em')
    .order('ultima_msg_em', { ascending: false });

  if (error) { console.error('Erro ao buscar conversas:', error.message); process.exit(1); }

  const comLid = (conversas || []).filter(c => isLid(c.telefone));
  console.log(`Total conversas: ${conversas.length} | Com LID: ${comLid.length}`);
  console.log('');

  if (!comLid.length) {
    console.log('✅ Nenhuma conversa com LID encontrada. Nada a fazer.');
    return;
  }

  for (const c of comLid) {
    console.log(`\nConversa ${c.id}`);
    console.log(`  telefone: ${c.telefone} (LID)`);
    console.log(`  lead_id: ${c.lead_id || '(sem lead)'}`);
    console.log(`  nome_contato: ${c.nome_contato || '(sem nome)'}`);

    // Tenta encontrar a conversa "real" pelo lead_id
    if (c.lead_id) {
      const { data: convReal } = await sb.from('conversas_whatsapp')
        .select('id, telefone')
        .eq('lead_id', c.lead_id)
        .neq('id', c.id)
        .order('ultima_msg_em', { ascending: false })
        .limit(1);

      if (convReal?.[0]) {
        console.log(`  → Conversa real encontrada: ${convReal[0].id} (tel: ${convReal[0].telefone})`);

        if (APLICAR) {
          // Move mensagens da conversa LID para a conversa real
          const { data: msgs } = await sb.from('mensagens_whatsapp')
            .select('id').eq('conversa_id', c.id);
          if (msgs?.length) {
            await sb.from('mensagens_whatsapp')
              .update({ conversa_id: convReal[0].id })
              .eq('conversa_id', c.id);
            console.log(`  ✅ ${msgs.length} mensagem(ns) migrada(s) para conversa real`);
          }
          // Marca conversa LID como fechada
          await sb.from('conversas_whatsapp')
            .update({ status: 'FECHADA', dados_extras: JSON.stringify({ lid: c.telefone, migrado_para: convReal[0].id }) })
            .eq('id', c.id);
          // Armazena LID na conversa real para lookups futuros
          const { data: crAtual } = await sb.from('conversas_whatsapp')
            .select('dados_extras').eq('id', convReal[0].id).single();
          const ex = (() => { try { return JSON.parse(crAtual?.dados_extras || '{}'); } catch { return {}; } })();
          ex.lid = c.telefone;
          await sb.from('conversas_whatsapp')
            .update({ dados_extras: JSON.stringify(ex) })
            .eq('id', convReal[0].id);
          console.log(`  ✅ LID ${c.telefone} mapeado em dados_extras da conversa real`);
        }
      } else {
        console.log(`  → Sem conversa real pelo lead_id. LID ficará orphan.`);
      }
    } else {
      console.log(`  → Sem lead_id. Não é possível resolver automaticamente.`);
    }
  }

  console.log('\n=== Fim da migração ===');
  if (!APLICAR) console.log('Execute com --aplicar para salvar as mudanças.');
}

main().catch(e => { console.error(e); process.exit(1); });
