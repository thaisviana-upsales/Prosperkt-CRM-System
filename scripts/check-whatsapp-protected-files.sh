#!/usr/bin/env bash
# ============================================================
# check-whatsapp-protected-files.sh
# Verifica se arquivos críticos do WhatsApp foram alterados.
# Rodar antes de qualquer deploy: npm run check:whatsapp
# ============================================================

set -euo pipefail

ARQUIVOS_PROTEGIDOS=(
  "src/controllers/whatsappController.js"
  "public/js/whatsapp.js"
  "src/routes/whatsapp.js"
  "src/services/evolutionApiService.js"
  "src/services/whatsappService.js"
)

PADROES_NOME=(
  "whatsapp"
  "evolution"
  "webhook"
)

ALTERADOS=()

echo ""
echo "========================================================"
echo "  CHECK: Arquivos críticos do WhatsApp"
echo "========================================================"
echo ""

# 1. Verifica arquivos protegidos por nome exato (staged + unstaged)
for f in "${ARQUIVOS_PROTEGIDOS[@]}"; do
  if git diff --name-only HEAD 2>/dev/null | grep -qF "$f"; then
    ALTERADOS+=("$f (modificado não commitado)")
  fi
  if git diff --name-only --cached 2>/dev/null | grep -qF "$f"; then
    ALTERADOS+=("$f (staged para commit)")
  fi
done

# 2. Verifica qualquer arquivo cujo nome contenha padrões sensíveis
for padrao in "${PADROES_NOME[@]}"; do
  while IFS= read -r linha; do
    if [[ -n "$linha" ]]; then
      ALTERADOS+=("$linha (contém: $padrao)")
    fi
  done < <(git diff --name-only HEAD 2>/dev/null | grep -i "$padrao" || true)
  while IFS= read -r linha; do
    if [[ -n "$linha" ]]; then
      ALTERADOS+=("$linha (staged, contém: $padrao)")
    fi
  done < <(git diff --name-only --cached 2>/dev/null | grep -i "$padrao" || true)
done

# Remove duplicatas
if [ ${#ALTERADOS[@]} -gt 0 ]; then
  mapfile -t ALTERADOS_UNIQ < <(printf "%s\n" "${ALTERADOS[@]}" | sort -u)
else
  ALTERADOS_UNIQ=()
fi

if [ ${#ALTERADOS_UNIQ[@]} -eq 0 ]; then
  echo "  ✅  Nenhum arquivo crítico do WhatsApp foi alterado."
  echo ""
  echo "  Pode prosseguir com o commit/deploy."
  echo ""
else
  echo "  ⛔⛔⛔  ATENÇÃO — ARQUIVOS CRÍTICOS DO WHATSAPP ALTERADOS  ⛔⛔⛔"
  echo ""
  for f in "${ALTERADOS_UNIQ[@]}"; do
    echo "     ► $f"
  done
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║  CONFIRMAR TESTE MANUAL antes de commit/deploy:          ║"
  echo "  ║                                                          ║"
  echo "  ║  1. Enviar texto pelo CRM                                ║"
  echo "  ║  2. WhatsApp recebe                                      ║"
  echo "  ║  3. Cliente responde                                     ║"
  echo "  ║  4. CRM recebe na MESMA conversa                        ║"
  echo "  ║  5. Sem duplicata / Sem conversa LID oculta              ║"
  echo "  ║                                                          ║"
  echo "  ║  Checklist: docs/CHECKLIST_WHATSAPP_ANTES_DE_COMMIT.md  ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""
fi

echo "========================================================"
