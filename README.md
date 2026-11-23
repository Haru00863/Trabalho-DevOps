# Loja API - Atividade N3 (DevOps & Cloud Computing)

API em Node.js (Express) com MySQL e Redis, empacotada com Docker, orquestrada com Docker
Compose e operada no Kubernetes.

Integrantes: Haru Oltramari Ludwig e João Vitor Ustunomiya - ADS 4º semestre - UNIFASIPE

## Estrutura

```text
projeto/
├── app/                  código da API, Dockerfile, .dockerignore
├── docker-compose.yml    API + MySQL + Redis
├── .env.example          modelo de variáveis (sem senhas reais)
├── k8s/                  manifests da aplicação (Parte 3)
├── extras/               gerador de carga (HPA), JSONs de teste, scripts auxiliares
├── comandos.md           comandos da Parte 4, na ordem de execução
└── README.md
```

## Endpoints da API

| Rota | Função |
|---|---|
| `GET /` | versão da aplicação e nome da instância (pod/container) |
| `GET /live` | liveness: o processo está vivo |
| `GET /health` | readiness: testa MySQL e Redis (200 ou 503) |
| `GET /produtos` | lista produtos (cache no Redis por 30 s) |
| `POST /produtos` | cria produto: `{"nome": "Teclado", "preco": 149.9}` |
| `GET /visitas` | contador de visitas no Redis |
| `GET /carga` | consome ~50 ms de CPU (apenas para testar o HPA) |

## Pré-requisitos (Windows)

- Docker Desktop em execução, com Kubernetes habilitado (kubeadm)
- `kubectl` (já vem com o Docker Desktop) e PowerShell
- metrics-server instalado no cluster (necessário para o HPA; passo em [comandos.md](comandos.md))

## Como subir com Docker Compose

```powershell
Copy-Item .env.example .env   # ajuste as senhas se quiser
docker compose up -d --build
curl.exe http://localhost:3000/health
docker compose down           # mantém o volume (dados preservados)
```

## Como subir no Kubernetes

Passo a passo completo em [comandos.md](comandos.md).

```powershell
# 1. Troque o namespace n3-haruoltramariludwig-joaovitorustunomiya pelo seu (alternativa: VS Code > Ctrl+Shift+H, "Replace in files")
Set-ExecutionPolicy -Scope Process Bypass
.\extras\trocar-namespace.ps1 -Novo n3-seunome1-seunome2

# 2. Construa a imagem (o Docker Desktop compartilha as imagens com o Kubernetes)
docker build -t loja-api:1.0 --build-arg APP_VERSION=1.0 ./app

# 3. Aplique tudo
kubectl apply -f k8s/
kubectl get all -n n3-seunome1-seunome2

# 4. Acesse a API (em outra janela do PowerShell, deixe rodando)
kubectl port-forward -n n3-seunome1-seunome2 svc/loja-api 8080:80
curl.exe http://localhost:8080/health
```

## Observações

- As senhas em `k8s/02-secret.yaml` são fictícias e servem só para demonstração.
- O arquivo `.env` real nunca é versionado (veja `.gitignore`).
- Se o PVC do MySQL ficar `Pending`, o cluster não tem StorageClass padrão
  (`kubectl get storageclass`); no Docker Desktop ele já vem configurado (`hostpath`).
