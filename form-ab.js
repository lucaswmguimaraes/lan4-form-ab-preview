/* ─────────────────────────────────────────────────────────────────────
   LAN4 — Mecanismo de teste A/B do formulário
   Carrega ANTES de main.js. Não tem dependência.

   O que faz:
   1. Sorteia (hash determinístico) o visitante em A ou B, persiste 90d.
   2. Empurra { form_variant } no dataLayer ANTES de qualquer form_start.
   3. Remove do DOM o conjunto de <fieldset> da variante NÃO sorteada,
      de forma síncrona, antes do main.js instanciar o lan4MultiStep —
      então main.js enxerga um form normal e nada muda no fluxo dele.

   Contrato de marcação nas páginas:
     <form id="lf" ...>
       <div data-fv-progress="A"> ...barra de progresso da A... </div>
       <div data-fv-progress="B"> ...barra de progresso da B... </div>
       <fieldset class="lf-step" data-fv="A" data-step-name="contato" ...>
       <fieldset class="lf-step" data-fv="A" data-step-name="servico" ...>
       <fieldset class="lf-step" data-fv="B" data-step-name="qualificacao" ...>
       <fieldset class="lf-step" data-fv="B" data-step-name="contato" ...>
       <fieldset class="lf-step" data-fv="B" data-step-name="servico" ...>
     Fieldsets sem data-fv (ex.: Engine antes desta mudança) ficam intactos.

   Override manual p/ QA:  ?fv=A  ou  ?fv=B  na URL (não grava cookie).
   Preview (seletor visível):  window.LAN4_AB_PREVIEW = true no HTML.
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var COOKIE = 'lan4_fv';
  var VISITOR = 'lan4_vid';
  var DAYS90 = 60 * 60 * 24 * 90;

  window.dataLayer = window.dataLayer || [];

  function readCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }
  function writeCookie(name, value) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) +
        ';path=/;max-age=' + DAYS90 + ';SameSite=Lax';
    } catch (e) { /* modo privado / cookies bloqueados: segue sem persistir */ }
  }

  /* uuid v4 simples (só p/ identificar o visitante no split — não é PII) */
  function makeVisitorId() {
    if (window.crypto && crypto.getRandomValues) {
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = [];
      for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
             h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' +
             h.slice(10, 16).join('');
    }
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* FNV-1a 32-bit → inteiro estável. Split 50/50 = resto < 50.
     Determinístico: o MESMO visitorId sempre cai no MESMO braço, e a
     função é uniforme o suficiente p/ ~50/50 desde o 1º dia, sem
     depender de sorte de amostragem (importa no volume baixo da LAN4). */
  function hashPercent(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 100;
  }

  function resolveVariant() {
    /* 1. override de QA na URL — não grava cookie */
    try {
      var q = new URLSearchParams(location.search).get('fv');
      if (q === 'A' || q === 'B') return { v: q, source: 'url' };
    } catch (e) {}

    /* 2. cookie já decidido */
    var cached = readCookie(COOKIE);
    if (cached === 'A' || cached === 'B') return { v: cached, source: 'cookie' };

    /* 3. sorteia por hash do visitorId (cria o visitorId se não existir) */
    var vid = readCookie(VISITOR);
    if (!vid) { vid = makeVisitorId(); writeCookie(VISITOR, vid); }
    var v = hashPercent(vid) < 50 ? 'A' : 'B';
    writeCookie(COOKIE, v);
    return { v: v, source: 'hash' };
  }

  var picked = resolveVariant();
  var VARIANT = picked.v;
  window.LAN4_FORM_VARIANT = VARIANT;

  /* dataLayer ANTES de qualquer form_start — vira dimensão no GA4 e
     parâmetro no Pixel. NÃO altera nenhum trigger; só carimba a origem. */
  window.dataLayer.push({
    event: 'form_variant_assigned',
    form_variant: VARIANT,
    form_variant_source: picked.source
  });
  /* também como propriedade "solta" p/ variáveis de DL que leem sem evento */
  window.dataLayer.push({ form_variant: VARIANT });

  /* ── Poda do DOM: remove os fieldsets/barras da variante não escolhida.
     Roda o quanto antes: se o script está no <head> com defer, o
     DOMContentLoaded cobre; se está no fim do <body> antes do main.js,
     roda direto. Cobrimos os dois casos. */
  function prune() {
    var other = VARIANT === 'A' ? 'B' : 'A';
    var nodes = document.querySelectorAll(
      '[data-fv="' + other + '"], [data-fv-progress="' + other + '"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
    /* marca no <form> qual variante ficou (útil p/ CSS e p/ debug) */
    var forms = document.querySelectorAll('form#lf, form[data-rd-id]');
    for (var j = 0; j < forms.length; j++) forms[j].setAttribute('data-fv-active', VARIANT);

    document.documentElement.setAttribute('data-fv', VARIANT);
    if (window.LAN4_AB_PREVIEW) mountPreviewSwitcher();
  }

  /* Com <script defer> (que é como este arquivo e o main.js são incluídos),
     este código roda DEPOIS do HTML totalmente parseado e ANTES do
     DOMContentLoaded — readyState === 'interactive'. Nesse ponto os
     <fieldset> das duas variantes já existem no DOM, então podamos
     síncrono, ANTES do main.js (incluído logo depois) instanciar o
     lan4MultiStep. Se por algum motivo ainda estiver 'loading'
     (script sem defer), caímos no listener. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prune);
  } else {
    prune();
  }

  /* ── UX P1 (nas DUAS variantes): sugestão de correção de typo no
     domínio do e-mail, no blur do campo. Não bloqueia envio. ── */
  (function () {
    var CORRECOES = {
      'gmial.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com',
      'gmail.cm': 'gmail.com', 'gnail.com': 'gmail.com',
      'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com',
      'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com',
      'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com',
      'uol.com': 'uol.com.br', 'bol.com': 'bol.com.br'
    };
    document.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el || el.name !== 'email' || !el.value) return;
      var parts = el.value.trim().split('@');
      var hint = el.parentNode && el.parentNode.querySelector('.lf-email-typo');
      if (!hint) return;
      if (parts.length !== 2) { hint.hidden = true; return; }
      var sug = CORRECOES[parts[1].toLowerCase()];
      if (sug) {
        hint.textContent = 'Você quis dizer ' + parts[0] + '@' + sug + '?';
        hint.hidden = false;
        hint.style.cursor = 'pointer';
        hint.onclick = function () {
          el.value = parts[0] + '@' + sug;
          hint.hidden = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
      } else {
        hint.hidden = true;
      }
    }, true);
  })();

  /* ── Seletor visível A|B — só no preview (GitHub Pages), nunca em prod ── */
  function mountPreviewSwitcher() {
    if (document.getElementById('lan4-ab-switch')) return;
    var bar = document.createElement('div');
    bar.id = 'lan4-ab-switch';
    bar.style.cssText = 'position:fixed;z-index:99999;left:12px;bottom:12px;' +
      'font:600 12px/1.2 system-ui,sans-serif;background:#0A1428;color:#fff;' +
      'border:1px solid #FFD900;border-radius:10px;padding:8px 10px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:6px;align-items:center';
    bar.innerHTML =
      '<span style="opacity:.7">Variante do form:</span>' +
      '<a href="?fv=A" style="padding:4px 9px;border-radius:6px;text-decoration:none;' +
        (VARIANT === 'A' ? 'background:#FFD900;color:#0A1428' : 'background:#1e2a44;color:#fff') + '">A · atual</a>' +
      '<a href="?fv=B" style="padding:4px 9px;border-radius:6px;text-decoration:none;' +
        (VARIANT === 'B' ? 'background:#FFD900;color:#0A1428' : 'background:#1e2a44;color:#fff') + '">B · 3 etapas</a>';
    document.body.appendChild(bar);
  }
})();
