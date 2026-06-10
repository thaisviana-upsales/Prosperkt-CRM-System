/**
 * Insere as 3 novas etapas em todos os pipelines (após ordem 5)
 * As ordens 6-8 foram liberadas pelo script anterior (Follow-Up→9, Vendas→10, Perdidos→11)
 */
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  process.exit(1);
}
const sb = createClient(supabaseUrl, supabaseKey);
async function main() {
  const { data: pipes } = await sb.from('pipelines').select('id');

  for (const pipe of pipes) {
    const pid = pipe.id;
    const { data: etapas } = await sb.from('etapas').select('nome').eq('pipeline_id', pid);
    const nomes = etapas.map(e => e.nome);

    const novasEtapas = [
      { nome: 'Orçamento Aprovado', ordem: 6, cor: '#3B8BFF' },
      { nome: 'Amostra Física', ordem: 7, cor: '#A855F7' },
      { nome: 'Amostra Aprovada', ordem: 8, cor: '#F59E0B' },
    ];

    for (const ne of novasEtapas) {
      if (nomes.includes(ne.nome)) {
        console.log(`[${pid}] "${ne.nome}" já existe — skip`);
        continue;
      }
      const slug = ne.nome.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const id = `etapa-${slug}-${pid}`;
      const { error } = await sb.from('etapas').insert({
        id,
        pipeline_id: pid,
        nome: ne.nome,
        ordem: ne.ordem,
        cor: ne.cor,
        is_ganho: 0,
        is_perdido: 0,
        probabilidade: 50,
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      });
      if (error) console.error(`❌ ${ne.nome} em ${pid}:`, error.message);
      else console.log(`✅ [${pid}] Inserida: "${ne.nome}" (ordem ${ne.ordem})`);
    }
  }
  console.log('\nInserção concluída.');
}
main().catch(console.error);
