/* ─────────────────────────────────────────────────────────────────────
   LAN4 — Mecanismo de teste A/B/C do formulário — RODADA 2
   Carrega ANTES de main.js. Sem dependência.

   MUDANÇA vs. rodada 1:
   - Split de 2 (A|B) para 3 braços: B | C | D, 33/33/33.
     A Variante A foi removida (perdeu a rodada 1).
       B = 3 micro-etapas: qualificacao -> contato -> servico   (vencedor provisório)
       C = 3 micro-etapas: servico -> qualificacao -> contato   (antagônica "serviço primeiro")
       D = 1 etapa corrida, todos os campos visíveis            (antagônica "sem etapas")
   - Em C e D a etapa `contato` é a ÚLTIMA (ou única) -> o main.js NÃO
     dispara lead_partial_submit sozinho (ele só dispara ao SAIR da etapa
     `contato`). Este arquivo passa a disparar o parcial quando
     nome+email+telefone da etapa `contato` ficam válidos — mesmo evento
     `lead_partial_submit`, mesmo trigger 109 no GTM. Guard por variante.

   Contrato de marcação nas páginas:
     <form id="lf" ...>
       <div data-fv-progress="B"> ...barra da B... </div>
       <div data-fv-progress="C"> ...barra da C... </div>
       <!-- D não tem barra de progresso (1 etapa) -->
       <fieldset class="lf-step" data-fv="B" data-step-name="qualificacao" ...>
       <fieldset class="lf-step" data-fv="B" data-step-name="contato" ...>
       <fieldset class="lf-step" data-fv="B" data-step-name="servico" ...>
       <fieldset class="lf-step" data-fv="C" data-step-name="servico" ...>
       <fieldset class="lf-step" data-fv="C" data-step-name="qualificacao" ...>
       <fieldset class="lf-step" data-fv="C" data-step-name="contato" ...>
       <fieldset class="lf-step" data-fv="D" data-step-name="contato" ...>   (única, tudo dentro)
     Fieldsets sem data-fv ficam intactos.

   Override QA:  ?fv=B  |  ?fv=C  |  ?fv=D  (não grava cookie)
   Preview (seletor visível):  window.LAN4_AB_PREVIEW = true
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var COOKIE = 'lan4_fv';
  var VISITOR = 'lan4_vid';
  var DAYS90 = 60 * 60 * 24 * 90;
  var VARIANTS = ['B', 'C', 'D'];

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
    } catch (e) {}
  }

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

  /* FNV-1a 32-bit -> inteiro estável. 3 faixas iguais de ~33: <33 B, <66 C, resto D.
     Determinístico: o MESMO visitorId sempre cai no MESMO braço. */
  function hashPercent(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 99; // 0..98 -> 3 faixas exatas de 33
  }
  function bucket(pct) {
    if (pct < 33) return 'B';
    if (pct < 66) return 'C';
    return 'D';
  }

  function resolveVariant() {
    try {
      var q = new URLSearchParams(location.search).get('fv');
      if (VARIANTS.indexOf(q) !== -1) return { v: q, source: 'url' };
    } catch (e) {}

    var cached = readCookie(COOKIE);
    if (VARIANTS.indexOf(cached) !== -1) return { v: cached, source: 'cookie' };

    var vid = readCookie(VISITOR);
    if (!vid) { vid = makeVisitorId(); writeCookie(VISITOR, vid); }
    var v = bucket(hashPercent(vid));
    writeCookie(COOKIE, v);
    return { v: v, source: 'hash' };
  }

  var picked = resolveVariant();
  var VARIANT = picked.v;
  window.LAN4_FORM_VARIANT = VARIANT;

  window.dataLayer.push({
    event: 'form_variant_assigned',
    form_variant: VARIANT,
    form_variant_source: picked.source
  });
  window.dataLayer.push({ form_variant: VARIANT });

  /* ── Poda do DOM: remove os fieldsets/barras das variantes NÃO escolhidas ── */
  function prune() {
    var keep = VARIANT;
    var all = document.querySelectorAll('[data-fv], [data-fv-progress]');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      var tag = n.getAttribute('data-fv') || n.getAttribute('data-fv-progress');
      if (tag && tag !== keep && n.parentNode) n.parentNode.removeChild(n);
    }
    var forms = document.querySelectorAll('form#lf, form[data-rd-id]');
    for (var j = 0; j < forms.length; j++) forms[j].setAttribute('data-fv-active', VARIANT);
    document.documentElement.setAttribute('data-fv', VARIANT);
    if (window.LAN4_AB_PREVIEW) mountPreviewSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prune);
  } else {
    prune();
  }

  /* ─────────────────────────────────────────────────────────────────
     PARCIAL EM C e D — dispara lead_partial_submit quando nome+email+
     telefone da etapa `contato` ficam válidos, SEM depender de troca de
     etapa (que em C/D não acontece: contato é a última/única tela).
     Em B, o main.js já cuida disso ao SAIR da etapa `contato` — aqui
     não fazemos nada para B.
     ───────────────────────────────────────────────────────────────── */
  (function partialForCD() {
    if (VARIANT !== 'C' && VARIANT !== 'D') return;

    function val(form, name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? String(el.value || '').trim() : '';
    }
    function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
    function telOk(v) { return v.replace(/\D/g, '').length >= 10; }

    function tryFire(form) {
      if (form.lan4ContatoParcialEnviado) return;
      var nome = val(form, 'nome');
      var email = val(form, 'email');
      var tel = val(form, 'telefone');
      if (!nome || !emailOk(email) || !telOk(tel)) return;

      form.lan4ContatoParcialEnviado = true;
      var rdId = form.getAttribute('data-rd-id') || 'lan4-contato-site';

      /* mesmas funções do main.js — se existirem, usa; senão, empurra o
         evento no dataLayer para o GTM (trigger 109) do mesmo jeito. */
      try {
        if (typeof window.lan4EnviaContatoParcial === 'function') {
          window.lan4EnviaContatoParcial(form, rdId);
        }
      } catch (e) {}
      try {
        if (typeof window.lan4PushLead === 'function') {
          window.lan4PushLead(rdId + '-parcial',
            { nome: nome, email: email, telefone: tel }, 'lead_partial_submit');
          return;
        }
      } catch (e) {}
      /* fallback: evento cru no dataLayer (mantém o contrato do GTM) */
      window.dataLayer.push({
        event: 'lead_partial_submit',
        form_identifier: rdId,
        form_variant: VARIANT
      });
    }

    function bind() {
      var forms = document.querySelectorAll('form#lf, form[data-rd-id]');
      for (var i = 0; i < forms.length; i++) {
        (function (form) {
          ['blur', 'change'].forEach(function (evt) {
            form.addEventListener(evt, function (e) {
              var t = e.target;
              if (t && (t.name === 'nome' || t.name === 'email' || t.name === 'telefone')) {
                tryFire(form);
              }
            }, true);
          });
        })(forms[i]);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else { bind(); }
  })();

  /* ── UX (nos 3 braços): typo no domínio do e-mail, no blur ── */
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

  /* ── Máscara visual de telefone no blur (só display; value numérico ao RD) ── */
  (function () {
    document.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el || el.name !== 'telefone' || !el.value) return;
      var d = el.value.replace(/\D/g, '').slice(0, 11);
      if (d.length < 10) return;
      var fmt = d.length === 11
        ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
        : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
      el.value = fmt;
    }, true);
    /* ao focar de volta, tira a máscara para não atrapalhar a edição */
    document.addEventListener('focus', function (e) {
      var el = e.target;
      if (el && el.name === 'telefone' && el.value) {
        el.value = el.value.replace(/\D/g, '');
      }
    }, true);
  })();

  /* ── Seletor visível B|C|D — só no preview, nunca em prod ── */
  function mountPreviewSwitcher() {
    if (document.getElementById('lan4-ab-switch')) return;
    var bar = document.createElement('div');
    bar.id = 'lan4-ab-switch';
    bar.style.cssText = 'position:fixed;z-index:99999;left:12px;bottom:12px;' +
      'font:600 12px/1.2 system-ui,sans-serif;background:#0A1428;color:#fff;' +
      'border:1px solid #FFD900;border-radius:10px;padding:8px 10px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:6px;align-items:center';
    function pill(v, label) {
      return '<a href="?fv=' + v + '" style="padding:4px 9px;border-radius:6px;text-decoration:none;' +
        (VARIANT === v ? 'background:#FFD900;color:#0A1428' : 'background:#1e2a44;color:#fff') +
        '">' + label + '</a>';
    }
    bar.innerHTML = '<span style="opacity:.7">Variante:</span>' +
      pill('B', 'B · qualif→contato→serviço') +
      pill('C', 'C · serviço→qualif→contato') +
      pill('D', 'D · 1 etapa');
    document.body.appendChild(bar);
  }
})();
