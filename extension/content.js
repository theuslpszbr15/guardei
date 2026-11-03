// Põe um botão "Guardei" ao lado do compartilhar de cada post e manda os dados do post para o service worker.
(() => {
  const ICONE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.5L12 16.6l-6.5 3.9V5A1.5 1.5 0 0 1 7 3.5z"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.5L12 16.6l-6.5 3.9V5A1.5 1.5 0 0 1 7 3.5z" fill="currentColor"/><path d="m9 9.6 2.2 2.2 4-4.3" stroke="#fff"/></svg>';
  const host = location.hostname.replace(/^www\./, '');

  const txt = (el) => (el?.innerText || el?.textContent || '').trim();
  const abs = (href) => { try { return new URL(href, location.href).href; } catch { return ''; } };
  const imgDe = (raiz, minimo = 150) => {
    for (const el of raiz.querySelectorAll('img, video[poster]')) {
      const src = el.tagName === 'VIDEO' ? el.poster : el.currentSrc || el.src;
      if (src?.startsWith('https://') && el.getBoundingClientRect().width >= minimo) return src;
    }
    return '';
  };

  // Cada site: onde estão os posts, onde pôr o botão e como ler o post.
  const SITES = {
    'x.com': {
      posts: () => document.querySelectorAll('article[data-testid="tweet"]'),
      barra: (p) => [...p.querySelectorAll('[role="group"]')].pop(),
      dados: (p) => ({
        url: abs(p.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href')) || location.href,
        legenda: txt(p.querySelector('[data-testid="tweetText"]')),
        autor: (txt(p.querySelector('[data-testid="User-Name"]')).match(/@\w+/) || [''])[0],
        capa: p.querySelector('[data-testid="tweetPhoto"] img')?.src || p.querySelector('video[poster]')?.poster || '',
      }),
    },
    'instagram.com': {
      posts: () => [...document.querySelectorAll('svg[aria-label="Share"], svg[aria-label="Compartilhar"], svg[aria-label="Share Post"], svg[aria-label="Compartilhar publicação"]')]
        .map((svg) => svg.closest('article') || svg.closest('section')?.parentElement || svg.closest('div[role="presentation"]') || document.body)
        .filter((p, i, arr) => arr.indexOf(p) === i),
      barra: (p) => {
        const svg = p.querySelector('svg[aria-label="Share"], svg[aria-label="Compartilhar"], svg[aria-label="Share Post"], svg[aria-label="Compartilhar publicação"]');
        const botao = svg?.closest('[role="button"], button');
        return botao?.parentElement?.parentElement === p ? botao.parentElement : botao?.parentElement;
      },
      dados: (p) => {
        const link = p.querySelector('a[href*="/p/"], a[href*="/reel/"]')?.getAttribute('href');
        return {
          url: /\/(p|reel|reels)\//.test(location.pathname) && p === document.body ? location.href : abs(link) || location.href,
          legenda: txt(p.querySelector('h1')) || txt(p.querySelector('ul li span[dir="auto"]')),
          autor: txt(p.querySelector('header a[href^="/"]:not([href*="/p/"])')) || '',
          capa: imgDe(p, 200),
        };
      },
    },
    'tiktok.com': {
      posts: () => [...document.querySelectorAll('[data-e2e="share-icon"], [data-e2e="video-share-icon"], [data-e2e="browse-share-icon"]')]
        .map((i) => i.closest('article') || i.closest('[data-e2e="recommend-list-item-container"]') || document.body)
        .filter((p, i, arr) => arr.indexOf(p) === i),
      barra: (p) => p.querySelector('[data-e2e="share-icon"], [data-e2e="video-share-icon"], [data-e2e="browse-share-icon"]')?.closest('button')?.parentElement,
      dados: (p) => ({
        url: abs(p.querySelector('a[href*="/video/"], a[href*="/photo/"]')?.getAttribute('href')) || location.href,
        legenda: txt(p.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]')),
        autor: txt(p.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]')).replace(/^@?/, '@'),
        capa: p.querySelector('img[src*="tiktokcdn"]')?.src || '',
      }),
    },
    'youtube.com': {
      posts: () => document.querySelectorAll('ytd-watch-metadata, ytd-reel-video-renderer[is-active], ytd-shorts reel-action-bar-view-model'),
      barra: (p) => p.querySelector('#top-level-buttons-computed') || p.querySelector('#actions') || (p.tagName === 'REEL-ACTION-BAR-VIEW-MODEL' ? p : null),
      dados: () => ({
        url: location.href,
        titulo: txt(document.querySelector('ytd-watch-metadata h1')) || document.title.replace(/ - YouTube$/, ''),
        autor: txt(document.querySelector('ytd-watch-metadata #channel-name a')) || '',
      }),
    },
    'linkedin.com': {
      posts: () => document.querySelectorAll('div[data-urn^="urn:li:activity"], div[data-id^="urn:li:activity"]'),
      barra: (p) => p.querySelector('.feed-shared-social-action-bar, .social-details-social-activity ~ div, [class*="social-action-bar"]'),
      dados: (p) => {
        const urn = p.getAttribute('data-urn') || p.getAttribute('data-id');
        return {
          url: `https://www.linkedin.com/feed/update/${urn}/`,
          legenda: txt(p.querySelector('.update-components-text, .feed-shared-inline-show-more-text')),
          autor: txt(p.querySelector('.update-components-actor__title span[aria-hidden="true"]')),
          capa: p.querySelector('.update-components-image img, .update-components-article__image img, video[poster]')?.src || p.querySelector('video[poster]')?.poster || '',
        };
      },
    },
  };
  SITES['twitter.com'] = SITES['x.com'];
  const site = SITES[host];
  if (!site) return;

  const enviar = (msg) => new Promise((ok) => {
    try { chrome.runtime.sendMessage(msg, (r) => ok(chrome.runtime.lastError ? { ok: false, erro: 'extensao' } : r)); } catch { ok({ ok: false, erro: 'extensao' }); }
  });

  function aviso(texto, acao) {
    document.querySelector('.guardei-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'guardei-toast';
    t.append(Object.assign(document.createElement('span'), { textContent: texto }));
    if (acao) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: acao.rotulo });
      b.onclick = () => { acao.fn(); t.remove(); };
      t.append(b);
    }
    document.body.append(t);
    setTimeout(() => t.remove(), acao ? 5200 : 2600);
  }

  function marcar(btn, salvo) {
    btn.dataset.salvo = salvo ? '1' : '';
    btn.innerHTML = salvo ? CHECK : ICONE;
    btn.title = salvo ? 'Guardado no Guardei (clique para remover)' : 'Guardar no Guardei';
    btn.setAttribute('aria-pressed', String(salvo));
  }

  function criarBotao(post) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `guardei-btn guardei-${host.split('.')[0]}`;
    marcar(btn, false);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dados = site.dados(post);
      if (btn.dataset.salvo) {
        // Remove só depois de 5 s, com chance de desfazer.
        marcar(btn, false);
        const timer = setTimeout(() => enviar({ tipo: 'remover', url: dados.url }), 5000);
        aviso('Removido do Guardei', { rotulo: 'Desfazer', fn: () => { clearTimeout(timer); marcar(btn, true); } });
        return;
      }
      btn.disabled = true;
      const r = await enviar({ tipo: 'guardar', dados });
      btn.disabled = false;
      if (r?.ok) {
        marcar(btn, true);
        aviso(r.pendente ? 'Sem internet: guardo assim que voltar' : r.jaExistia ? 'Já estava no Guardei' : 'Guardado no Guardei');
      } else aviso(r?.erro === 'login' ? 'Entre na extensão Guardei (ícone na barra) para guardar' : 'Não deu para guardar agora');
    }, true);
    return btn;
  }

  let agendado = false;
  async function varrer() {
    agendado = false;
    const novos = [];
    for (const post of site.posts()) {
      const barra = site.barra(post);
      if (!barra || barra.querySelector('.guardei-btn')) continue;
      const btn = criarBotao(post);
      barra.append(btn);
      novos.push([btn, post]);
    }
    if (!novos.length) return;
    const urls = novos.map(([, p]) => { try { return site.dados(p).url; } catch { return ''; } });
    const r = await enviar({ tipo: 'status', urls });
    r?.salvos?.forEach((s, i) => s && marcar(novos[i][0], true));
  }

  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    setTimeout(varrer, 600);
  }).observe(document.body, { childList: true, subtree: true });
  // YouTube troca de vídeo sem recarregar: refaz os botões para o estado bater com o vídeo novo.
  addEventListener('yt-navigate-finish', () => {
    document.querySelectorAll('.guardei-btn').forEach((b) => b.remove());
    varrer();
  });
  varrer();
})();
