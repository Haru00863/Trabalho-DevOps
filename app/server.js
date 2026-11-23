'use strict';

/*
 * API da Loja - Atividade N3
 *
 * Decisões de projeto (importantes para as perguntas do relatório):
 *
 * 1. TODA configuração vem de variáveis de ambiente (12-factor app). O mesmo
 *    código roda no Compose e no Kubernetes; só muda de onde as variáveis vêm
 *    (arquivo .env no Compose; ConfigMap + Secret no Kubernetes).
 *
 * 2. Existem DUAS rotas de saúde, com propósitos diferentes:
 *      /live   -> "o processo está vivo?"  (usada na livenessProbe)
 *                 Não consulta banco/Redis. Se consultasse, uma queda do MySQL
 *                 faria o Kubernetes REINICIAR a API sem necessidade.
 *      /health -> "estou pronta para atender?" (readinessProbe e healthcheck
 *                 do Compose). Testa MySQL e Redis. Se falhar, o pod sai do
 *                 Service (não recebe tráfego), mas não é reiniciado.
 *
 * 3. Na inicialização, a API TENTA conectar ao MySQL várias vezes em vez de
 *    morrer na primeira falha. No Kubernetes não existe "depends_on": o banco
 *    pode demorar a ficar pronto, e a aplicação precisa tolerar isso.
 *
 * 4. /carga existe só para a demonstração do HPA (Parte 4, item 5): consome
 *    CPU de propósito, porque chamadas simples a /health quase não gastam CPU
 *    e o autoscaler nunca dispararia.
 */

const express = require('express');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');

// ---------------------------------------------------------------------------
// Configuração (variáveis de ambiente, com valores padrão só para teste local)
// ---------------------------------------------------------------------------
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  version: process.env.APP_VERSION || 'dev', // definida no build da imagem (ARG)
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'loja',
  },
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const CACHE_KEY = 'produtos:lista';
const CACHE_TTL_SEGUNDOS = 30;

// Pool de conexões MySQL: reaproveita conexões em vez de abrir uma por requisição.
// O pool é "preguiçoso": só conecta de fato na primeira query.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 5000,
});

// Cliente Redis. O evento 'error' precisa ter handler; sem ele, o Node derruba
// o processo com uma exceção não tratada quando o Redis cai.
const redis = createClient({
  socket: {
    host: config.redisHost,
    port: config.redisPort,
    // reconecta sozinho, com espera crescente (máx. 2 s)
    reconnectStrategy: (tentativas) => Math.min(tentativas * 200, 2000),
  },
});
redis.on('error', (err) => console.error('[redis] erro:', err.message));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Inicialização: espera o MySQL e o Redis ficarem disponíveis
// ---------------------------------------------------------------------------
async function iniciarBanco() {
  const maxTentativas = 30; // 30 x 2 s = até 1 minuto de espera
  for (let i = 1; i <= maxTentativas; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          preco DECIMAL(10,2) NOT NULL,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[mysql] pronto, tabela produtos garantida');
      return;
    } catch (err) {
      console.log(`[mysql] indisponível (${i}/${maxTentativas}): ${err.code || err.message}`);
      await sleep(2000);
    }
  }
  throw new Error('MySQL não ficou disponível a tempo');
}

// ---------------------------------------------------------------------------
// Aplicação HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Identificação da instância. O hostname é o nome do pod no Kubernetes, o que
// permite ver o balanceamento do Service entre as réplicas.
app.get('/', (_req, res) => {
  res.json({
    app: 'loja-api',
    version: config.version,
    instancia: require('os').hostname(),
  });
});

// Liveness: só diz que o processo responde.
app.get('/live', (_req, res) => res.status(200).send('ok'));

// Readiness / healthcheck: verifica as dependências.
app.get('/health', async (_req, res) => {
  const checks = { mysql: 'ok', redis: 'ok' };
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    checks.mysql = 'falha';
  }
  try {
    await redis.ping();
  } catch (err) {
    checks.redis = 'falha';
  }
  const saudavel = checks.mysql === 'ok' && checks.redis === 'ok';
  res.status(saudavel ? 200 : 503).json({ status: saudavel ? 'ok' : 'degradado', checks });
});

// Lista produtos, com cache no Redis (padrão cache-aside).
app.get('/produtos', async (_req, res) => {
  try {
    const emCache = await redis.get(CACHE_KEY);
    if (emCache) {
      return res.json({ origem: 'redis', produtos: JSON.parse(emCache) });
    }
    const [linhas] = await pool.query('SELECT id, nome, preco FROM produtos ORDER BY id');
    await redis.set(CACHE_KEY, JSON.stringify(linhas), { EX: CACHE_TTL_SEGUNDOS });
    res.json({ origem: 'mysql', produtos: linhas });
  } catch (err) {
    console.error('[GET /produtos]', err.message);
    res.status(500).json({ erro: 'falha ao listar produtos' });
  }
});

// Cria produto e invalida o cache (senão a lista ficaria desatualizada).
app.post('/produtos', async (req, res) => {
  const { nome, preco } = req.body || {};
  if (!nome || typeof preco !== 'number') {
    return res.status(400).json({ erro: 'envie {"nome": "texto", "preco": numero}' });
  }
  try {
    // Query parametrizada (?) evita SQL injection.
    const [resultado] = await pool.query('INSERT INTO produtos (nome, preco) VALUES (?, ?)', [nome, preco]);
    await redis.del(CACHE_KEY);
    res.status(201).json({ id: resultado.insertId, nome, preco });
  } catch (err) {
    console.error('[POST /produtos]', err.message);
    res.status(500).json({ erro: 'falha ao criar produto' });
  }
});

// Contador de visitas no Redis (operação atômica INCR).
app.get('/visitas', async (_req, res) => {
  try {
    const total = await redis.incr('visitas');
    res.json({ visitas: total });
  } catch (err) {
    res.status(500).json({ erro: 'falha no redis' });
  }
});

// Gera carga de CPU (~50 ms por chamada) para a demonstração do HPA.
app.get('/carga', (_req, res) => {
  const fim = Date.now() + 50;
  let x = 0;
  while (Date.now() < fim) {
    x += Math.sqrt(Math.random()); // trabalho inútil, só para ocupar a CPU
  }
  res.json({ ok: true, instancia: require('os').hostname(), x: Math.round(x) });
});

// ---------------------------------------------------------------------------
// Start + encerramento limpo
// ---------------------------------------------------------------------------
async function main() {
  await redis.connect();
  await iniciarBanco();
  const servidor = app.listen(config.port, () => {
    console.log(`[api] versão ${config.version} ouvindo na porta ${config.port}`);
  });

  // O Kubernetes envia SIGTERM ao encerrar um pod (rollout, scale down).
  // Tratar o sinal deixa as requisições em andamento terminarem.
  const encerrar = () => {
    console.log('[api] SIGTERM recebido, encerrando...');
    servidor.close(async () => {
      await pool.end().catch(() => {});
      await redis.quit().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

main().catch((err) => {
  console.error('[api] falha fatal na inicialização:', err.message);
  process.exit(1); // o orquestrador (Compose/K8s) reinicia o container
});
