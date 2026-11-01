# Android Network ADB

Painel local em Node.js + TypeScript para acompanhar TV Boxes Android na LAN.
O caminho principal é o **agente**: a box abre uma página no navegador, conecta de dentro para fora
e aparece no painel sem ADB, root ou portas abertas. A descoberta de rede e o ADB continuam
disponíveis como ferramentas auxiliares.

## Requisitos
- Node.js 20+
- Para o agente: só o navegador da box conseguindo abrir a página do servidor na LAN.
- Para ADB (opcional): Android SDK Platform Tools (`adb`) no PATH.

## Iniciar
```bash
npm install
npm run dev
```
- Painel de agentes: <http://localhost:3000/>
- Descoberta e terminal ADB: <http://localhost:3000/discovery>
- Página que roda na box: <http://localhost:3000/agent>
- Comandos: <http://localhost:3000/commands.html>
- Configurações: <http://localhost:3000/settings.html>

O servidor escuta em `0.0.0.0:3000` para receber agentes da LAN.
Use `HOST=127.0.0.1 npm run dev` para voltar ao modo somente local. Na primeira execução é
necessário permitir o Node.js no firewall do Windows para redes privadas.

## O que dá para fazer
O mapa completo também é servido em `GET /api/capabilities` e aparece na página **Comandos**.
A página inicial mostra apenas as capacidades do modo agente.

### Agentes (principal)
- **Conectar uma box**: abra `http://<ip-do-pc>:3000/agent` no navegador da box, informe o token
  (exibido no painel e salvo em `agent-token.txt`) e mantenha a página aberta.
- **Ver conexões ativas**: `GET /api/agents` lista IP, modelo, Android, tela, idioma, status
  online/offline (janela de 20 s) e o último resultado.
- **Pedir info**: comando `info`; a box responde no próximo heartbeat (5 s).
- **Ler ambiente**: comando `env` (platform, UA-CH, núcleos, memória, WebGL, rede) para diagnosticar o navegador da box.
- **Abrir um site na box**: comando `open https://...`.
- **Remover da lista**: `DELETE /api/agents/:id` (a box volta a se registrar se a página continuar aberta).
- **Autenticação**: token em `x-agent-token` (header, query ou body) apenas nos endpoints de agente.

### Agente nativo (APK)
Instale a partir de `http://<ip-do-pc>:3000/apk` (ou `/tx-agent.apk`) e mantenha o app aberto na box.
Ele sobe um servidor HTTP na porta **8790** com token próprio exibido na tela:
- `GET /health` (aberto), `/info`, `/apps`, `/launch?pkg=`, `/open?url=`.
- `GET /install?url=<apk>` — baixa o APK e abre o instalador do sistema na TV (modo `view`);
  `&mode=session` usa `PackageInstaller`; `&installer=<pacote>` força um instalador específico.
- `GET /uninstall?pkg=` — pede a desinstalação na TV.
- `GET /settings?what=unknown|security|applications|main` — abre a tela de configurações.
- `GET /result` — resultado da última instalação/desinstalação.
- `/info` informa `canInstall` (fontes desconhecidas liberadas?), quais telas de Settings existem e
  quais apps respondem ao MIME de APK — essencial em ROMs de TV sem `com.android.settings`.
- Tudo exige `x-agent-token`; só `/health` é aberto, e a instalação sempre pede confirmação na TV.

### CLI no PC (agente nativo)
`tools/box.mjs` conversa com o agente da box pela rede — é o equivalente aos comandos ADB, sem ADB:
- `node tools/box.mjs config 192.168.1.12:8790 <token>` — grava host e token em `box.json`.
- `node tools/box.mjs info` — modelo, Android, `canInstall`, telas de Settings e instaladores.
- `node tools/box.mjs apps [--system] [--json]` — lista apps.
- `node tools/box.mjs launch <pacote>` / `open <url>` — abre app ou site na TV.
- `node tools/box.mjs install <arquivo.apk>` — sobe um servidor temporário no PC, a box baixa o
  APK e abre o instalador; confirme na TV. `--session` usa o PackageInstaller do ROM.
- `node tools/box.mjs uninstall <pacote>` / `settings [unknown|security|applications|main]` / `result`.
- host, porta e token também valem por `BOX_HOST`, `BOX_PORT` e `BOX_TOKEN`; `npm run box -- <comando>` é o atalho.
- No terminal da página `/discovery` (aba **Terminal**), os mesmos comandos funcionam com o prefixo
  `agent` (ou `box`): `agent info`, `agent apps`, `agent launch <pacote>`, `agent install <apk>`.
  Comandos ADB seguem sem prefixo no mesmo campo.

### Descoberta na rede (auxiliar)
- Varredura em etapas: hosts conhecidos, `adb devices`, mDNS (Cast, Android TV Remote, AirPlay,
  RAOP, ADB TLS), SSDP/UPnP, cache ARP e varredura TCP da sub-rede principal.
- Identificação com nome, modelo, fabricante, MAC e evidências; classificação em Android TV,
  Android (celular/tablet), Apple, roteador ou desconhecido.
- Aparelhos ligados por **cabo USB** aparecem na descoberta (o IP de Wi‑Fi é obtido via
  `adb shell ip -4 -o addr` quando autorizado) e o serial fica disponível como alvo dos comandos.
- Enriquecimento por AirPlay `/info`, Google Cast `eureka_info`, descrição UPnP e DNS reverso.
- Sonda de TTL para hosts sem portas abertas e Wake-on-LAN para hosts conhecidos.

