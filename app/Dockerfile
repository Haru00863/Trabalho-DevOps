# ---------------------------------------------------------------------------
# Dockerfile da API da Loja
# ---------------------------------------------------------------------------

# Imagem base "enxuta": a variante alpine é bem menor que a padrão (Debian),
# o que reduz tamanho de download e superfície de ataque.
FROM node:20-alpine

# Versão da aplicação, informada no build (--build-arg APP_VERSION=2.0).
# ARG existe só durante o build; o ENV a copia para o container em execução,
# e é daí que o server.js lê o valor.
ARG APP_VERSION=1.0
ENV APP_VERSION=${APP_VERSION}

# NODE_ENV=production faz bibliotecas como o Express otimizarem o desempenho.
ENV NODE_ENV=production

# Diretório de trabalho dentro da imagem (criado automaticamente).
WORKDIR /app

# Copia SÓ os arquivos de dependências antes do restante do código.
# Cada instrução gera uma camada em cache: se o package.json não mudou, o
# "npm install" abaixo é reaproveitado e o build fica muito mais rápido.
COPY package*.json ./

# --omit=dev instala só dependências de produção. O "npm cache clean" remove
# arquivos temporários para a imagem ficar menor.
RUN npm install --omit=dev && npm cache clean --force

# Agora copia o código-fonte (o .dockerignore evita levar node_modules etc.).
COPY . .

# Segurança: por padrão o container roda como root. A imagem node já traz o
# usuário "node" (sem privilégios); trocamos para ele.
USER node

# Documenta a porta usada pela aplicação (não publica a porta por si só).
EXPOSE 3000

# Comando de inicialização. Forma "exec" (lista JSON): o Node vira o processo
# principal (PID 1) e recebe diretamente o SIGTERM enviado pelo Docker/K8s.
CMD ["node", "server.js"]
