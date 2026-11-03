#!/usr/bin/env node
// Servidor MCP (stdio) do Guardei.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CATEGORIAS } from '../js/config.js';
import { criarCliente } from './sessao.mjs';
import { criarFerramentas } from './tools.mjs';

const server = new McpServer({ name: 'guardei', version: '1.0.0' });
let ferramentas;
const obter = () => (ferramentas ||= criarFerramentas(criarCliente()));

function registrar(nome, titulo, descricao, schema, { somenteLeitura = true } = {}) {
  server.registerTool(nome, {
    title: titulo,
    description: descricao,
    inputSchema: schema,
    annotations: { readOnlyHint: somenteLeitura, destructiveHint: false },
  }, async (args) => {
    try {
      const r = await obter()[nome](args || {});
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  });
}

registrar('search_saves', 'Buscar salvos',
  'Search the user\'s saved posts, Reels, TikToks, videos and pages (content mostly in Brazilian Portuguese). Matches title, summary, caption, transcript, on-screen text, notes and category. Returns short items; use get_save for the full transcript.',
  { query: z.string().describe('Words the user remembers, e.g. "massa com limão"'), category: z.enum(CATEGORIAS).optional(), limit: z.number().int().min(1).max(50).optional() });
registrar('recent_saves', 'Salvos recentes', 'List the most recent saves (newest first).', { limit: z.number().int().min(1).max(50).optional() });
registrar('get_save', 'Ler salvo', 'Get one save with everything: summary, caption, full transcript, on-screen text, note, tags and folders.', { id: z.string() });
registrar('list_folders', 'Listar pastas', 'List the user\'s folders with item counts.', {});
registrar('get_folder', 'Ler pasta', 'Get every save inside a folder (by name or id), with full content. Example: get_folder("Receitas") to build a shopping list from saved recipes.', { name: z.string() });
registrar('save_link', 'Guardar link', 'Save a new link to Guardei, optionally into a folder (created if missing). The app reads and summarizes it later.', { url: z.string(), folder: z.string().optional() }, { somenteLeitura: false });
registrar('create_folder', 'Criar pasta', 'Create a folder.', { name: z.string().min(1).max(60) }, { somenteLeitura: false });
registrar('add_to_folder', 'Adicionar à pasta', 'Add saves (by id) to a folder (by name; created if missing). Nothing is ever deleted.', { save_ids: z.array(z.string()).min(1), folder: z.string() }, { somenteLeitura: false });

await server.connect(new StdioServerTransport());
