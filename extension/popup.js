const $ = (id) => document.getElementById(id);
const enviar = (msg) => chrome.runtime.sendMessage(msg);

async function mostrar() {
  const { sessao, fila, appUrl } = await enviar({ tipo: 'sessao' });
  $('login').hidden = !!sessao;
  $('logado').hidden = !sessao;
  $('abrir').href = appUrl;
  if (sessao) {
    const usuario = sessao.email.replace(/@controle-pessoal\.app$/, '');
    $('quem').textContent = `${sessao.nome || usuario}${fila ? ` · ${fila} na fila (sem internet)` : ''}`;
  } else $('usuario').focus();
}

$('login').onsubmit = async (e) => {
  e.preventDefault();
  $('erro').textContent = '';
  const r = await enviar({ tipo: 'login', usuario: $('usuario').value.trim(), senha: $('senha').value });
  if (r.ok) mostrar();
  else $('erro').textContent = r.erro;
};

$('guardar').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https?:/.test(tab?.url || '')) {
    $('resultado').textContent = 'Esta página não pode ser guardada.';
    return;
  }
  $('guardar').disabled = true;
  const r = await enviar({ tipo: 'guardar', dados: { url: tab.url, titulo: tab.title } });
  $('guardar').disabled = false;
  $('resultado').textContent = r.ok ? (r.jaExistia ? 'Já estava guardada.' : r.pendente ? 'Sem internet: vai assim que voltar.' : 'Guardada!') : `Erro: ${r.erro}`;
};

$('sair').onclick = async () => {
  await enviar({ tipo: 'sair' });
  mostrar();
};

mostrar();