### ADB (opcional)
O alvo pode ser um IP (`192.168.1.14`), `ip:porta` ou o **serial USB** exibido por `adb devices`
(ex.: `RQ8R205WKDW`).
- `list <ip-ou-serial>` — identifica e coleta fabricante, modelo, Android, SDK, RAM, armazenamento,
  uptime e bateria.
- `apps <alvo>` — lista apps de usuário e de sistema.
- `install <alvo> <apk>` — instala/atualiza um APK do PC.
- `uninstall <alvo> <pacote> confirmar` — remove um app (tenta `pm uninstall --user 0` se necessário).
- `screen <alvo>` — captura a tela e mostra a prévia em `/discovery`.
- `push <alvo> <arquivo> [destino]` — envia arquivo para a box.
- `reboot <alvo> confirmar` — reinicia a box.
- `pair <ip:porta> <código>` — pareia a depuração sem fio do Android 11+.
- `connect <ip[:porta]>` / `disconnect <ip[:porta]>` — gerencia a sessão.
- `abort` / `help`.
- Keep-alive testa hosts ADB conhecidos, reconecta e pode acordar a box via Wake-on-LAN.

O painel `/discovery` tem uma área **Apps e arquivos** com escolha de APK/arquivo pelo navegador
(`POST /api/transfer?action=install|push`), captura de tela e reinício com confirmação.
Essas operações exigem ADB habilitado; a página `/agent` não tem permissão do navegador para
instalar ou remover apps. Para instalar/desinstalar sem ADB, use o agente nativo (APK) na porta 8790.

### Integração entre agentes, descoberta e cache
- `GET /api/devices` marca cada grupo com o agente correspondente (`agent.online`), inclui
  agentes que a varredura não encontrou e devolve `usbAdb` com os aparelhos conectados por USB.
- O painel de descoberta mostra um selo “agente online/offline” no dispositivo.
- A página de configurações mistura hosts conhecidos, agentes e aparelhos ADB em
  **Dispositivos em cache**.

### Sistema
- `GET /api/logs` — SSE com a atividade do servidor.
- `GET/POST /api/config`, `POST /api/config/reset` — ajustes da descoberta e keep-alive.
- `GET /api/capabilities` — este mapa em JSON.

## Arquitetura
```
src/
  server.ts                 bootstrap: Express, middleware, montagem das rotas
  capabilities.ts           mapa de capacidades (fonte do /api/capabilities)
  core/
    settings.ts             porta, host, versão, diretório de dados, token
    log.ts                  barramento de logs (SSE)
    routes.ts               /api/logs, /api/capabilities, /api/config, /api/hosts
    security.ts             isLocalRequest (loopback + IPs da própria máquina)
    config-store.ts         leitura/gravação de scan-config.json
    host-cache.ts           cache de hosts conhecidos
    network.ts              interfaces, ARP, DNS, TTL, portas, sub-rede
    http.ts / xml.ts / text.ts / time.ts
    wol.ts                  Wake-on-LAN
  agents/
    registry.ts             registro em memória, janela online, cleanup
    security.ts             apiAccess (token para agente, localhost para o resto)
    routes.ts               /api/agent/*, /api/agents
  discovery/
    scan.ts                 orquestra a varredura e mantém o estado
    identify.ts             agrupa e classifica evidências
    models.ts / ports.ts / types.ts
    protocols/              mdns, ssdp, airplay, cast
    routes.ts               /api/devices, /api/scan/status, /api/scan/start
  adb/
    client.ts               execução do adb, endpoints e resolução
    ops.ts                  apps, install, uninstall, screen, push, reboot
    keepalive.ts            reconexão periódica
    routes.ts               POST /api/command, /api/transfer, /api/captures
public/
  index.html                painel de agentes + mapa de capacidades
  discovery.html            dispositivos + terminal ADB
  agent.html                página que roda na box
  commands.html             referência de comandos
  settings.html             configurações da descoberta
  js/common.js              utilidades compartilhadas
  js/capabilities.js        mapa de capacidades (home e Comandos)
  js/agents.js              lógica do painel de agentes
  js/discovery.js           lógica da descoberta/terminal
```

### Regras de acesso
- Todo `/api/*` é restrito ao localhost, **exceto** os endpoints de agente.
- `/api/agent/register`, `/api/agent/heartbeat`, `/api/agent/result` e
  `POST /api/agents/:id/command` exigem token válido, inclusive localmente.
- `GET /api/agents` só devolve o token quando a requisição é local.
- O token nunca é necessário na página `/agent` da box além do próprio formulário.

## Limitações
Não existe forma universal de identificar toda TV Box só pelo IP. A descoberta vê serviços
expostos (Cast, Android TV Remote, ADB, UPnP); aparelhos desligados, em outra sub-rede ou com
ADB desabilitado podem não aparecer.

ADB sempre exige autorização local na primeira conexão:
- **Cabo USB**: ative a depuração USB, aceite o aviso no aparelho e use o serial como alvo — não
  precisa de rede nem de `connect`.
- **Android 11+**: ativar *Opções do desenvolvedor → Depuração sem fio*, usar
  `pair <ip:porta-de-pareamento> <código>` e depois `connect <ip:porta-de-conexão>`.
- **Android 10 ou menor**: ativar *Depuração USB/ADB pela rede*, usar `connect <ip>:5555`
  e aceitar o aviso "Permitir depuração USB" na tela.

Se a firmware bloquear as opções de desenvolvedor, é necessário menu de engenharia/vendor.
Para apenas listar e identificar boxes sem ADB, use o modo agente.
