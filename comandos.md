# comandos.md

Comandos da atividade N3, na ordem de execução. Feitos para **PowerShell no Windows** com
**Docker Desktop + Kubernetes (kubeadm)**. Cada comando em **uma linha só** (o `\` não quebra
linha no PowerShell).

Namespace usado: `n3-haruoltramariludwig-joaovitorustunomiya` (troque pelo seu; veja o README).

Observações específicas do PowerShell:

- Use `curl.exe` (com `.exe`). Sem isso, `curl` é um apelido de `Invoke-WebRequest` e se comporta diferente.
- O corpo JSON dos `POST` vai em arquivos (`extras/*.json`) para evitar problemas de aspas.
- Para guardar a saída em arquivo e ver na tela: `comando | Tee-Object -FilePath saida.txt`.

Dica para o relatório: depois de cada comando importante, cole a saída aqui (bloco `text`
abaixo do comando) e tire print com o seu nome/namespace visível (Win+Shift+S).

---

## 0. Preparação do ambiente

1. Abra o Docker Desktop e aguarde ele ficar em execução (ícone verde).
2. Ative o Kubernetes: **Settings > Kubernetes > Enable Kubernetes**, método **kubeadm**, e clique em
   **Apply & restart** (leva alguns minutos na primeira vez).
3. No PowerShell:

```powershell
# Versões instaladas
docker version
docker compose version
kubectl version --client

# Garante que o kubectl aponta para o cluster do Docker Desktop
kubectl config use-context docker-desktop
kubectl get nodes

# Instala o metrics-server (necessário para "kubectl top" e para o HPA)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# No Docker Desktop o kubelet usa certificado autoassinado; este patch faz o metrics-server aceitá-lo
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file extras/metrics-server-patch.json

# Aguarda ficar pronto (1-2 minutos) e testa
kubectl rollout status deployment/metrics-server -n kube-system
kubectl top nodes
```

No Docker Desktop com kubeadm, o cluster usa o **mesmo Docker** da sua máquina: uma imagem
construída com `docker build` já fica visível para o Kubernetes (não precisa de registry nem de
"load").

---

## Parte 1 - Docker

```powershell
# Constrói a imagem com a tag 1.0 (o "./app" é o contexto de build)
docker build -t loja-api:1.0 --build-arg APP_VERSION=1.0 ./app

# Confere a imagem criada e o tamanho
docker images loja-api

# Roda um container de teste (sem banco, ele ficará tentando conectar ao MySQL)
docker run -d --name teste-api -p 3001:3000 loja-api:1.0

# / e /live respondem mesmo sem banco
curl.exe http://localhost:3001/
curl.exe http://localhost:3001/live

# /health deve responder 503 (sem MySQL/Redis): esse é o comportamento esperado
curl.exe -i http://localhost:3001/health

# Logs: mostram as tentativas de conexão ao MySQL
docker logs teste-api

# Limpa o teste
docker rm -f teste-api
```

---

## Parte 2 - Docker Compose

```powershell
# Cria o .env a partir do modelo (edite as senhas se quiser; ele não vai para o GitHub)
Copy-Item .env.example .env

# Sobe API + MySQL + Redis em segundo plano
docker compose up -d --build

# Estado dos serviços (aguarde db, redis e api ficarem "healthy")
docker compose ps

# Testa a API
curl.exe http://localhost:3000/health
curl.exe -X POST http://localhost:3000/produtos -H "Content-Type: application/json" -d "@extras/produto-teclado.json"
curl.exe http://localhost:3000/produtos

# PROVA DE PERSISTÊNCIA: derruba tudo (o volume é mantido) e sobe de novo
docker compose down
docker compose up -d
docker compose ps
curl.exe http://localhost:3000/produtos
# O produto "Teclado" deve continuar aparecendo (origem: "mysql").

# Confere o volume nomeado
docker volume ls

# Quando terminar (NÃO use -v antes de gravar as evidências, pois -v apaga os dados)
docker compose down
```

---

## Parte 3 - Kubernetes (YAML)

```powershell
# Aplica todos os manifests da pasta k8s/ (em ordem alfabética: namespace primeiro)
kubectl apply -f k8s/

# Visão geral do namespace (EVIDÊNCIA 1)
kubectl get all -n n3-haruoltramariludwig-joaovitorustunomiya

# Acompanha os pods até ficarem Running e 1/1 Ready (Ctrl+C para sair)
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -w

# PVC deve estar "Bound"
kubectl get pvc -n n3-haruoltramariludwig-joaovitorustunomiya

# Acesso à API (deixe rodando em OUTRA janela do PowerShell)
kubectl port-forward -n n3-haruoltramariludwig-joaovitorustunomiya svc/loja-api 8080:80

# Na janela original:
curl.exe http://localhost:8080/
curl.exe http://localhost:8080/health
curl.exe -X POST http://localhost:8080/produtos -H "Content-Type: application/json" -d "@extras/produto-mouse.json"
curl.exe http://localhost:8080/produtos

# PROVA DE PERSISTÊNCIA: apaga o pod do MySQL (o Deployment cria outro)
kubectl delete pod -n n3-haruoltramariludwig-joaovitorustunomiya -l app=mysql
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=mysql -w

# Quando o novo pod estiver 1/1 Running, consulta o banco DIRETAMENTE (sem passar pelo cache).
# O acento grave (`) antes do $ impede o PowerShell de expandir a variável; quem expande é o shell do pod.
kubectl exec -n n3-haruoltramariludwig-joaovitorustunomiya deploy/mysql -- sh -c "mysql -uroot -p`$MYSQL_ROOT_PASSWORD loja -e 'SELECT * FROM produtos'"
```

---

## Parte 4 - Operação do cluster por comandos

### 4.1 Escalar na mão (2 -> 4 -> 2)

```powershell
kubectl scale deployment loja-api --replicas=4 -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api
kubectl scale deployment loja-api --replicas=2 -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api
```

### 4.2 Atualizar sem derrubar (1.0 -> 2.0)

```powershell
# Gera a versão 2.0 (a mudança visível é o campo "version" em GET /)
docker build -t loja-api:2.0 --build-arg APP_VERSION=2.0 ./app

# Aplica a nova imagem e acompanha a troca gradual
kubectl set image deployment/loja-api api=loja-api:2.0 -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl rollout status deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya

# Registra o motivo no histórico (preenche a coluna CHANGE-CAUSE) e mostra o histórico (EVIDÊNCIA 3)
kubectl annotate deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya "kubernetes.io/change-cause=atualiza API para 2.0"
kubectl rollout history deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya

# Confere a versão nova (o port-forward antigo morre na troca de pods; reinicie-o em outra janela)
kubectl port-forward -n n3-haruoltramariludwig-joaovitorustunomiya svc/loja-api 8080:80
curl.exe http://localhost:8080/
```

### 4.3 Falha proposital e recuperação

```powershell
# Aplica uma imagem que não existe
kubectl set image deployment/loja-api api=loja-api:9.9 -n n3-haruoltramariludwig-joaovitorustunomiya

# Mostra o erro: pods novos em ErrImagePull / ImagePullBackOff; os antigos continuam Running
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api

# Diagnóstico: troque NOME_DO_POD pelo nome do pod com erro
kubectl describe pod NOME_DO_POD -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl get events -n n3-haruoltramariludwig-joaovitorustunomiya --sort-by=.lastTimestamp

# Recuperação: volta para a revisão anterior
kubectl rollout undo deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl rollout status deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api
kubectl rollout history deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya
```

### 4.4 Limitar recursos

```powershell
# Define requests e limits por comando (isso gera um novo rollout)
kubectl set resources deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya --requests=cpu=100m,memory=64Mi --limits=cpu=300m,memory=192Mi
kubectl rollout status deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya

# Mostra no describe do pod (seção Containers > Limits / Requests)
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api
kubectl describe pod NOME_DO_POD -n n3-haruoltramariludwig-joaovitorustunomiya

# Evidência do deployment (EVIDÊNCIA 2)
kubectl describe deployment loja-api -n n3-haruoltramariludwig-joaovitorustunomiya
```

### 4.5 Autoscaling (HPA)

```powershell
# Cria o HPA: mínimo 2, máximo 5, alvo de 50% de CPU (relativo ao REQUEST de CPU)
kubectl autoscale deployment loja-api -n n3-haruoltramariludwig-joaovitorustunomiya --min=2 --max=5 --cpu-percent=50

# ANTES da carga (EVIDÊNCIA 4a) - deixe este comando rodando em uma janela
kubectl get hpa -n n3-haruoltramariludwig-joaovitorustunomiya -w

# Em OUTRA janela: gera a carga DENTRO do cluster
kubectl apply -f extras/gerador-de-carga.yaml

# DURANTE a carga (EVIDÊNCIA 4b): réplicas subindo (leva 1-3 min)
kubectl get hpa -n n3-haruoltramariludwig-joaovitorustunomiya -w
kubectl top pods -n n3-haruoltramariludwig-joaovitorustunomiya

# Para a carga
kubectl delete -f extras/gerador-de-carga.yaml

# DEPOIS da carga (EVIDÊNCIA 4c): réplicas descendo (leva uns 5 minutos de espera por padrão)
kubectl get hpa -n n3-haruoltramariludwig-joaovitorustunomiya -w
kubectl get pods -n n3-haruoltramariludwig-joaovitorustunomiya -l app=loja-api
```

### 4.6 O nó

```powershell
kubectl get nodes
# No Docker Desktop o nó se chama "docker-desktop" (EVIDÊNCIA 6)
kubectl describe node docker-desktop
# Procure as seções: Capacity, Allocatable e Allocated resources.

# EVIDÊNCIA 5
kubectl top pods -n n3-haruoltramariludwig-joaovitorustunomiya
```

---

## Checklist de evidências (Parte 5)

- [ ] `kubectl get all -n n3-haruoltramariludwig-joaovitorustunomiya`
- [ ] `kubectl describe deployment loja-api -n n3-haruoltramariludwig-joaovitorustunomiya`
- [ ] `kubectl rollout history deployment/loja-api -n n3-haruoltramariludwig-joaovitorustunomiya`
- [ ] `kubectl get hpa -n n3-haruoltramariludwig-joaovitorustunomiya -w` antes, durante e depois da carga
- [ ] `kubectl top pods -n n3-haruoltramariludwig-joaovitorustunomiya`
- [ ] `kubectl describe node docker-desktop`
