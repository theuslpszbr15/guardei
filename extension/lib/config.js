// Configuração pública do Firebase (mesmo projeto do Controle Pessoal; os dados ficam protegidos pelas regras users/{uid}/**).
export const firebaseConfig = {
  apiKey: 'AIzaSyDjcOK9ExEX5mzkl8QITtXo1bBDW2tZ1LU',
  authDomain: 'controle-pessoal-babc1.firebaseapp.com',
  projectId: 'controle-pessoal-babc1',
  storageBucket: 'controle-pessoal-babc1.firebasestorage.app',
  messagingSenderId: '197101766748',
  appId: '1:197101766748:web:f15c4eb6deb6fcabc8fe99',
};

// Login por "usuário": o Firebase pede e-mail, então usamos o mesmo domínio interno do Controle Pessoal.
export const DOMINIO = 'controle-pessoal.app';
export const emailDe = (usuario) => (usuario.includes('@') ? usuario : `${usuario.trim().toLowerCase()}@${DOMINIO}`);
export const usuarioDe = (email = '') => (email.endsWith(`@${DOMINIO}`) ? email.split('@')[0] : email);

// Caminho dos dados do app: users/{uid}/apps/guardei/{saves|folders}/{id}
export const APP_ID = 'guardei';

// Endereço publicado do app web (usado pela extensão para o botão "Abrir o Guardei").
export const APP_URL = 'https://theuslpszbr15.github.io/guardei/';

export const CATEGORIAS = [
  'Receita', 'Lugar', 'Restaurante', 'Filmes e séries', 'Treino', 'Produto', 'Dica', 'Música',
  'Livro', 'Moda', 'Beleza', 'Casa e decoração', 'Tecnologia', 'Finanças', 'Humor', 'Carreira e estudos', 'Outro',
];

// Em ordem de preferência; o app tenta o próximo se o Google tirar algum do ar.
export const GEMINI_MODELOS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
export const GEMINI_MODELO_PADRAO = GEMINI_MODELOS[0];
